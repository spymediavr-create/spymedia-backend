import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {randomBytes,scryptSync} from 'node:crypto';
import {config} from '../backend/config.cjs';
import {XAuth,XTokenVault,oauth1Header,SCOPES} from '../backend/x-auth.cjs';
import {Connectors,request} from '../backend/connectors.cjs';
import {failureDetails,providerFailure,logJobFailure} from '../backend/diagnostics.cjs';
import {Service} from '../backend/service.cjs';
import {Store} from '../backend/store.cjs';
import {createAdminHandler} from '../server-core.cjs';
const random=()=>randomBytes(24).toString('hex');
const identity={id:'123456789012345',username:'spymedia_kor',name:'untrusted upstream name'};
const one={X_AUTH_MODE:'oauth1',X_API_KEY:random(),X_API_SECRET:random(),X_ACCESS_TOKEN:random(),X_ACCESS_TOKEN_SECRET:random()};
const staticEnv={X_AUTH_MODE:'oauth2',X_USER_ACCESS_TOKEN:random(),X_COST_LIMIT_ACKNOWLEDGED:'true',X_PUBLISH_ENABLED:'true'};
const expired=()=>Object.assign(Error('untrusted upstream credential text'),{status:409,code:'channel_auth_or_permission',providerDetails:{httpStatus:401}});
const result=()=>({access_token:random(),refresh_token:random(),expires_in:7200,token_type:'bearer',scope:SCOPES.join(' ')+' offline.access'});
const draft={type:'link',youtubeUrl:'https://www.youtube.com/watch?v=AbCdEf123_-',title:'Synthetic X review',description:'Synthetic description',xText:'Synthetic short introduction',tags:['SpyMedia'],channels:['x'],mediaIds:[]};
async function fixture(t,extra={}){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'spymedia-x-test-'));
  t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));return fs.rm(dir,{recursive:true,force:true});});
  const env={...staticEnv,X_OAUTH_CLIENT_ID:random(),X_OAUTH_CLIENT_SECRET:random(),X_OAUTH_REFRESH_TOKEN:random(),X_TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('hex'),...extra};
  const settings=config({SNS_DATA_DIR:dir,SNS_STORAGE_PERSISTENCE:'confirmed',SNS_SINGLE_INSTANCE:'confirmed',SNS_PUBLISH_ENABLED:'true',...env});
  return {dir,env,settings};
}
test('OAuth 1.0a signing matches the independent RFC 5849 section 3.4.1.1 example',()=>{
  const header=oauth1Header('POST','http://example.com/request?b5=%3D%253D&a3=a&c%40=&a2=r%20b',{apiKey:'9djdj82h48djs9d2',apiSecret:'j49sk3j29djd',accessToken:'kkk9d7dh3k39sjv7',accessTokenSecret:'dh893hdasih9'},{nonce:'7d8f3e4a',timestamp:137131201,version:false,form:{c2:'',a3:'2 q'}});
  assert.equal(decodeURIComponent(/oauth_signature="([^"]+)"/.exec(header)[1]),'r6/TJjbCOr97/+UU0NsvSne7s5g=');
});
test('OAuth 1.0a reuses four server keys, signs JSON requests and blocks other destinations',async()=>{
  const calls=[],auth=new XAuth({env:one},async(...args)=>{calls.push(args);return {data:{data:identity}};});
  await auth.call('GET','https://api.x.com/2/users/me');await auth.call('POST','https://api.x.com/2/tweets',{text:'합성 소개'});
  assert.equal(calls.length,2);assert.ok(calls.every(c=>c[2]===null&&c[4].Authorization.startsWith('OAuth ')));
  assert.notEqual(calls[0][4].Authorization,calls[1][4].Authorization);assert.deepEqual(calls[1][3],{text:'합성 소개'});
  for(const endpoint of ['https://evil.invalid/2/tweets','https://api.x.com:444/2/tweets','https://user@api.x.com/2/tweets','https://api.x.com/2/oauth2/token'])await assert.rejects(auth.call('GET',endpoint),e=>e.code==='invalid_api_endpoint');
  assert.equal(calls.length,2);
});
test('mode selection never puts an OAuth 1.0a token into a Bearer header',async()=>{
  const inferred=new XAuth({env:{...one,X_AUTH_MODE:''}},()=>{});assert.equal(inferred.mode(),'oauth1');assert.equal(inferred.configured(),true);
  for(const env of [{...one,X_AUTH_MODE:'',X_USER_ACCESS_TOKEN:random()},{...one,X_AUTH_MODE:'wrong'},{X_ACCESS_TOKEN:random()},{...staticEnv,X_OAUTH_CLIENT_ID:random()}]){
    let calls=0;const invalid=new XAuth({env},()=>{calls++;});assert.equal(invalid.configured(),false);await assert.rejects(invalid.call('GET','https://api.x.com/2/users/me'),e=>e.code==='x_auth_configuration');assert.equal(calls,0);
  }
});
test('connection check does only GET, needs cost acknowledgement and does not certify writing',async()=>{
  const calls=[],c=new Connectors({env:staticEnv,publishingEnabled:false},{request:async(...args)=>{calls.push(args);return {data:{data:{...identity,access_token:staticEnv.X_USER_ACCESS_TOKEN}}};}});
  const checked=await c.checkXConnection();assert.equal(checked.username,'spymedia_kor');assert.equal(checked.authMode,'oauth2');assert.equal(checked.publishingPermissionsVerified,false);assert.equal(checked.publishingEnabled,false);
  assert.equal(calls.length,1);assert.equal(calls[0][0],'GET');assert.equal(calls[0][1],'https://api.x.com/2/users/me');assert.equal(calls[0][2],staticEnv.X_USER_ACCESS_TOKEN);assert.equal(JSON.stringify(checked).includes(staticEnv.X_USER_ACCESS_TOKEN),false);
  let forbidden=0;const blocked=new Connectors({env:{...staticEnv,X_COST_LIMIT_ACKNOWLEDGED:'false'},publishingEnabled:true},{request:async()=>forbidden++});await assert.rejects(blocked.checkXConnection(),e=>e.code==='x_cost_confirmation_required');assert.equal(forbidden,0);
});
test('read-only diagnosis never renews an expired OAuth 2.0 token or issues any POST',async t=>{
  const f=await fixture(t,{X_USER_ACCESS_TOKEN_EXPIRES_AT:'2000-01-01T00:00:00Z'});let calls=0;
  const c=new Connectors(f.settings,{request:async()=>{calls++;throw expired();}});
  await assert.rejects(c.checkXConnection(),e=>e.code==='x_auth_expired'&&e.phase==='x_identity');assert.equal(calls,0);
  const other=await fixture(t),methods=[];
  const failed=new Connectors(other.settings,{request:async method=>{methods.push(method);throw expired();}});
  await assert.rejects(failed.checkXConnection(),e=>e.code==='channel_auth_or_permission');assert.deepEqual(methods,['GET']);
});
test('concurrent refresh is single-flight, persists encrypted rotation and survives restart',async t=>{
  const f=await fixture(t,{X_USER_ACCESS_TOKEN_EXPIRES_AT:'2000-01-01T00:00:00Z'}),next=result();let renewals=0,reads=0;
  const transport=async(method,url,token,body,headers)=>{
    if(url.endsWith('/oauth2/token')){
      renewals++;assert.equal(method,'POST');assert.equal(token,null);assert.match(headers.Authorization,/^Basic /);assert.equal(new URLSearchParams(body).get('refresh_token'),f.env.X_OAUTH_REFRESH_TOKEN);
      assert.equal((await new XTokenVault(f.settings).load(f.env.X_OAUTH_CLIENT_ID)).refreshPending,true);
      await new Promise(resolve=>setTimeout(resolve,15));return {data:next};
    }
    reads++;assert.equal(method,'GET');assert.equal(token,next.access_token);return {data:{data:identity}};
  };
  const auth=new XAuth(f.settings,transport);
  await Promise.all(Array.from({length:4},()=>auth.call('GET','https://api.x.com/2/users/me',undefined,{allowRefresh:true})));
  assert.equal(renewals,1);assert.equal(reads,4);
  const disk=await fs.readFile(path.join(f.dir,'x-oauth2.enc.json'),'utf8');for(const value of [next.access_token,next.refresh_token,f.env.X_OAUTH_REFRESH_TOKEN])assert.equal(disk.includes(value),false);
  assert.equal((await new XTokenVault(f.settings).load(f.env.X_OAUTH_CLIENT_ID)).refreshToken,next.refresh_token);
  await new XAuth(f.settings,transport).call('GET','https://api.x.com/2/users/me',undefined,{allowRefresh:true});assert.equal(renewals,1);
});
test('public-client refresh sends client_id without a client secret',async t=>{
  const f=await fixture(t,{X_OAUTH_CLIENT_SECRET:'',X_USER_ACCESS_TOKEN_EXPIRES_AT:'2000-01-01T00:00:00Z'});const next=result();
  const auth=new XAuth(f.settings,async(method,url,token,body,headers)=>{
    if(url.endsWith('/oauth2/token')){assert.equal(headers.Authorization,undefined);assert.equal(new URLSearchParams(body).get('client_id'),f.env.X_OAUTH_CLIENT_ID);return {data:next};}
    return {data:{data:identity}};
  });await auth.call('GET','https://api.x.com/2/users/me',undefined,{allowRefresh:true});
});
test('parallel identity 401 responses share one renewal; a post 401 is never replayed',async t=>{
  const f=await fixture(t),next=result();let renewals=0,posts=0;
  const auth=new XAuth(f.settings,async(method,url,token)=>{
    if(url.endsWith('/oauth2/token')){renewals++;return {data:next};}
    if(method==='POST'){posts++;throw expired();}
    if(token===f.env.X_USER_ACCESS_TOKEN){await new Promise(r=>setTimeout(r,5));throw expired();}
    return {data:{data:identity}};
  });await Promise.all([auth.call('GET','https://api.x.com/2/users/me',undefined,{allowRefresh:true}),auth.call('GET','https://api.x.com/2/users/me',undefined,{allowRefresh:true})]);assert.equal(renewals,1);
  await assert.rejects(auth.call('POST','https://api.x.com/2/tweets',{text:'synthetic'},{allowRefresh:true}),e=>e.code==='channel_auth_or_permission');assert.equal(posts,1);assert.equal(renewals,1);
});
test('uncertain renewal persists its stop marker and is not repeated across a restart',async t=>{
  const f=await fixture(t,{X_USER_ACCESS_TOKEN_EXPIRES_AT:'2000-01-01T00:00:00Z'});let calls=0;
  const transport=async()=>{calls++;throw Object.assign(Error(f.env.X_OAUTH_REFRESH_TOKEN),{status:502,code:'channel_network_failure',uncertain:true});};
  const auth=new XAuth(f.settings,transport);
  await assert.rejects(auth.call('GET','https://api.x.com/2/users/me',undefined,{allowRefresh:true}),e=>e.code==='x_refresh_reauthorization_required'&&e.phase==='x_token_refresh'&&!JSON.stringify(e).includes(f.env.X_OAUTH_REFRESH_TOKEN));
  await assert.rejects(auth.call('GET','https://api.x.com/2/users/me',undefined,{allowRefresh:true}),e=>e.code==='x_refresh_reauthorization_required');
  await assert.rejects(new XAuth(f.settings,transport).call('GET','https://api.x.com/2/users/me',undefined,{allowRefresh:true}),e=>e.code==='x_refresh_reauthorization_required');assert.equal(calls,1);
});
test('missing scopes and malformed renewal responses stop safely without account requests',async t=>{
  for(const invalid of [{...result(),scope:'tweet.read users.read'},{...result(),refresh_token:''},{...result(),expires_in:0},{...result(),token_type:'wrong'}]){
    const f=await fixture(t,{X_USER_ACCESS_TOKEN_EXPIRES_AT:'2000-01-01T00:00:00Z'});let calls=0;
    const auth=new XAuth(f.settings,async(method,url)=>{calls++;assert.equal(url,'https://api.x.com/2/oauth2/token');return {data:invalid};});
    await assert.rejects(auth.call('GET','https://api.x.com/2/users/me',undefined,{allowRefresh:true}),e=>e.code==='x_refresh_reauthorization_required');
    await assert.rejects(auth.call('GET','https://api.x.com/2/users/me',undefined,{allowRefresh:true}));assert.equal(calls,1);
  }
});
test('encrypted token files reject tampering, a different client, and a different encryption key',async t=>{
  const f=await fixture(t),vault=new XTokenVault(f.settings),state={clientId:f.env.X_OAUTH_CLIENT_ID,accessToken:random(),refreshToken:random(),expiresAt:Date.now()+7200000,refreshPending:false};
  await vault.save(state);await assert.rejects(vault.load(random()),e=>e.code==='x_token_storage_unavailable');
  await assert.rejects(new XTokenVault({...f.settings,env:{...f.env,X_TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('hex')}}).load(state.clientId),e=>e.code==='x_token_storage_unavailable');
  const file=path.join(f.dir,'x-oauth2.enc.json'),value=JSON.parse(await fs.readFile(file,'utf8'));value.tag='0'.repeat(32);await fs.writeFile(file,JSON.stringify(value));await assert.rejects(vault.load(state.clientId),e=>e.code==='x_token_storage_unavailable');
});
test('failure to store refresh intent blocks the outbound refresh before it is sent',async t=>{
  const f=await fixture(t,{X_USER_ACCESS_TOKEN_EXPIRES_AT:'2000-01-01T00:00:00Z'});let calls=0;
  const auth=new XAuth(f.settings,async()=>{calls++;},{vault:{load:async()=>null,save:async()=>{throw Object.assign(Error(),{status:503,code:'x_token_storage_unavailable'});}}});
  await assert.rejects(auth.call('GET','https://api.x.com/2/users/me',undefined,{allowRefresh:true}),e=>e.code==='x_token_storage_unavailable');assert.equal(calls,0);
});
test('X errors retain only bounded codes and phases, never upstream messages or credentials',async()=>{
  const marker=random(),response={status:401,data:{errors:[{code:89,message:marker}],detail:marker},headers:{Authorization:marker}};
  const safe=providerFailure(response,'GET','api.x.com');assert.deepEqual(safe.providerDetails,{httpStatus:401,providerCode:89});assert.equal(safe.code,'channel_auth_or_permission');
  assert.deepEqual(failureDetails({phase:'x_identity',providerDetails:{...safe.providerDetails,message:marker,type:marker,url:marker}}),{httpStatus:401,providerCode:89,phase:'x_identity'});
  await assert.rejects(request('GET','https://api.x.com/2/users/me',marker,undefined,{},async()=>response),e=>!JSON.stringify(e).includes(marker));
  const original=console.error,logs=[];console.error=value=>logs.push(value);
  try{logJobFailure({channel:'x',error:'channel_auth_or_permission'},{phase:'x_identity',...safe.providerDetails,token:marker});}finally{console.error=original;}
  assert.equal(JSON.parse(logs[0]).channel,'x');assert.equal(logs[0].includes(marker),false);
});
test('X jobs preserve explicit retry before writes, block uncertain replay and retain deduplication',async t=>{
  const f=await fixture(t),store=new Store(f.settings);await store.init();let posts=0,afterWrite=false;
  const connectors={availability:()=>({x:true,blog:true}),publish:async(job,ctx)=>{if(afterWrite){posts++;await ctx.beforePublication({});}throw Object.assign(expired(),{phase:afterWrite?'x_link_create':'x_identity'});}};
  const service=new Service({settings:f.settings,store,connectors,media:{}});service.jobs.failureLogger=()=>{};
  const [first]=await service.jobs.create(draft);await service.jobs.start([first.id]);await service.jobs.tail;let job=(await service.jobs.list())[0];assert.equal(job.status,'failed');assert.equal(job.canRetry,true);assert.equal(job.errorDetails.phase,'x_identity');assert.equal(posts,0);
  await service.jobs.retry(first.id);afterWrite=true;await service.jobs.start([first.id]);await service.jobs.tail;job=(await service.jobs.list())[0];assert.equal(job.status,'unknown');assert.equal(job.canRetry,false);assert.equal(job.errorDetails.phase,'x_link_create');assert.equal(posts,1);
  await assert.rejects(service.jobs.retry(first.id),e=>e.code==='check_channel_before_retry');assert.equal((await service.jobs.create(draft))[0].id,first.id);assert.equal(posts,1);
});
test('a successful OAuth 1.0a X link post is checked once and retained across duplicate preparation and restart',async t=>{
  const f=await fixture(t,{...one}),calls=[];
  const connectors=new Connectors(f.settings,{request:async(method,url,token,body,headers)=>{
    calls.push({method,url});assert.equal(token,null);assert.match(headers.Authorization,/^OAuth /);
    if(url.endsWith('/users/me'))return {data:{data:identity}};
    if(method==='POST'){assert.equal(url,'https://api.x.com/2/tweets');assert.deepEqual(body,{text:draft.xText+'\n\n'+draft.youtubeUrl});return {data:{data:{id:'123456789099999'}}};}
    assert.equal(url,'https://api.x.com/2/tweets/123456789099999');return {data:{data:{id:'123456789099999'}}};
  }});
  const store=new Store(f.settings),service=new Service({settings:f.settings,store,connectors,media:{}}),[job]=await service.jobs.create(draft);
  await service.jobs.start([job.id]);await service.jobs.tail;
  const saved=(await service.jobs.list())[0];assert.equal(saved.status,'succeeded');assert.equal(saved.result.url,'https://x.com/spymedia_kor/status/123456789099999');assert.equal(calls.filter(c=>c.method==='POST').length,1);assert.ok(calls.every(c=>!c.url.includes('media')));
  assert.equal((await service.jobs.create(draft))[0].id,job.id);await assert.rejects(service.jobs.start([job.id]),e=>e.code==='job_not_ready');
  const restarted=new Service({settings:f.settings,store:new Store(f.settings),connectors,media:{}});assert.equal((await restarted.jobs.create(draft))[0].id,job.id);assert.equal((await restarted.jobs.list())[0].status,'succeeded');assert.equal(calls.length,3);
});
test('X creation and verification failures retain their phase and never repeat a write',async()=>{
  for(const phase of ['x_link_create','x_link_verify']){
    let writes=0;const c=new Connectors({env:staticEnv,publishingEnabled:true},{request:async(method,url)=>{
      if(url.endsWith('/users/me'))return {data:{data:identity}};
      if(method==='POST'){writes++;if(phase==='x_link_create')throw Object.assign(expired(),{uncertain:true});return {data:{data:{id:'123456789099999'}}};}
      return {data:{data:{id:'another-post'}}};
    }});
    await assert.rejects(c.publish({type:'link',channel:'x',input:draft,assets:[]},{beforePublication:async()=>{},checkpoint:async()=>{}}),e=>e.phase===phase);assert.equal(writes,1);
  }
});
test('X diagnosis prevents overlap even after its cooldown has elapsed',async t=>{
  const f=await fixture(t);let now=1000,calls=0,resolve;
  const service=new Service({settings:f.settings,store:new Store(f.settings),media:{},diagnosticNow:()=>now,connectors:{availability:()=>({x:true}),checkXConnection:async()=>{calls++;await new Promise(r=>resolve=r);return {userId:identity.id,username:identity.username,identityVerified:true};}}});
  const first=service.checkXConnection();now+=60000;await assert.rejects(service.checkXConnection(),e=>e.code==='x_check_rate_limited');assert.equal(calls,1);resolve();await first;
});
test('X connection endpoint requires a session, Origin, CSRF and empty input; shares its 60-second limit',async t=>{
  const f=await fixture(t),store=new Store(f.settings);await store.init();let now=1000,calls=0,fail=false;
  const secretMarker=random(),connectors={availability:()=>({x:true,blog:true}),checkXConnection:async()=>{calls++;if(fail)throw Object.assign(expired(),{phase:'x_identity',message:secretMarker});return {userId:identity.id,username:identity.username,identityVerified:true,authMode:'oauth1',publishingPermissionsVerified:true,refreshConfigured:false,publishingEnabled:true,token:secretMarker};}};
  const service=new Service({settings:f.settings,store,connectors,media:{},diagnosticNow:()=>now});
  const salt=randomBytes(16),password=random(),handler=createAdminHandler({mode:'authenticated',username:'synthetic',passwordHash:salt.toString('hex')+':'+scryptSync(password,salt,64).toString('hex'),secureCookie:false,service});
  const server=http.createServer((req,res)=>handler(req,res).then(done=>{if(!done){res.writeHead(404);res.end();}}));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const base='http://127.0.0.1:'+server.address().port,route='/api/admin/x/check',fetchLocal=(p=route,opts={})=>fetch(base+p,opts);
  assert.equal((await fetchLocal(route,{method:'POST'})).status,401);assert.equal(calls,0);assert.equal((await(await fetchLocal('/api/admin/status')).json()).xConnection,undefined);
  const login=await fetchLocal('/api/admin/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({username:'synthetic',password})}),cookie=login.headers.get('set-cookie').split(';')[0];
  const status=await(await fetchLocal('/api/admin/status',{headers:{Cookie:cookie}})).json(),headers={Cookie:cookie,Origin:base,'X-CSRF-Token':status.csrfToken,'Content-Type':'application/json'};
  for(const altered of [{...headers,Origin:'https://evil.invalid'},{...headers,'X-CSRF-Token':''}])assert.equal((await fetchLocal(route,{method:'POST',headers:altered,body:'{}'})).status,403);
  for(const body of ['[]','null',JSON.stringify({token:secretMarker})])assert.equal((await fetchLocal(route,{method:'POST',headers,body})).status,400);
  assert.equal((await fetchLocal(route+'?token='+secretMarker,{method:'POST',headers,body:'{}'})).status,400);assert.equal((await fetchLocal(route,{headers:{Cookie:cookie}})).status,404);assert.equal(calls,0);
  const success=await(await fetchLocal(route,{method:'POST',headers,body:'{}'})).json();assert.equal(success.connection.publishingPermissionsVerified,false);assert.equal(JSON.stringify(success).includes(secretMarker),false);assert.equal(calls,1);
  const limited=await fetchLocal(route,{method:'POST',headers,body:'{}'});assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'60');assert.equal(calls,1);
  now+=60000;fail=true;const failure=await fetchLocal(route,{method:'POST',headers,body:'{}'});assert.equal(failure.status,409);const safe=await failure.text();assert.equal(safe.includes(secretMarker),false);assert.equal(JSON.parse(safe).details.phase,'x_identity');assert.equal(calls,2);
  assert.equal((await fetchLocal(route,{method:'POST',headers,body:'{}'})).status,429);assert.equal(calls,2);
});
