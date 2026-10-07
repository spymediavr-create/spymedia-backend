import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {randomBytes,scryptSync} from 'node:crypto';
import {failureDetails,providerFailure,logXConnectionFailure} from '../backend/diagnostics.cjs';
import {request,Connectors} from '../backend/connectors.cjs';
import {config} from '../backend/config.cjs';
import {Store} from '../backend/store.cjs';
import {Service} from '../backend/service.cjs';
import {createAdminHandler} from '../server-core.cjs';
import {formatFailureDetails} from '../public/catalog-ui.js';

// Process-only synthetic values. Every provider transport below is a mock.
const marker=randomBytes(32).toString('hex');
const env={X_AUTH_MODE:'oauth1',X_API_KEY:marker,X_API_SECRET:marker,X_ACCESS_TOKEN:marker,X_ACCESS_TOKEN_SECRET:marker,X_COST_LIMIT_ACKNOWLEDGED:'true',X_PUBLISH_ENABLED:'true'};
const body=(type='client-forbidden')=>({type:'https://api.x.com/2/problems/'+type,title:marker,detail:marker,reason:marker,headers:{Authorization:marker},url:'https://api.x.com/?token='+marker});
const response=(status=403,data)=>({status,data,headers:{Authorization:marker}});
const failed=(status,data)=>Object.assign(Error(marker),providerFailure(response(status,data),'GET','api.x.com'),{phase:'x_identity'});

test('X top-level and nested problem URIs normalize into fixed types and titles, without provider prose',()=>{
  for(const host of ['api.x.com','api.twitter.com'])for(const [type,title] of [['invalid-request','Invalid Request'],['resource-not-found','Resource Not Found'],['not-authorized-for-resource','Not Authorized For Resource'],['client-forbidden','Client Forbidden'],['usage-capped','Usage Cap Exceeded'],['rate-limit-exceeded','Rate Limit Exceeded']]){
    for(const data of [{...body(type),type:'https://'+host+'/2/problems/'+type},{errors:[{...body(type),type:'https://'+host+'/2/problems/'+type,code:453}],token:marker}]){
      const result=providerFailure(response(403,data),'GET','api.x.com');
      assert.equal(result.providerDetails.providerType,'x_'+type.replaceAll('-','_'));
      assert.equal(result.providerDetails.providerTitle,title);
      assert.equal(JSON.stringify(result).includes(marker),false);
      assert.equal(JSON.stringify(result).includes('https://'),false);
    }
  }
});
test('X title-only known errors normalize, but an unknown type cannot be overridden by a familiar title',()=>{
  for(const data of [{title:'Client Forbidden',detail:marker},{type:'about:blank',errors:[{title:'Not Found Error'}]}]){
    const details=providerFailure(response(403,data),'GET','api.x.com').providerDetails;
    assert.ok(['x_client_forbidden','x_resource_not_found'].includes(details.providerType));
  }
  for(const type of ['http://api.x.com/2/problems/client-forbidden','https://api.x.com.evil.invalid/2/problems/client-forbidden','https://api.x.com/2/problems/client-forbidden?token='+marker,'https://api.x.com/2/problems/client-forbidden#'+marker,marker,null,42,{}]){
    assert.deepEqual(providerFailure(response(403,{type,title:'Client Forbidden',detail:marker}),'GET','api.x.com').providerDetails,{httpStatus:403});
  }
});
test('X codes are bounded numbers; absent, generic and malformed details remain unknown without guessing',()=>{
  for(const data of [null,undefined,[],marker,{title:marker},{type:'about:blank',title:'Forbidden'}, {error:{message:marker,code:89}}, {errors:[{code:'89',message:marker}]}, {errors:[{code:-1}]},{errors:[{code:2**32}]},{errors:[null,marker]}]){
    assert.deepEqual(providerFailure(response(403,data),'GET','api.x.com').providerDetails,{httpStatus:403});
  }
  assert.deepEqual(providerFailure(response(401,{errors:[{code:89,message:marker}]}),'GET','api.x.com').providerDetails,{httpStatus:401,providerCode:89});
  assert.deepEqual(providerFailure(response(400,{error:'invalid_grant',error_description:marker}),'GET','api.x.com').providerDetails,{httpStatus:400,providerType:'invalid_grant'});
});
test('X 401, 403, 402 and 429 retain separate meanings while administrator sessions and Meta classifications stay intact',()=>{
  for(const [status,code,local] of [[401,'x_unauthorized',409],[403,'x_forbidden',409],[402,'x_payment_required',409],[429,'channel_rate_limit',429],[400,'channel_request_failed',502]]){
    const result=providerFailure(response(status,{}),'GET','api.x.com');
    assert.equal(result.code,code);assert.equal(result.status,local);assert.equal(result.providerDetails.httpStatus,status);assert.equal(result.uncertain,false);
  }
  for(const status of [401,403])assert.equal(providerFailure(response(status,{error:{code:200,type:'OAuthException'}}),'GET','graph.facebook.com').code,'channel_auth_or_permission');
  assert.equal(providerFailure(response(503,{}),'POST','api.x.com').uncertain,true);
});
test('resanitization derives the title from the allowed type and connection logs never emit raw fields',()=>{
  const details=failureDetails({phase:'x_identity',providerDetails:{httpStatus:403,providerType:'x_client_forbidden',providerTitle:marker,providerCode:453,detail:marker,url:marker}});
  assert.deepEqual(details,{httpStatus:403,providerCode:453,providerType:'x_client_forbidden',providerTitle:'Client Forbidden',phase:'x_identity'});
  assert.deepEqual(failureDetails({httpStatus:403,providerTitle:'Client Forbidden',providerType:marker}),{httpStatus:403});
  const logs=[],original=console.error;console.error=value=>logs.push(value);
  try{
    logXConnectionFailure({...failed(403,body()),message:marker,token:marker,headers:{Authorization:marker}});
    logXConnectionFailure({code:marker,phase:'x_identity',providerDetails:{httpStatus:401,providerType:marker,providerTitle:marker}});
    logXConnectionFailure({code:'x_cost_confirmation_required'});
    logXConnectionFailure({phase:'facebook_identity',httpStatus:403});
  }finally{console.error=original;}
  assert.equal(logs.length,2);assert.equal(logs.join('').includes(marker),false);assert.equal(logs.join('').includes('https://'),false);
  assert.deepEqual(JSON.parse(logs[0]),{event:'sns_connection_failed',channel:'x',error:'x_forbidden',httpStatus:403,providerType:'x_client_forbidden',providerTitle:'Client Forbidden',phase:'x_identity'});
  assert.equal(JSON.parse(logs[1]).error,'request_failed');
});
test('UI renders only its fixed X descriptions and marks an unspecified 403 cause unknown',()=>{
  for(const type of ['client-forbidden','usage-capped','rate-limit-exceeded']){
    const details=failureDetails(failed(403,body(type))),text=formatFailureDetails({...details,providerTitle:marker,detail:marker,url:marker});
    assert.ok(text.includes(type));assert.equal(text.includes(marker),false);assert.equal(text.includes('https://'),false);assert.equal(text.includes('만료'),false);
  }
  const unknown=formatFailureDetails({phase:'x_identity',httpStatus:403,providerType:marker,providerTitle:'Client Forbidden',providerCode:453});
  assert.match(unknown,/HTTP 403/);assert.match(unknown,/X code 453/);assert.match(unknown,/세부 원인: 알 수 없음/);assert.equal(unknown.includes(marker),false);assert.equal(unknown.includes('Client Forbidden'),false);
});
test('protected X diagnostic passes safe provider reasons end to end, logs them and keeps the administrator signed in',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'spymedia-x-diagnostics-'));
  t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));return fs.rm(dir,{recursive:true,force:true});});
  const settings=config({SNS_DATA_DIR:dir,SNS_STORAGE_PERSISTENCE:'confirmed',SNS_SINGLE_INSTANCE:'confirmed',SNS_PUBLISH_ENABLED:'true',...env}),store=new Store(settings);
  await store.init();let now=1000,calls=0,upstream=response(403,body());
  const connectors=new Connectors(settings,{request:(...args)=>request(...args,async options=>{calls++;assert.equal(options.method,'GET');assert.equal(options.url,'https://api.x.com/2/users/me');return upstream;})});
  const service=new Service({settings,store,media:{},connectors,diagnosticNow:()=>now});
  const salt=randomBytes(16),password=randomBytes(24).toString('hex'),handler=createAdminHandler({mode:'authenticated',username:'synthetic',passwordHash:salt.toString('hex')+':'+scryptSync(password,salt,64).toString('hex'),secureCookie:false,service});
  const server=http.createServer((req,res)=>handler(req,res).then(done=>{if(!done){res.writeHead(404);res.end();}}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const origin='http://127.0.0.1:'+server.address().port,route='/api/admin/x/check';
  assert.equal((await fetch(origin+route,{method:'POST'})).status,401);assert.equal(calls,0);
  const login=await fetch(origin+'/api/admin/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'synthetic',password})}),cookie=login.headers.get('set-cookie').split(';')[0];
  const status=await(await fetch(origin+'/api/admin/status',{headers:{Cookie:cookie}})).json(),headers={Cookie:cookie,Origin:origin,'Content-Type':'application/json','X-CSRF-Token':status.csrfToken};
  assert.equal((await fetch(origin+route,{method:'POST',headers:{...headers,'X-CSRF-Token':''},body:'{}'})).status,403);assert.equal(calls,0);
  const logs=[],original=console.error;console.error=value=>logs.push(value);
  try{
    for(const [httpStatus,data,code] of [[401,{errors:[{code:89,message:marker}]},'x_unauthorized'],[403,body(),'x_forbidden'],[403,{type:marker,title:marker,detail:marker},'x_forbidden']]){
      upstream=response(httpStatus,data);now+=60000;
      const result=await fetch(origin+route,{method:'POST',headers,body:'{}'});assert.equal(result.status,409);
      const text=await result.text();assert.equal(text.includes(marker),false);assert.equal(text.includes('https://'),false);
      const parsed=JSON.parse(text);assert.equal(parsed.error,code);assert.equal(parsed.details.httpStatus,httpStatus);assert.equal(parsed.details.phase,'x_identity');
      if(data.type==='https://api.x.com/2/problems/client-forbidden')assert.equal(parsed.details.providerTitle,'Client Forbidden');
      else assert.equal(parsed.details.providerTitle,undefined);
      assert.equal((await fetch(origin+'/admin',{headers:{Cookie:cookie},redirect:'manual'})).status,200);
    }
  }finally{console.error=original;}
  assert.equal(calls,3);assert.equal(logs.length,3);assert.equal(logs.join('').includes(marker),false);
  const draft={type:'link',youtubeUrl:'https://www.youtube.com/watch?v=AbCdEf123_-',title:'Synthetic diagnostic draft',description:'Synthetic description',xText:'Synthetic introduction',tags:[],channels:['x'],mediaIds:[]};
  upstream=response(403,body());const [job]=await service.jobs.create(draft);service.jobs.failureLogger=()=>{};
  await service.jobs.start([job.id]);await service.jobs.tail;
  const saved=(await service.jobs.list())[0];assert.equal(saved.status,'failed');assert.equal(saved.canRetry,true);assert.equal(saved.error,'x_forbidden');assert.equal(saved.errorDetails.providerTitle,'Client Forbidden');assert.equal(saved.errorDetails.phase,'x_identity');assert.equal(JSON.stringify(store.state).includes(marker),false);assert.equal(calls,4);
});
