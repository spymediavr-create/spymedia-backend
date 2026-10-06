import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {randomBytes,scryptSync} from 'node:crypto';
import {failureDetails,providerFailure,logJobFailure} from '../backend/diagnostics.cjs';
import {request,Connectors,TARGETS} from '../backend/connectors.cjs';
import {config} from '../backend/config.cjs';
import {Store} from '../backend/store.cjs';
import {Service} from '../backend/service.cjs';
import {createAdminHandler} from '../server-core.cjs';

const secret=randomBytes(32).toString('hex');
const env={META_GRAPH_VERSION:'v99.0',FB_PAGE_ACCESS_TOKEN:secret,FB_PUBLISH_ENABLED:'true'};
const response=(status=403,code=200)=>({status,data:{error:{code,error_subcode:463,type:'OAuthException',message:secret,fbtrace_id:secret},token:secret},headers:{Authorization:secret}});
const failure=(phase='facebook_identity')=>Object.assign(Error(secret),{status:409,code:'channel_auth_or_permission',phase,providerDetails:{httpStatus:403,providerCode:200,providerSubcode:463,providerType:'OAuthException',message:secret,url:'https://graph.facebook.com/?access_token='+secret}});
const draft={type:'link',youtubeUrl:'https://www.youtube.com/watch?v=AbCdEf123_-',title:'Synthetic reviewed title',description:'Synthetic reviewed introduction',tags:['SpyMedia'],channels:['facebook'],mediaIds:[]};
async function fixture(t,connectors,options={}){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'spymedia-facebook-test-'));
  t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));return fs.rm(dir,{recursive:true,force:true});});
  const settings=config({SNS_DATA_DIR:dir,SNS_STORAGE_PERSISTENCE:'confirmed',SNS_SINGLE_INSTANCE:'confirmed',SNS_PUBLISH_ENABLED:'true',...env});
  const store=new Store(settings);await store.init();
  const media={tools:async()=>{throw Error('No media tools permitted');},convert:async()=>{throw Error('No media conversion permitted');}};
  const service=new Service({settings,store,media,connectors,...options});
  return {settings,store,service};
}
test('diagnostic details and log output allow only bounded numbers, known types and known phases',()=>{
  const expected={httpStatus:403,providerCode:200,providerSubcode:463,providerType:'OAuthException',phase:'facebook_identity'};
  assert.deepEqual(failureDetails(failure()),expected);
  for(const value of [null,undefined,[],secret,42])assert.equal(failureDetails(value),null);
  assert.equal(failureDetails({httpStatus:99,providerCode:-1,providerSubcode:2**32,providerType:secret,phase:secret,message:secret}),null);
  assert.deepEqual(failureDetails({httpStatus:500,providerCode:190,errorPhase:'facebook_link_create',providerDetails:null}),{httpStatus:500,providerCode:190,phase:'facebook_link_create'});
  const original=console.error,logs=[];console.error=value=>logs.push(value);
  try{logJobFailure({id:'00000000-0000-0000-0000-000000000001',error:'channel_auth_or_permission',message:secret},{...expected,token:secret,body:secret,url:secret,headers:{Authorization:secret}});}
  finally{console.error=original;}
  const logged=JSON.parse(logs[0]);assert.equal(logged.event,'sns_job_failed');assert.equal(logged.jobId,'00000000-0000-0000-0000-000000000001');
  assert.deepEqual(Object.keys(logged).sort(),['event','channel','error','jobId',...Object.keys(expected)].sort());
  assert.equal(logs[0].includes(secret),false);
});
test('provider transport maps numeric Meta errors, preserves uncertainty only for writes and blocks unapproved hosts',async()=>{
  for(const [status,code,wanted] of [[401,999,'channel_auth_or_permission'],[403,999,'channel_auth_or_permission'],[400,190,'channel_auth_or_permission'],[400,10,'channel_auth_or_permission'],[400,200,'channel_auth_or_permission'],[400,17,'channel_rate_limit'],[429,999,'channel_rate_limit'],[400,999,'channel_request_failed']]){
    await assert.rejects(request('GET','https://graph.facebook.com/v99.0/me',secret,undefined,{},async()=>response(status,code)),e=>{
      assert.equal(e.code,wanted);assert.equal(e.uncertain,false);assert.equal(JSON.stringify(e).includes(secret),false);return true;
    });
  }
  assert.equal(providerFailure(response(400,190),'GET','api.x.com').code,'channel_request_failed');
  assert.equal(providerFailure(response(503,999),'GET','graph.facebook.com').uncertain,false);
  assert.equal(providerFailure(response(503,999),'POST','graph.facebook.com').uncertain,true);
  let calls=0;await assert.rejects(request('GET','https://evil.invalid/me',secret,undefined,{},async()=>{calls++;}),e=>e.code==='invalid_api_endpoint');assert.equal(calls,0);
  await assert.rejects(request('GET','https://graph.facebook.com/v99.0/me',secret,undefined,{},async()=>{throw Error(secret);}),e=>e.code==='channel_network_failure'&&!e.uncertain&&!JSON.stringify(e).includes(secret));
});
test('Facebook connection checks read the existing Page credential and do not claim publishing permissions',async()=>{
  const calls=[],c=new Connectors({env,publishingEnabled:false},{request:async(method,url,token,body)=>{calls.push({method,url,token,body});return {data:{id:TARGETS.facebook,name:secret,access_token:secret}};}});
  const result=await c.checkFacebookConnection();
  assert.deepEqual(result,{pageId:TARGETS.facebook,pageName:'스파이미디어 Page',identityVerified:true,publishingPermissionsVerified:false,publishingEnabled:false});
  assert.equal(calls.length,1);assert.equal(calls[0].method,'GET');assert.match(calls[0].url,/\/me\?fields=id,name$/);assert.equal(calls[0].token,secret);assert.equal(calls[0].body,undefined);assert.equal(JSON.stringify(result).includes(secret),false);
  for(const settings of [{env:{},publishingEnabled:true},{env:{...env,FB_PAGE_ID:'100069643772419'},publishingEnabled:true}]){
    let reads=0;const invalid=new Connectors(settings,{request:async()=>{reads++;}});
    await assert.rejects(invalid.checkFacebookConnection(),e=>['channel_not_configured','account_mismatch'].includes(e.code));assert.equal(reads,0);
  }
});
test('failed identity and a valid personal-profile identity cannot reach Facebook feed writes',async()=>{
  let writes=0;const ctx={checkpoint:async()=>{},beforePublication:async()=>{writes++;}};
  for(const value of [failure(),{data:{id:'100069643772419',name:'Synthetic profile'}}]){
    const c=new Connectors({env,publishingEnabled:true},{request:async method=>{assert.equal(method,'GET');if(value instanceof Error)throw value;return value;}});
    await assert.rejects(c.checkFacebookConnection(),e=>e.phase==='facebook_identity'&&['channel_auth_or_permission','account_mismatch'].includes(e.code));
    await assert.rejects(c.publish({...draft,channel:'facebook',input:draft,assets:[]},ctx),e=>e.phase==='facebook_identity');assert.equal(writes,0);
  }
});
test('malformed identity and link responses retain their safe diagnostic phase',async()=>{
  const badIdentity=new Connectors({env,publishingEnabled:true},{request:async()=>({data:null})});
  await assert.rejects(badIdentity.checkFacebookConnection(),e=>e.code==='invalid_channel_response'&&e.phase==='facebook_identity');
  for(const malformed of ['create','verify']){
    let writes=0;const c=new Connectors({env,publishingEnabled:true},{request:async(method,url)=>{
      if(url.includes('/me?'))return {data:{id:TARGETS.facebook}};
      if(method==='POST'){writes++;return {data:{id:malformed==='create'?'invalid '+secret:'synthetic_post'}};}
      return {data:{id:'another_post'}};
    }});
    await assert.rejects(c.publish({...draft,channel:'facebook',input:draft,assets:[]},{beforePublication:async()=>{},checkpoint:async()=>{}}),e=>e.phase==='facebook_link_'+malformed&&(malformed==='create'?e.code==='invalid_channel_response':e.code==='verify_publication'));
    assert.equal(writes,1);
  }
});
test('connection checks throttle across sessions, count failures, prevent overlap and return an allowlisted result',async t=>{
  let now=1000,calls=0,resolve,fail=false;
  const connectors={checkFacebookConnection:async()=>{calls++;if(fail)throw failure();await new Promise(r=>resolve=r);return {pageId:TARGETS.facebook,pageName:secret,identityVerified:true,publishingEnabled:true,token:secret,raw:{token:secret}};},availability:()=>({facebook:true,blog:true})};
  const {service}=await fixture(t,connectors,{diagnosticNow:()=>now});
  const pending=service.checkFacebookConnection();await assert.rejects(service.checkFacebookConnection(),e=>e.code==='facebook_check_rate_limited'&&e.retryAfter===60);assert.equal(calls,1);
  now+=60000;await assert.rejects(service.checkFacebookConnection(),e=>e.code==='facebook_check_rate_limited');assert.equal(calls,1);
  resolve();const result=await pending;assert.equal(JSON.stringify(result).includes(secret),false);assert.equal(result.publishingPermissionsVerified,false);
  fail=true;await assert.rejects(service.checkFacebookConnection(),e=>e.code==='channel_auth_or_permission');assert.equal(calls,2);
  await assert.rejects(service.checkFacebookConnection(),e=>e.code==='facebook_check_rate_limited');assert.equal(calls,2);
});
test('link identity failure stores only safe details, keeps zero files normal, clears retry diagnostics and prevents uncertain resending',async t=>{
  let afterWrite=false;const logs=[],connectors={availability:()=>({facebook:true,blog:true}),publish:async(job,ctx)=>{if(afterWrite)await ctx.beforePublication({});throw failure(afterWrite?'facebook_link_create':'facebook_identity');}};
  const {service,store}=await fixture(t,connectors);service.jobs.failureLogger=(job,details)=>logs.push(details);
  const [created]=await service.jobs.create(draft);await service.jobs.start([created.id]);await service.jobs.tail;
  let job=(await service.jobs.list())[0];assert.equal(job.status,'failed');assert.equal(job.canRetry,true);assert.equal(job.assets.length,0);assert.equal(job.errorDetails.phase,'facebook_identity');assert.equal(JSON.stringify(store.state.jobs[created.id]).includes(secret),false);
  assert.deepEqual(logs[0],job.errorDetails);const duplicate=(await service.jobs.create(draft))[0];assert.equal(duplicate.id,created.id);
  await service.jobs.retry(created.id);job=(await service.jobs.list())[0];assert.equal(job.status,'prepared');assert.equal(job.errorDetails,null);
  afterWrite=true;await service.jobs.start([created.id]);await service.jobs.tail;job=(await service.jobs.list())[0];
  assert.equal(job.status,'unknown');assert.equal(job.canRetry,false);assert.equal(job.errorDetails.phase,'facebook_link_create');
  await assert.rejects(service.jobs.retry(created.id),e=>e.code==='check_channel_before_retry');assert.equal((await service.jobs.create(draft))[0].id,created.id);
});
test('diagnostic endpoint requires login, same origin, CSRF and empty input; rejects GET and leaks no credential',async t=>{
  let now=1000,calls=0,fail=false,malicious=false;
  const connectors={availability:()=>({facebook:true,blog:true}),checkFacebookConnection:async()=>{calls++;if(malicious)throw Object.assign(Error(secret),{status:502,code:secret,providerDetails:{httpStatus:500,message:secret,url:secret}});if(fail)throw failure();return {pageId:TARGETS.facebook,identityVerified:true,publishingEnabled:true,token:secret};}};
  const {service}=await fixture(t,connectors,{diagnosticNow:()=>now});
  const salt=randomBytes(16),password=randomBytes(20).toString('hex');
  const handler=createAdminHandler({mode:'authenticated',username:'synthetic',passwordHash:salt.toString('hex')+':'+scryptSync(password,salt,64).toString('hex'),secureCookie:false,service});
  const server=http.createServer((req,res)=>{handler(req,res).then(done=>{if(!done){res.writeHead(404);res.end();}});});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const origin='http://127.0.0.1:'+server.address().port,route='/api/admin/facebook/check';
  const req=(p=route,opts={})=>fetch(origin+p,opts);
  assert.equal((await req(route,{method:'POST'})).status,401);assert.equal(calls,0);
  const publicStatus=await(await req('/api/admin/status')).json();assert.equal(publicStatus.channels,undefined);assert.equal(publicStatus.csrfToken,undefined);assert.equal(JSON.stringify(publicStatus).includes(secret),false);
  const login=await req('/api/admin/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'synthetic',password})});
  const cookie=login.headers.get('set-cookie').split(';')[0],status=await(await req('/api/admin/status',{headers:{Cookie:cookie}})).json();
  const headers={Cookie:cookie,Origin:origin,'Content-Type':'application/json','X-CSRF-Token':status.csrfToken};
  for(const altered of [{...headers,'X-CSRF-Token':''},{...headers,Origin:'https://evil.invalid'}])assert.equal((await req(route,{method:'POST',headers:altered,body:'{}'})).status,403);
  assert.equal((await req(route,{headers:{Cookie:cookie}})).status,404);
  for(const body of [JSON.stringify({token:secret}),'null','[]'])assert.equal((await req(route,{method:'POST',headers,body})).status,400);
  assert.equal(calls,0);
  const success=await req(route,{method:'POST',headers,body:'{}'});assert.equal(success.status,200);const result=await success.json();assert.equal(result.connection.publishingPermissionsVerified,false);assert.equal(JSON.stringify(result).includes(secret),false);assert.equal(calls,1);
  const limited=await req(route,{method:'POST',headers,body:'{}'});assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'60');assert.equal(calls,1);
  now+=60000;fail=true;const failed=await req(route,{method:'POST',headers,body:'{}'});assert.equal(failed.status,409);const text=await failed.text();assert.equal(text.includes(secret),false);const details=JSON.parse(text).details;assert.equal(details.httpStatus,403);assert.equal(details.providerCode,200);assert.equal(details.phase,'facebook_identity');assert.equal(calls,2);
  now+=60000;malicious=true;const bounded=await req(route,{method:'POST',headers,body:'{}'});assert.equal(bounded.status,502);const boundedText=await bounded.text();assert.equal(boundedText.includes(secret),false);assert.equal(JSON.parse(boundedText).error,'request_failed');
});
