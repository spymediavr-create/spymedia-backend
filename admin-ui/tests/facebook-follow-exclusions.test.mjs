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
import {FacebookFollowExclusions,ACCOUNT,KEY,MAX_RECORDS} from '../backend/facebook-follow-exclusions.cjs';
import {InstagramFollowExclusions} from '../backend/instagram-follow-exclusions.cjs';
import {RESERVED} from '../../browser-tools/facebook-follow/core.mjs';
import {createAdminHandler} from '../server-core.cjs';
const url=name=>'https://www.facebook.com/'+name;
const body=(profileUrl=url('fixture'),state='followed')=>({account:ACCOUNT,items:[{profileUrl,state}]});
const invalid=e=>e.status===400&&e.code==='invalid_follow_exclusion';
const item=(value,kind='profile')=>({url:value,kind,title:'temporary title',snippet:'temporary snippet'});
async function fixture(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'spymedia-facebook-exclusions-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const settings=config({SNS_DATA_DIR:dir,SNS_STORAGE_PERSISTENCE:'confirmed',SNS_SINGLE_INSTANCE:'confirmed'}),store=new Store(settings);
  await store.init();
  let now='2026-10-16T12:00:00.000Z';const exclusions=new FacebookFollowExclusions(store,{now:()=>now});
  return {dir,settings,store,exclusions,time:value=>now=value};
}

test('Facebook exclusions persist only actor-scoped canonical profile/status/date and survive restart without migration',async t=>{
  const f=await fixture(t);f.store.state.extra={keep:true};await f.store.save();
  const previous=await fs.readFile(path.join(f.dir,'journal.json'),'utf8');
  assert.deepEqual(await f.exclusions.list(),{account:ACCOUNT,items:[]});
  assert.equal(await fs.readFile(path.join(f.dir,'journal.json'),'utf8'),previous);
  assert.deepEqual(await f.exclusions.save({account:ACCOUNT,items:[{profileUrl:'https://facebook.com/FiXtUrE/?fbclid=tracking',state:'followed'},{profileUrl:url('fixture'),state:'following'},{profileUrl:'https://m.facebook.com/people/Example/123456',state:'following'}]}),{saved:2});
  const persisted=JSON.parse(await fs.readFile(path.join(f.dir,'journal.json'),'utf8'));
  assert.deepEqual(Object.keys(persisted[KEY]),[ACCOUNT]);
  assert.deepEqual(persisted[KEY][ACCOUNT],{
    [url('fixture')]:{profileUrl:url('fixture'),state:'following',confirmedAt:'2026-10-16T12:00:00.000Z'},
    [url('profile.php?id=123456')]:{profileUrl:url('profile.php?id=123456'),state:'following',confirmedAt:'2026-10-16T12:00:00.000Z'}
  });
  delete persisted[KEY];assert.deepEqual(persisted,JSON.parse(previous));
  const restart=new FacebookFollowExclusions(new Store(f.settings));
  assert.deepEqual(await restart.list(),await f.exclusions.list());
});

test('Facebook aliases deduplicate numeric/people URLs and case-insensitive vanity URLs; retries preserve dates',async t=>{
  const f=await fixture(t);await f.exclusions.save(body('https://facebook.com/123456'));
  const first=await f.exclusions.list();f.time('2026-10-16T13:00:00.000Z');
  await f.exclusions.save(body('https://m.facebook.com/people/Any-Name/123456/','following'));assert.deepEqual(await f.exclusions.list(),first);
  await f.exclusions.save(body(url('profile.php?id=123456&sk=about')));assert.deepEqual(await f.exclusions.list(),first);
  await Promise.all([f.exclusions.save(body(url('parallel.a'))),f.exclusions.save(body(url('parallel.b')))]);
  await f.exclusions.save(body('https://facebook.com/PARALLEL.A/'));assert.equal((await f.exclusions.list()).items.length,3);
  assert.equal({}.profileUrl,undefined);
});

test('Facebook exclusions reject uncertain states, prototype inputs, own Page, nonprofiles and routes not accepted by extension',async t=>{
  const f=await fixture(t),before=await fs.readFile(path.join(f.dir,'journal.json'),'utf8');
  const values=[null,[],{}, {...body(),account:'1387247911137772'},{...body(),account:'other'},{...body(),keyword:'never retain'},{...body(),items:[]},{...body(),items:Array.from({length:11},()=>({profileUrl:url('fixture'),state:'following'}))},
    ...['follow','requested','request_sent','pending','uncertain','failed','account_unverified','__proto__','constructor','toString',null,false,['following'],{toString:()=> 'following'}].map(state=>body(url('fixture'),state)),
    ...[url('profile.php?id='+ACCOUNT),url(ACCOUNT),url('people/Own-Page/'+ACCOUNT),url('fixture/posts/123'),url('groups/123'),url('reel/123'),url('watch/?v=123'),url('..'),url('__proto__'),url('foo%2fother'),url('foo\\other'),url('fixture')+'\n','http://facebook.com/fixture','https://evil.invalid/fixture','https://www.facebook.com.evil.invalid/fixture','https://u:p@facebook.com/fixture','https://facebook.com:8443/fixture',url('profile.php?id=123&id=456')].map(value=>body(value)),
    ...[...RESERVED].map(name=>body(url(name))),
    {account:ACCOUNT,items:[{profileUrl:url('fixture'),state:'following',snippet:'never retain'}]},
    Object.assign(Object.create({account:ACCOUNT}),{items:[{profileUrl:url('fixture'),state:'following'}]}),
    {account:ACCOUNT,items:[Object.assign(Object.create({state:'following'}),{profileUrl:url('fixture')})]}
  ];
  for(const value of values)await assert.rejects(()=>f.exclusions.save(value),invalid);
  await assert.rejects(()=>f.exclusions.save({account:ACCOUNT,items:[{profileUrl:url('fixture'),state:'following'},{profileUrl:url('other'),state:'unknown'}]}),invalid);
  assert.deepEqual((await f.exclusions.list()).items,[]);assert.equal(await fs.readFile(path.join(f.dir,'journal.json'),'utf8'),before);
});

test('Facebook filters only confirmed matching profile URLs, preserves provider pagination and makes no refill query',async t=>{
  const f=await fixture(t);await f.exclusions.save({account:ACCOUNT,items:[{profileUrl:url('fixture'),state:'following'},{profileUrl:url('profile.php?id=123456'),state:'followed'}]});
  let calls=0;const result={items:[item('https://facebook.com/FIXTURE/?tracking=1'),item('https://m.facebook.com/people/Other/123456'),item(url('unknown')),item(url('fixture/posts/ABC'),'post'),item('https://evil.invalid/fixture')],page:4,hasMore:true,paginationKnown:true,limitReached:false,pageSize:10,resultsPerRequest:20,omitted:2};
  const service=new Service({settings:f.settings,store:f.store,temporarySearch:{describe:()=>({ready:true}),search:async()=>{calls++;return result;}}});
  const before=await fs.readFile(path.join(f.dir,'journal.json'),'utf8');
  const filtered=await service.searchTemporaryAccounts({platform:'facebook',keyword:'never retain query',region:'never retain region',page:4});
  assert.deepEqual(filtered,{...result,items:result.items.slice(2),excludedCount:2});assert.equal(calls,1);assert.equal(result.items.length,5);
  for(const platform of ['instagram','x','blog'])assert.deepEqual(await service.searchTemporaryAccounts({platform}),{...result,excludedCount:0});
  assert.equal(calls,4);assert.equal(await fs.readFile(path.join(f.dir,'journal.json'),'utf8'),before);
  const all=await f.exclusions.filter('facebook',{...result,items:result.items.slice(0,2)});assert.equal(all.items.length,0);assert.equal(all.hasMore,true);assert.equal(all.page,4);assert.equal(all.excludedCount,2);
});

test('Facebook and Instagram exclusion state and matching remain isolated',async t=>{
  const f=await fixture(t),instagram=new InstagramFollowExclusions(f.store);
  await instagram.save({account:'spymedia_kr',items:[{username:'fixture',state:'following'}]});
  const instagramBefore=await instagram.list();await f.exclusions.save(body(url('fixture')));
  assert.deepEqual(await instagram.list(),instagramBefore);
  const results={items:[item(url('fixture')),item('https://instagram.com/fixture/')],page:0,hasMore:false};
  assert.deepEqual((await f.exclusions.filter('facebook',results)).items,[results.items[1]]);
  assert.deepEqual((await instagram.filter('instagram',results)).items,[results.items[0]]);
  await f.exclusions.remove({account:ACCOUNT,profileUrl:url('fixture')});assert.deepEqual(await instagram.list(),instagramBefore);
});

test('Facebook removal restores only future search visibility; failed persistence rolls back new and existing state',async t=>{
  const f=await fixture(t),oldSave=f.store.save.bind(f.store);f.store.save=async()=>{throw Error('synthetic disk failure');};
  await assert.rejects(()=>f.exclusions.save(body()),/synthetic disk failure/);assert.equal(Object.hasOwn(f.store.state,KEY),false);
  f.store.save=oldSave;await f.exclusions.save(body());
  const prior=await f.exclusions.list();f.store.save=async()=>{throw Error('synthetic disk failure');};
  await assert.rejects(()=>f.exclusions.save(body(url('second'))),/synthetic disk failure/);assert.deepEqual(await f.exclusions.list(),prior);
  await assert.rejects(()=>f.exclusions.remove({account:ACCOUNT,profileUrl:url('fixture')}),/synthetic disk failure/);assert.deepEqual(await f.exclusions.list(),prior);
  f.store.save=oldSave;
  assert.deepEqual(await f.exclusions.remove({account:ACCOUNT,profileUrl:'https://m.facebook.com/FIXTURE/'}),{removed:true});
  assert.deepEqual(await f.exclusions.remove({account:ACCOUNT,profileUrl:url('fixture')}),{removed:false});
  assert.deepEqual(await new FacebookFollowExclusions(new Store(f.settings)).list(),{account:ACCOUNT,items:[]});
  await assert.rejects(()=>f.exclusions.remove({account:'wrong',profileUrl:url('fixture')}),invalid);
  await assert.rejects(()=>f.exclusions.remove({account:ACCOUNT,profileUrl:url('fixture'),all:true}),invalid);
});

test('Facebook record limit is atomic and corruption fails before a paid search request',async t=>{
  const f=await fixture(t);f.store.state[KEY]={[ACCOUNT]:Object.fromEntries(Array.from({length:MAX_RECORDS},(_,i)=>{const profileUrl=url('fixture'+i);return [profileUrl,{profileUrl,state:'following',confirmedAt:'2026-10-16T12:00:00.000Z'}];}))};
  assert.deepEqual(await f.exclusions.save(body(url('fixture0'))),{saved:1});
  await assert.rejects(()=>f.exclusions.save({account:ACCOUNT,items:[{profileUrl:url('fixture0'),state:'following'},{profileUrl:url('overflow'),state:'following'}]}),e=>e.code==='follow_exclusion_limit'&&e.status===409);
  assert.equal((await f.exclusions.list()).items.length,MAX_RECORDS);
  let calls=0;const service=new Service({settings:f.settings,store:f.store,temporarySearch:{search:async()=>{calls++;return {items:[]};}}});
  for(const corrupt of [null,{},[],{[ACCOUNT]:[]},{[ACCOUNT]:{[url('fixture')]:{profileUrl:url('fixture'),state:'requested',confirmedAt:'2026-10-16T12:00:00.000Z'}}},{[ACCOUNT]:{[url('fixture')]:{profileUrl:url('fixture'),state:'following',confirmedAt:'2026-10-16T12:00:00.000Z',snippet:'raw'}}},{[ACCOUNT]:{[url('search')]:{profileUrl:url('search'),state:'following',confirmedAt:'2026-10-16T12:00:00.000Z'}}}]){
    f.store.state[KEY]=corrupt;
    await assert.rejects(()=>service.searchTemporaryAccounts({platform:'facebook'}),e=>e.code==='storage_unavailable');
  }
  assert.equal(calls,0);
});

test('Facebook exclusion HTTP routes enforce session, mutation origin/CSRF and reject query input',async t=>{
  const f=await fixture(t),service=new Service({settings:f.settings,store:f.store}),salt=randomBytes(16),password=randomBytes(24).toString('hex');
  const handler=createAdminHandler({mode:'authenticated',username:'fixture',passwordHash:salt.toString('hex')+':'+scryptSync(password,salt,64).toString('hex'),secureCookie:false,service});
  const server=http.createServer((req,res)=>handler(req,res).then(done=>{if(!done){res.writeHead(404);res.end();}}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const origin='http://127.0.0.1:'+server.address().port,route='/api/admin/facebook/follow-exclusions';
  const login=await fetch(origin+'/api/admin/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'fixture',password})});
  const Cookie=login.headers.get('set-cookie').split(';')[0],status=await(await fetch(origin+'/api/admin/status',{headers:{Cookie}})).json();
  const headers={Cookie,Origin:origin,'Content-Type':'application/json','X-CSRF-Token':status.csrfToken};
  const request=(method,value,patch={},suffix='')=>fetch(origin+route+suffix,{method,headers:{...headers,...patch},...(value?{body:JSON.stringify(value)}:{})});
  for(const method of ['GET','POST','DELETE'])assert.equal((await request(method,method==='POST'?body():method==='DELETE'?{account:ACCOUNT,profileUrl:url('fixture')}:null,{Cookie:''})).status,401);
  for(const method of ['POST','DELETE'])for(const patch of [{'X-CSRF-Token':''},{Origin:'https://evil.invalid'}])assert.equal((await request(method,body(),patch)).status,403);
  assert.equal((await request('POST',body(),{'Content-Type':'text/plain'})).status,415);
  assert.equal((await request('GET',null,{},'?account=other')).status,400);
  assert.equal((await request('POST',body(),{},'?ignored=1')).status,400);
  assert.equal((await request('DELETE',{account:ACCOUNT,profileUrl:url('fixture')},{},'?ignored=1')).status,400);
  const saved=await request('POST',body());assert.equal(saved.status,200);assert.equal(saved.headers.get('cache-control'),'no-store');assert.deepEqual(await saved.json(),{saved:1});
  const listed=await(await request('GET')).json();assert.equal(listed.account,ACCOUNT);assert.equal(listed.items[0].profileUrl,url('fixture'));
  assert.deepEqual(await(await request('DELETE',{account:ACCOUNT,profileUrl:url('fixture')})).json(),{removed:true});assert.deepEqual((await(await request('GET')).json()).items,[]);
});
