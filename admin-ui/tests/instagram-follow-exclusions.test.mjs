import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {randomBytes,scryptSync} from 'node:crypto';
import {config} from '../backend/config.cjs';
import {Store} from '../backend/store.cjs';
import {Service} from '../backend/service.cjs';
import {InstagramFollowExclusions,ACCOUNT,KEY,MAX_RECORDS} from '../backend/instagram-follow-exclusions.cjs';
import {createAdminHandler} from '../server-core.cjs';
const body=(username='fixture',state='followed')=>({account:ACCOUNT,items:[{username,state}]});
const invalid=e=>e.status===400&&e.code==='invalid_follow_exclusion';
const item=(url,kind='profile')=>({url,kind,title:'temporary title',snippet:'temporary snippet'});
async function fixture(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'spymedia-follow-exclusions-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const settings=config({SNS_DATA_DIR:dir,SNS_STORAGE_PERSISTENCE:'confirmed',SNS_SINGLE_INSTANCE:'confirmed'}),store=new Store(settings);
  await store.init();
  let now='2026-10-16T12:00:00.000Z';const exclusions=new InstagramFollowExclusions(store,{now:()=>now});
  return {dir,settings,store,exclusions,time:value=>now=value};
}

test('old journal needs no migration; save only actor-scoped normalized name/status/date and survive restart',async t=>{
  const f=await fixture(t);f.store.state.extra={keep:true};await f.store.save();
  const previous=await fs.readFile(path.join(f.dir,'journal.json'),'utf8');
  assert.deepEqual(await f.exclusions.list(),{account:ACCOUNT,items:[]});
  assert.equal(await fs.readFile(path.join(f.dir,'journal.json'),'utf8'),previous);
  assert.deepEqual(await f.exclusions.save({account:ACCOUNT,items:[{username:'@Fixture',state:'followed'},{username:'https://instagram.com/fixture/?igsh=tracking',state:'following'},{username:'Other',state:'request_sent'}]}),{saved:2});
  const persisted=JSON.parse(await fs.readFile(path.join(f.dir,'journal.json'),'utf8'));
  assert.deepEqual(Object.keys(persisted[KEY]),[ACCOUNT]);
  assert.deepEqual(persisted[KEY][ACCOUNT],{fixture:{username:'fixture',state:'following',confirmedAt:'2026-10-16T12:00:00.000Z'},other:{username:'other',state:'requested',confirmedAt:'2026-10-16T12:00:00.000Z'}});
  delete persisted[KEY];assert.deepEqual(persisted,JSON.parse(previous));
  const restart=new InstagramFollowExclusions(new Store(f.settings));
  assert.deepEqual(await restart.list(),await f.exclusions.list());
});

test('prototype-like usernames remain own data records across restart and removal',async t=>{
  const f=await fixture(t);
  await f.exclusions.save({account:ACCOUNT,items:['__proto__','constructor'].map(username=>({username,state:'following'}))});
  const restarted=new InstagramFollowExclusions(new Store(f.settings));
  assert.deepEqual((await restarted.list()).items.map(entry=>entry.username).sort(),['__proto__','constructor']);
  const result=await restarted.filter('instagram',{items:['__proto__','constructor','ordinary'].map(name=>item('https://www.instagram.com/'+name+'/')),page:0,hasMore:false});
  assert.equal(result.excludedCount,2);assert.equal(result.items.length,1);
  assert.deepEqual(await restarted.remove({account:ACCOUNT,username:'__proto__'}),{removed:true});
  assert.deepEqual((await restarted.list()).items.map(entry=>entry.username),['constructor']);
  assert.equal({}.username,undefined);
});

test('save is idempotent; requested can become following, but retries never downgrade or move confirmation dates',async t=>{
  const f=await fixture(t);await f.exclusions.save(body('fixture','requested'));
  const first=await f.exclusions.list();f.time('2026-10-16T13:00:00.000Z');
  await f.exclusions.save(body('FIXTURE','request_sent'));assert.deepEqual(await f.exclusions.list(),first);
  await f.exclusions.save(body('fixture','followed'));
  const followed=await f.exclusions.list();assert.equal(followed.items[0].state,'following');assert.equal(followed.items[0].confirmedAt,'2026-10-16T13:00:00.000Z');
  f.time('2026-10-16T14:00:00.000Z');await f.exclusions.save(body('fixture','requested'));assert.deepEqual(await f.exclusions.list(),followed);
  await Promise.all([f.exclusions.save(body('parallel_a')),f.exclusions.save(body('parallel_b'))]);assert.equal((await f.exclusions.list()).items.length,3);
});

test('invalid/uncertain outcomes, extra fields, other actor, posts and unsafe URLs cannot create exclusions',async t=>{
  const f=await fixture(t),before=await fs.readFile(path.join(f.dir,'journal.json'),'utf8');
  const bad=[null,[],{}, {...body(),account:'other_actor'},{...body(),keyword:'never retain'},{...body(),items:[]},{...body(),items:Array.from({length:11},()=>({username:'fixture',state:'following'}))},...['follow','pending','uncertain','failed','account_unverified',null,false].map(state=>body('fixture',state)),...['spymedia_kr','p','reel','tv','..','foo?x','foo#x','foo/bar','@','name\n','https://instagram.com/p/ABC/','https://evil.invalid/fixture/','https://u:p@instagram.com/fixture/','https://instagram.com:8443/fixture/','https://instagram.com/fixture%2fother/'].map(name=>body(name)),{account:ACCOUNT,items:[{username:'fixture',state:'following',snippet:'never retain'}]}];
  for(const value of bad)await assert.rejects(()=>f.exclusions.save(value),invalid);
  assert.deepEqual((await f.exclusions.list()).items,[]);assert.equal(await fs.readFile(path.join(f.dir,'journal.json'),'utf8'),before);
});

test('only known Instagram profiles are filtered; pagination preserved and no additional provider request or query persistence',async t=>{
  const f=await fixture(t);await f.exclusions.save({account:ACCOUNT,items:[{username:'fixture',state:'following'},{username:'other',state:'requested'}]});
  let calls=0;const result={items:[item('https://instagram.com/FIXTURE/?tracking=1'),item('https://www.instagram.com/other/'),item('https://www.instagram.com/unknown/'),item('https://www.instagram.com/p/FIXTURE/','post'),item('https://evil.invalid/fixture/')],page:4,hasMore:true,paginationKnown:true,limitReached:false,pageSize:10,resultsPerRequest:20,omitted:2};
  const search={describe:()=>({ready:true}),search:async()=>{calls++;return result;}};
  const service=new Service({settings:f.settings,store:f.store,temporarySearch:search});
  const before=await fs.readFile(path.join(f.dir,'journal.json'),'utf8');
  const filtered=await service.searchTemporaryAccounts({platform:'instagram',keyword:'never retain query',region:'never retain region',page:4});
  assert.deepEqual(filtered,{...result,items:result.items.slice(2),excludedCount:2});assert.equal(calls,1);assert.equal(result.items.length,5);
  for(const platform of ['x','facebook','blog'])assert.deepEqual(await service.searchTemporaryAccounts({platform}),{...result,excludedCount:0});
  assert.equal(calls,4);assert.equal(await fs.readFile(path.join(f.dir,'journal.json'),'utf8'),before);
  const all=await f.exclusions.filter('instagram',{...result,items:result.items.slice(0,2)});assert.equal(all.items.length,0);assert.equal(all.hasMore,true);assert.equal(all.page,4);assert.equal(all.excludedCount,2);
});

test('remove only restores future search visibility without external action, and failed persistence rolls back memory',async t=>{
  const f=await fixture(t);await f.exclusions.save(body());
  const prior=await f.exclusions.list(),oldSave=f.store.save.bind(f.store);f.store.save=async()=>{throw Error('synthetic disk failure');};
  await assert.rejects(()=>f.exclusions.save(body('second')),/synthetic disk failure/);assert.deepEqual(await f.exclusions.list(),prior);
  await assert.rejects(()=>f.exclusions.remove({account:ACCOUNT,username:'fixture'}),/synthetic disk failure/);assert.deepEqual(await f.exclusions.list(),prior);
  f.store.save=oldSave;
  assert.deepEqual(await f.exclusions.remove({account:ACCOUNT,username:'https://www.instagram.com/FIXTURE/'}),{removed:true});
  assert.deepEqual(await f.exclusions.remove({account:ACCOUNT,username:'fixture'}),{removed:false});
  assert.deepEqual(await new InstagramFollowExclusions(new Store(f.settings)).list(),{account:ACCOUNT,items:[]});
  await assert.rejects(()=>f.exclusions.remove({account:'wrong',username:'fixture'}),invalid);
});

test('record limit permits idempotent retries but rejects new entries atomically; storage failure prevents paid query',async t=>{
  const f=await fixture(t);f.store.state[KEY]={[ACCOUNT]:Object.fromEntries(Array.from({length:MAX_RECORDS},(_,i)=>['fixture_'+i,{username:'fixture_'+i,state:'following',confirmedAt:'2026-10-16T12:00:00.000Z'}]))};
  assert.deepEqual(await f.exclusions.save(body('fixture_0')),{saved:1});
  await assert.rejects(()=>f.exclusions.save(body('overflow')),e=>e.code==='follow_exclusion_limit'&&e.status===409);assert.equal((await f.exclusions.list()).items.length,MAX_RECORDS);
  let calls=0;const service=new Service({settings:f.settings,store:f.store,temporarySearch:{search:async()=>{calls++;return {items:[]};}}});
  f.store.state[KEY]=null;
  await assert.rejects(()=>service.searchTemporaryAccounts({platform:'instagram'}),e=>e.code==='storage_unavailable');assert.equal(calls,0);
});

test('HTTP exclusion routes require authenticated session, same origin, CSRF for mutations, and reject query input',async t=>{
  const f=await fixture(t),service=new Service({settings:f.settings,store:f.store}),salt=randomBytes(16),password=randomBytes(24).toString('hex');
  const handler=createAdminHandler({mode:'authenticated',username:'fixture',passwordHash:salt.toString('hex')+':'+scryptSync(password,salt,64).toString('hex'),secureCookie:false,service});
  const server=http.createServer((req,res)=>handler(req,res).then(done=>{if(!done){res.writeHead(404);res.end();}}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const origin='http://127.0.0.1:'+server.address().port,route='/api/admin/instagram/follow-exclusions';
  const login=await fetch(origin+'/api/admin/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'fixture',password})});
  const Cookie=login.headers.get('set-cookie').split(';')[0],status=await(await fetch(origin+'/api/admin/status',{headers:{Cookie}})).json();
  const headers={Cookie,Origin:origin,'Content-Type':'application/json','X-CSRF-Token':status.csrfToken};
  const request=(method,value,patch={},suffix='')=>fetch(origin+route+suffix,{method,headers:{...headers,...patch},...(value?{body:JSON.stringify(value)}:{})});
  for(const method of ['GET','POST','DELETE'])assert.equal((await request(method,method==='POST'?body():method==='DELETE'?{account:ACCOUNT,username:'fixture'}:null,{Cookie:''})).status,401);
  for(const method of ['POST','DELETE'])for(const patch of [{'X-CSRF-Token':''},{Origin:'https://evil.invalid'}])assert.equal((await request(method,body(),patch)).status,403);
  assert.equal((await request('POST',body(),{'Content-Type':'text/plain'})).status,415);
  assert.equal((await request('GET',null,{},'?account=other')).status,400);
  assert.equal((await request('POST',body(),{},'?ignored=1')).status,400);
  const saved=await request('POST',body());assert.equal(saved.status,200);assert.equal(saved.headers.get('cache-control'),'no-store');assert.deepEqual(await saved.json(),{saved:1});
  const listed=await(await request('GET')).json();assert.equal(listed.account,ACCOUNT);assert.equal(listed.items[0].username,'fixture');
  assert.deepEqual(await(await request('DELETE',{account:ACCOUNT,username:'fixture'})).json(),{removed:true});assert.deepEqual((await(await request('GET')).json()).items,[]);
});
