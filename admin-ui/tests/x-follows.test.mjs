import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {config} from '../backend/config.cjs';
import {Store} from '../backend/store.cjs';
import {XFollows,TTL,PREPARE_INTERVAL} from '../backend/x-follows.cjs';
import {XAuth} from '../backend/x-auth.cjs';

const rejects=(code,status)=>e=>e.code===code&&(status===undefined||e.status===status);
const confirmation=p=>({preparationId:p.preparationId,confirmationToken:p.confirmationToken,confirmUsername:p.target.username,confirmTargetUserId:p.target.userId,confirmed:true});
async function fixture(t,options={}) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'spymedia-x-follow-test-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const settings=config({SNS_DATA_DIR:dir,SNS_STORAGE_PERSISTENCE:'confirmed',SNS_SINGLE_INSTANCE:'confirmed',X_FOLLOW_ENABLED:'true',X_COST_LIMIT_ACKNOWLEDGED:'true',...options.env});
  const store=new Store(settings),calls=[];let now=Date.parse('2026-10-16T01:00:00Z');
  const auth={configured:()=>true,call:async(method,url,body,opts)=>{
    calls.push({method,url,body,opts});
    if(options.call)return options.call(method,url,body,opts);
    if(url.endsWith('/users/me'))return {data:{data:{id:'10001',username:'spymedia_kor'}}};
    if(method==='GET')return {data:{data:{id:'20002',username:'FixtureTarget',name:'합성 테스트 계정'}}};
    return {data:{data:{following:true,pending_follow:false}}};
  }};
  const follows=new XFollows(settings,store,auth,{now:()=>now});
  return {dir,settings,store,auth,follows,calls,tick:n=>now+=n,posts:()=>calls.filter(c=>c.method==='POST')};
}

test('feature defaults off and refuses paid/invalid auth/storage operations without provider calls',async t=>{
  for(const [env,code] of [[{X_FOLLOW_ENABLED:undefined},'x_follow_disabled'],[{X_COST_LIMIT_ACKNOWLEDGED:'false'},'x_cost_confirmation_required'],[{SNS_SINGLE_INSTANCE:'no'},'x_follow_storage_unavailable']]) {
    const f=await fixture(t,{env});assert.equal(f.follows.status().ready,false);
    await assert.rejects(()=>f.follows.prepare({username:'fixturetarget'}),rejects(code));assert.equal(f.calls.length,0);
  }
  const f=await fixture(t);f.auth.configured=()=>false;
  await assert.rejects(()=>f.follows.prepare({username:'fixturetarget'}),rejects('x_follow_auth_required'));assert.equal(f.calls.length,0);
});

test('status never claims verified follow permission or changes existing publish settings',async t=>{
  const f=await fixture(t),before={...f.settings.env},state=f.follows.status();
  assert.equal(state.ready,true);assert.equal(state.followPermissionsVerified,false);assert.equal(state.mode,'single-reviewed-target');
  assert.deepEqual(state.requiredOAuth2Scopes,['tweet.read','users.read','follows.write']);assert.deepEqual(f.settings.env,before);assert.equal(f.calls.length,0);
});

test('prepare verifies exact source and target with GET only, storing no search profile details',async t=>{
  const f=await fixture(t),p=await f.follows.prepare({username:'FixtureTarget'});
  assert.equal(p.source.username,'spymedia_kor');assert.equal(p.target.userId,'20002');assert.equal(p.target.username,'FixtureTarget');assert.equal(p.existingResult,null);
  assert.equal(f.calls.length,2);assert.ok(f.calls.every(c=>c.method==='GET'&&c.opts.allowRefresh===false));assert.equal(f.posts().length,0);
  const saved=await fs.readFile(path.join(f.dir,'journal.json'),'utf8');
  for(const secret of ['FixtureTarget','합성 테스트','https://x.com',p.confirmationToken,p.preparationId])assert.equal(saved.includes(secret),false);
});

test('one confirmed target makes one official POST, writes intent before it, and preserves unrelated journal data',async t=>{
  const f=await fixture(t);await f.store.init();f.store.state.other={keep:true};await f.store.save();
  const p=await f.follows.prepare({username:'fixturetarget'}),original=f.auth.call;
  f.auth.call=async(...args)=>{
    if(args[0]==='POST') {
      const saved=JSON.parse(await fs.readFile(path.join(f.dir,'journal.json'),'utf8'));
      assert.equal(Object.values(saved.xFollows.records)[0].status,'unknown');assert.deepEqual(saved.other,{keep:true});
    }
    return original(...args);
  };
  const outcome=await f.follows.execute(confirmation(p));assert.equal(outcome.status,'followed');
  assert.deepEqual(f.posts().map(({url,body,opts})=>({url,body,opts})),[{url:'https://api.x.com/2/users/10001/following',body:{target_user_id:'20002'},opts:{allowRefresh:false}}]);
  assert.deepEqual(await f.follows.result(outcome.operationId),outcome);
  const text=await fs.readFile(path.join(f.dir,'journal.json'),'utf8');
  for(const forbidden of ['FixtureTarget','fixturetarget','합성 테스트','https://x.com',p.confirmationToken,p.preparationId])assert.equal(text.includes(forbidden),false);
});

test('self-follow, wrong caller, wrong target identity and malformed inputs never post',async t=>{
  for(const response of [{source:{id:'10001',username:'wrong'}},{target:{id:'10001',username:'fixturetarget'}},{target:{id:'20002',username:'different'}},{source:{id:null,username:'spymedia_kor'}}]) {
    const f=await fixture(t,{call:async(method,url)=>({data:{data:url.endsWith('/users/me')?(response.source||{id:'10001',username:'spymedia_kor'}):(response.target||{id:'20002',username:'fixturetarget'})}})});
    await assert.rejects(()=>f.follows.prepare({username:'fixturetarget'}));assert.equal(f.posts().length,0);
  }
  const f=await fixture(t);
  for(const body of [{username:'https://x.com/target'},{username:'a',targets:['b']},{username:['fixturetarget']},{username:'a\nb'},null,{username:'a'.repeat(16)},{}])await assert.rejects(()=>f.follows.prepare(body),rejects('invalid_x_follow_input'));
  assert.equal(f.calls.length,0);
});

test('execution requires exact per-account confirmation and cannot accept lists or queue work',async t=>{
  const f=await fixture(t),p=await f.follows.prepare({username:'fixturetarget'}),body=confirmation(p);
  for(const patch of [{confirmed:false},{confirmUsername:'another'},{confirmTargetUserId:'98765'},{confirmationToken:'0'.repeat(64)},{targets:['fixturetarget']},{preparationId:randomUUID()}])await assert.rejects(()=>f.follows.execute({...body,...patch}));
  assert.equal(f.posts().length,0);assert.equal(f.calls.length,2);
});

test('expired confirmation cannot post and read lookup throttles repeated prepare requests',async t=>{
  const f=await fixture(t),p=await f.follows.prepare({username:'fixturetarget'});
  await assert.rejects(()=>f.follows.prepare({username:'fixturetarget'}),rejects('x_follow_prepare_rate_limited',429));
  f.tick(TTL+1);await assert.rejects(()=>f.follows.execute(confirmation(p)),rejects('x_follow_preparation_expired'));assert.equal(f.posts().length,0);
});

test('source identity changes between preparation and confirmation stop the write',async t=>{
  const f=await fixture(t),p=await f.follows.prepare({username:'fixturetarget'});
  f.auth.call=async()=>({data:{data:{id:'99999',username:'spymedia_kor'}}});
  await assert.rejects(()=>f.follows.execute(confirmation(p)),rejects('account_mismatch'));assert.equal(f.posts().length,0);
});

test('concurrent clicks and replay after restart never make a second POST for a recorded target',async t=>{
  const f=await fixture(t),p=await f.follows.prepare({username:'fixturetarget'});
  const results=await Promise.allSettled([f.follows.execute(confirmation(p)),f.follows.execute(confirmation(p))]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'x_follow_busy');assert.equal(f.posts().length,1);
  const replay=await f.follows.execute(confirmation(p));assert.equal(replay.duplicatePrevented,true);assert.equal(f.posts().length,1);
  const restarted=new XFollows(f.settings,new Store(f.settings),f.auth);
  const p2=await restarted.prepare({username:'fixturetarget'});assert.equal(p2.existingResult.status,'followed');
  assert.equal((await restarted.execute(confirmation(p2))).duplicatePrevented,true);assert.equal(f.posts().length,1);
});

test('protected account follow request is distinct from completed following',async t=>{
  const f=await fixture(t),p=await f.follows.prepare({username:'fixturetarget'}),original=f.auth.call;
  f.auth.call=(...args)=>args[0]==='POST'?Promise.resolve({data:{data:{following:false,pending_follow:true}}}):original(...args);
  assert.equal((await f.follows.execute(confirmation(p))).status,'requested');
});

test('network uncertainty and malformed success remain unknown across restart and cannot be retried',async t=>{
  for(const failure of ['network','malformed']) {
    const f=await fixture(t),p=await f.follows.prepare({username:'fixturetarget'}),original=f.auth.call;let posts=0;
    f.auth.call=async(...args)=>{
      if(args[0]!=='POST')return original(...args);posts++;
      if(failure==='network')throw Object.assign(Error('SECRET_TOKEN raw provider message'),{status:502,providerDetails:{httpStatus:503,message:'SECRET_TOKEN'}});
      return {data:{data:{following:true}}};
    };
    const outcome=await f.follows.execute(confirmation(p));assert.equal(outcome.status,'unknown');assert.equal(outcome.errorCode,'x_follow_result_unknown');
    const restarted=new XFollows(f.settings,new Store(f.settings),f.auth),p2=await restarted.prepare({username:'fixturetarget'});
    assert.equal((await restarted.execute(confirmation(p2))).duplicatePrevented,true);assert.equal(posts,1);
    assert.equal((await fs.readFile(path.join(f.dir,'journal.json'),'utf8')).includes('SECRET_TOKEN'),false);
  }
});

test('definite authorization or limit rejection is sanitized, retained, and never automatically retried',async t=>{
  for(const [status,code] of [[401,'x_follow_auth_required'],[402,'x_follow_cost_required'],[403,'x_follow_permission_required'],[429,'x_follow_rate_limited']]) {
    const f=await fixture(t),p=await f.follows.prepare({username:'fixturetarget'}),original=f.auth.call;let posts=0;
    f.auth.call=async(...args)=>{if(args[0]!=='POST')return original(...args);posts++;throw Object.assign(Error('SECRET_TOKEN'),{providerDetails:{httpStatus:status,body:'SECRET_TOKEN'}});};
    const outcome=await f.follows.execute(confirmation(p));assert.equal(outcome.status,'failed');assert.equal(outcome.errorCode,code);
    assert.equal((await f.follows.execute(confirmation(p))).duplicatePrevented,true);assert.equal(posts,1);assert.equal(JSON.stringify(outcome).includes('SECRET_TOKEN'),false);
  }
});

test('initial journal failure prevents a POST and final save failure retains durable unknown intent',async t=>{
  const before=await fixture(t),p=await before.follows.prepare({username:'fixturetarget'});
  before.store.save=async()=>{throw Error('disk full SECRET');};
  await assert.rejects(()=>before.follows.execute(confirmation(p)),rejects('x_follow_storage_unavailable'));assert.equal(before.posts().length,0);assert.equal(before.store.state.xFollows,undefined);
  const after=await fixture(t),p2=await after.follows.prepare({username:'fixturetarget'}),save=after.store.save.bind(after.store);let saves=0;
  after.store.save=async()=>{saves++;if(saves===2)throw Error('disk full');return save();};
  const outcome=await after.follows.execute(confirmation(p2));assert.equal(outcome.status,'unknown');assert.equal(outcome.resultPersistenceFailed,true);assert.equal(after.posts().length,1);
  assert.equal(Object.values(JSON.parse(await fs.readFile(path.join(after.dir,'journal.json'),'utf8')).xFollows.records)[0].status,'unknown');
  assert.equal((await after.follows.execute(confirmation(p2))).duplicatePrevented,true);assert.equal(after.posts().length,1);
});

test('disabled feature also blocks prepared operations, and token expiration never refreshes automatically',async t=>{
  const f=await fixture(t),p=await f.follows.prepare({username:'fixturetarget'});
  f.settings.env.X_FOLLOW_ENABLED='false';await assert.rejects(()=>f.follows.execute(confirmation(p)),rejects('x_follow_disabled'));assert.equal(f.posts().length,0);
  f.settings.env.X_FOLLOW_ENABLED='true';f.auth.call=async()=>{throw Object.assign(Error('token secret'),{status:409,code:'x_auth_expired'});};
  await assert.rejects(()=>f.follows.execute(confirmation(p)),rejects('x_follow_auth_required'));assert.equal(f.posts().length,0);
});

test('read-only result lookup validates opaque IDs and malformed persisted records fail closed',async t=>{
  const f=await fixture(t);
  for(const id of ['../journal.json',{},randomUUID()])await assert.rejects(()=>f.follows.result(id),rejects('not_found'));
  f.store.state.xFollows={version:1,records:{bad:{id:randomUUID(),status:'followed',username:'never expose'}}};
  await assert.rejects(()=>f.follows.prepare({username:'fixturetarget'}),rejects('x_follow_storage_unavailable'));assert.equal(f.calls.length,0);
});

test('prepared state is bounded and expires without durable profile metadata',async t=>{
  const f=await fixture(t);
  for(let i=0;i<10;i++){await f.follows.prepare({username:'fixturetarget'});f.tick(PREPARE_INTERVAL);}
  await assert.rejects(()=>f.follows.prepare({username:'fixturetarget'}),rejects('x_follow_preparation_limit'));
  f.tick(TTL+1);await f.follows.prepare({username:'fixturetarget'});assert.equal(f.follows.preparations.size,1);assert.equal(f.posts().length,0);
});

test('search selection lifetime caps preparation and scheduled expiry removes profile identity while idle',async t=>{
  const f=await fixture(t),timers=[];
  f.follows.schedule=(callback,delay)=>timers.push({callback,delay});
  const selectionExpiresAt=f.follows.now()+1000;
  const p=await f.follows.prepare({username:'fixturetarget',selectionExpiresAt});
  assert.equal(Date.parse(p.expiresAt),selectionExpiresAt);assert.equal(timers[0].delay,1000);
  timers[0].callback();assert.equal(f.follows.preparations.size,0);
  await assert.rejects(()=>f.follows.execute(confirmation(p)),rejects('x_follow_preparation_expired'));
  for(const value of [0,'2026-10-16',f.follows.now()+16*60*1000])await assert.rejects(()=>f.follows.prepare({username:'fixturetarget',selectionExpiresAt:value}));
  assert.equal(f.posts().length,0);
});

test('provider authentication and cost errors cannot masquerade as expired administrator sessions',async t=>{
  for(const [status,code] of [[401,'x_follow_auth_required'],[402,'x_follow_cost_required'],[403,'x_follow_permission_required']]) {
    const f=await fixture(t,{call:async()=>{throw Object.assign(Error('raw SECRET'),{status,providerDetails:{httpStatus:status,body:'raw SECRET'}});}});
    await assert.rejects(()=>f.follows.prepare({username:'fixturetarget'}),e=>e.status===409&&e.code===code&&!JSON.stringify(e).includes('SECRET'));
    assert.equal(f.posts().length,0);
  }
});

test('shared persistent transaction prevents two service objects from posting the same target',async t=>{
  const f=await fixture(t),other=new XFollows(f.settings,f.store,f.auth,{now:f.follows.now});
  const a=await f.follows.prepare({username:'fixturetarget'}),b=await other.prepare({username:'fixturetarget'});
  const outcomes=await Promise.all([f.follows.execute(confirmation(a)),other.execute(confirmation(b))]);
  assert.equal(f.posts().length,1);assert.ok(outcomes.some(item=>item.duplicatePrevented));
});

test('pending flag takes precedence over following so no protected-account request is shown as completed',async t=>{
  const f=await fixture(t),p=await f.follows.prepare({username:'fixturetarget'}),original=f.auth.call;
  f.auth.call=(...args)=>args[0]==='POST'?Promise.resolve({data:{data:{following:true,pending_follow:true}}}):original(...args);
  assert.equal((await f.follows.execute(confirmation(p))).status,'requested');
});

test('existing OAuth 1.0a signer authorizes identity, target lookup and single follow without refresh',async t=>{
  const f=await fixture(t,{env:{X_AUTH_MODE:'oauth1',X_API_KEY:'synthetic-api-key',X_API_SECRET:'synthetic-api-secret',X_ACCESS_TOKEN:'synthetic-user-token',X_ACCESS_TOKEN_SECRET:'synthetic-token-secret'}});
  const requests=[];
  const auth=new XAuth(f.settings,async(method,url,token,body,headers)=>{
    requests.push({method,url,token,body,headers});
    assert.equal(token,null);assert.match(headers.Authorization,/^OAuth /);assert.match(headers.Authorization,/oauth_signature=/);
    if(url.endsWith('/users/me'))return {data:{data:{id:'10001',username:'spymedia_kor'}}};
    if(method==='GET')return {data:{data:{id:'20002',username:'fixturetarget'}}};
    return {data:{data:{following:true,pending_follow:false}}};
  });
  const follows=new XFollows(f.settings,f.store,auth),p=await follows.prepare({username:'fixturetarget'});
  assert.equal((await follows.execute(confirmation(p))).status,'followed');
  assert.equal(requests.filter(r=>r.method==='POST').length,1);assert.ok(requests.every(r=>!r.url.includes('/oauth2/token')));
  const persisted=await fs.readFile(path.join(f.dir,'journal.json'),'utf8');
  for(const credential of ['synthetic-api-key','synthetic-api-secret','synthetic-user-token','synthetic-token-secret','oauth_signature'])assert.equal(persisted.includes(credential),false);
});

test('existing service stubs without X auth remain compatible while follow is disabled',async t=>{
  const f=await fixture(t,{env:{X_FOLLOW_ENABLED:undefined}}),follows=new XFollows(f.settings,f.store,undefined);
  assert.equal(follows.status().ready,false);assert.equal(follows.status().credentialsConfigured,false);
  await assert.rejects(()=>follows.prepare({username:'fixturetarget'}),rejects('x_follow_disabled'));
});
