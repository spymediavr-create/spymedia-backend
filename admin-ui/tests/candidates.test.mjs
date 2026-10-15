import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {randomUUID,randomBytes,scryptSync} from 'node:crypto';
import {config} from '../backend/config.cjs';
import {Store} from '../backend/store.cjs';
import {Service} from '../backend/service.cjs';
import {Candidates,profileUrl} from '../backend/candidates.cjs';
import {createAdminHandler} from '../server-core.cjs';

const input=(platform='instagram',suffix='fixture')=>({platform,accountName:'합성 기관·업체 '+suffix,profileUrl:({instagram:'https://www.instagram.com/',facebook:'https://www.facebook.com/',x:'https://x.com/',blog:'https://blog.naver.com/'})[platform]+suffix,industry:'공공기관·지자체',region:'인천시',reason:'테스트용 추천 이유',note:'테스트용 메모'});
const rejected=(code,status=400)=>e=>e.code===code&&e.status===status;
async function fixture(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'spymedia-candidates-test-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const settings=config({SNS_DATA_DIR:dir,SNS_STORAGE_PERSISTENCE:'confirmed',SNS_SINGLE_INSTANCE:'confirmed',SNS_PUBLISH_ENABLED:'true'}),store=new Store(settings);
  let calls=0;const forbidden=async()=>{calls++;throw Error('No provider or media call allowed');};
  const service=new Service({settings,store,connectors:{availability:()=>({}),publish:forbidden,checkXConnection:forbidden,checkFacebookConnection:forbidden,checkInstagramConnection:forbidden},media:{tools:forbidden,convert:forbidden}});
  return {dir,settings,store,service,candidates:service.candidates,calls:()=>calls};
}

test('old journal starts with empty candidates and preserves existing media, jobs, results and metadata',async t=>{
  const f=await fixture(t);await fs.mkdir(f.dir,{recursive:true});
  const mediaId=randomUUID(),jobId=randomUUID();
  const before={version:1,media:{[mediaId]:{id:mediaId,name:'fixture.jpg'}},jobs:{[jobId]:{id:jobId,status:'succeeded',key:'keep-key',result:{externalId:'keep-result'}}},customMetadata:{keep:true}};
  await fs.writeFile(path.join(f.dir,'journal.json'),JSON.stringify(before));
  assert.equal((await f.candidates.list()).total,0);
  assert.deepEqual(f.store.state,before);
  const created=await f.candidates.create(input());
  assert.equal(created.selected,false);assert.equal(created.status,'pending');assert.equal(created.manualDoneAt,null);
  const persisted=JSON.parse(await fs.readFile(path.join(f.dir,'journal.json'),'utf8'));
  delete persisted.candidates;assert.deepEqual(persisted,before);assert.equal(f.calls(),0);
});

test('individual selection, manual completion, exclusion, memo and edits persist after restart with no external activity',async t=>{
  const f=await fixture(t);let item=await f.candidates.create(input());
  item=await f.candidates.update(item.id,{revision:item.revision,selected:true,status:'done',note:'직접 처리 후 기록'});
  assert.ok(item.manualDoneAt);const manualTime=item.manualDoneAt;
  item=await f.candidates.update(item.id,{revision:item.revision,accountName:'수정한 기관명',region:'영흥도',reason:'직접 조사함'});
  assert.equal(item.manualDoneAt,manualTime);
  const restart=new Candidates(new Store(f.settings));const saved=(await restart.list({region:'영흥도'})).items[0];
  assert.deepEqual(saved,item);assert.equal(saved.selected,true);assert.equal(saved.note,'직접 처리 후 기록');
  item=await f.candidates.update(item.id,{revision:item.revision,status:'excluded'});assert.equal(item.manualDoneAt,null);assert.equal(item.selected,true);
  assert.equal((await f.candidates.list({status:'excluded'})).total,1);
  await f.candidates.update(item.id,{revision:item.revision,status:'pending'});assert.equal((await f.candidates.list({status:'pending'})).total,1);
  assert.equal(f.calls(),0);
});

test('profile URLs canonicalize aliases, case, tracking, Facebook IDs and Naver mobile links',()=>{
  for(const [platform,url,expected] of [
    ['instagram','https://instagram.com/Fixture/?igsh=tracking#fragment','https://www.instagram.com/fixture/'],
    ['facebook','https://m.facebook.com/Fixture/?ref=tracking','https://www.facebook.com/fixture'],
    ['facebook','https://www.facebook.com/12345/','https://www.facebook.com/profile.php?id=12345'],
    ['facebook','https://www.facebook.com/people/합성-기관/12345/?ref=tracking','https://www.facebook.com/profile.php?id=12345'],
    ['facebook','https://facebook.com/profile.php?id=12345&ref=tracking','https://www.facebook.com/profile.php?id=12345'],
    ['x','https://mobile.twitter.com/Fixture?ref=tracking','https://x.com/fixture'],
    ['blog','https://m.blog.naver.com/Fixture/?tracking=1','https://blog.naver.com/fixture'],
    ['blog','https://blog.naver.com/PostList.naver?blogId=Fixture&tracking=1','https://blog.naver.com/fixture']
  ])assert.equal(profileUrl(platform,url),expected);
});

test('profile URLs reject dangerous protocols, foreign/credentialed hosts, ports, platform mismatches and non-profile paths',()=>{
  const cases=[
    ['instagram','javascript:alert(1)'],['instagram','data:text/html,x'],['instagram','//instagram.com/fixture'],['instagram','http://instagram.com/fixture'],['instagram','https://instagram.com.evil.invalid/fixture'],['instagram','https://instagram.com@evil.invalid/fixture'],['instagram','https://user:password@instagram.com/fixture'],['instagram','https://instagram.com:8443/fixture'],['instagram','https://127.0.0.1/fixture'],['instagram','https://instagram.com/p/fixture'],['instagram','https://instagram.com/accounts'],['instagram','https://instagram.com/fixture%2fother'],['instagram','https://instagram.com/fixture\\other'],['instagram','https://instagram.com/fixture\n'],['facebook','https://fb.me/fixture'],['facebook','https://facebook.com/login'],['facebook','https://facebook.com/profile.php?id=1&id=2'],['facebook','https://facebook.com/fixture/posts/123'],['x','https://x.com/home'],['x','https://x.com/fixture/status/123'],['x','https://t.co/fixture'],['blog','https://naver.com/fixture'],['blog','https://blog.naver.com/fixture/123'],['blog','https://blog.naver.com/PostView.naver?blogId=fixture'],['x','https://instagram.com/fixture']
  ];
  for(const [platform,url]of cases)assert.throws(()=>profileUrl(platform,url),rejected('invalid_candidate_url'),url);
});

test('canonical duplicates including excluded/completed candidates cannot be added or introduced by edits',async t=>{
  const f=await fixture(t),a=await f.candidates.create(input('x'));
  await assert.rejects(()=>f.candidates.create({...input('x'),profileUrl:'https://twitter.com/FIXTURE/?t=1'}),rejected('duplicate_candidate',409));
  const b=await f.candidates.create(input('x','other'));
  await assert.rejects(()=>f.candidates.update(b.id,{revision:b.revision,profileUrl:a.profileUrl}),rejected('duplicate_candidate',409));
  await f.candidates.update(a.id,{revision:a.revision,status:'excluded'});
  await assert.rejects(()=>f.candidates.create(input('x')),rejected('duplicate_candidate',409));
  assert.equal((await f.candidates.list({platform:'x'})).total,2);
  const fb=await f.candidates.create({...input('facebook'),profileUrl:'https://facebook.com/12345'});
  await assert.rejects(()=>f.candidates.create({...input('facebook'),profileUrl:'https://facebook.com/people/fixture/12345'}),rejected('duplicate_candidate',409));
  assert.ok(fb.id);
});

test('simultaneous duplicate creates and stale edits are serialized without overwriting another session',async t=>{
  const f=await fixture(t),results=await Promise.allSettled([f.candidates.create(input()),f.candidates.create(input())]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'duplicate_candidate');
  const a=results.find(r=>r.status==='fulfilled').value;
  const edits=await Promise.allSettled([f.candidates.update(a.id,{revision:1,note:'first'}),f.candidates.update(a.id,{revision:1,note:'second'})]);
  assert.equal(edits.filter(r=>r.status==='fulfilled').length,1);assert.equal(edits.find(r=>r.status==='rejected').reason.code,'candidate_conflict');
});

test('batch selection is bounded, atomic on missing/stale records and independent of status',async t=>{
  const f=await fixture(t),a=await f.candidates.create(input()),b=await f.candidates.create(input('instagram','other'));
  const items=[a,b].map(({id,revision})=>({id,revision}));
  await assert.rejects(()=>f.candidates.batch({items:[items[0],{id:randomUUID(),revision:1}],changes:{selected:true}}),rejected('not_found',404));
  assert.equal((await f.candidates.list()).selectedCount,0);
  await assert.rejects(()=>f.candidates.batch({items:[items[0],{...items[1],revision:9}],changes:{selected:true}}),rejected('candidate_conflict',409));
  assert.equal((await f.candidates.list()).selectedCount,0);
  const selected=await f.candidates.batch({items,changes:{selected:true}});assert.equal((await f.candidates.list()).selectedCount,2);
  await f.candidates.batch({items:selected.map(({id,revision})=>({id,revision})),changes:{status:'done'}});
  const state=await f.candidates.list();assert.equal(state.selectedCount,2);assert.ok(state.items.every(item=>item.status==='done'&&item.manualDoneAt));
  for(const bad of [[],[items[0],items[0]],Array.from({length:51},()=>items[0]),[{id:'../../bad',revision:1}]])await assert.rejects(()=>f.candidates.batch({items:bad,changes:{selected:true}}));
  assert.equal(f.calls(),0);
});

test('SNS, industry, partial region and status filters combine and pages do not change saved selections',async t=>{
  const f=await fixture(t);
  for(const platform of ['instagram','facebook','x','blog'])await f.candidates.create(input(platform));
  const construction=await f.candidates.create({...input('instagram','build'),industry:'건설',region:'시흥시'});
  const island=await f.candidates.create({...input('instagram','island'),industry:'공공기관·지자체',region:'영흥도'});
  await f.candidates.update(island.id,{revision:1,selected:true});
  const combined=await f.candidates.list({platform:'instagram',industry:'공공기관·지자체',region:'인천'});assert.equal(combined.total,1);assert.equal(combined.items[0].region,'인천시');
  assert.equal((await f.candidates.list({platform:'facebook',industry:'건설'})).total,0);
  assert.equal((await f.candidates.list({industry:'건설',region:'시흥'})).items[0].id,construction.id);
  assert.equal((await f.candidates.list({region:'영흥도'})).items[0].industry,'공공기관·지자체');
  const p1=await f.candidates.list({limit:2}),p2=await f.candidates.list({limit:2,offset:2});assert.equal(p1.total,3);assert.equal(new Set([...p1.items,...p2.items].map(i=>i.id)).size,3);assert.equal(p2.selectedCount,1);
  assert.equal((await f.candidates.list({region:'없는 지역'})).total,0);
});

test('strict field types, lengths, status, server timestamps and unknown fields are validated',async t=>{
  const f=await fixture(t),a=await f.candidates.create(input());
  for(const body of [null,[],{}, {...input(),accountName:' '},{...input(),accountName:123},{...input(),accountName:'x'.repeat(121)},{...input(),region:'x'.repeat(101)},{...input(),reason:'x'.repeat(1001)},{...input(),note:'x'.repeat(2001)},{...input(),note:'bad\u0000value'},{...input(),selected:true},{...input(),status:'done'},{...input(),password:'do not accept'}])await assert.rejects(()=>f.candidates.create(body),rejected('invalid_candidate_input'));
  for(const patch of [{revision:1},{revision:'1',note:'x'},{revision:1,selected:'true'},{revision:1,status:'verified'},{revision:1,manualDoneAt:'forged'},{revision:1,__proto__:null,extra:1}])await assert.rejects(()=>f.candidates.update(a.id,patch),rejected('invalid_candidate_input'));
  for(const query of [{platform:'youtube'},{status:'verified'},{industry:'x'.repeat(101)},{q:'x'.repeat(201)},{limit:51},{offset:-1},{offset:1.2}])await assert.rejects(()=>f.candidates.list(query),rejected('invalid_candidate_query'));
  for(const changes of [{},{selected:1},{status:'verified'},{status:'done',manualDoneAt:'forged'}])await assert.rejects(()=>f.candidates.batch({items:[{id:a.id,revision:1}],changes}),rejected('invalid_candidate_input'));
});

async function authenticatedApp(t){
  const f=await fixture(t),salt=randomBytes(16),password=randomBytes(24).toString('hex');
  const handler=createAdminHandler({mode:'authenticated',username:'fixture',passwordHash:salt.toString('hex')+':'+scryptSync(password,salt,64).toString('hex'),secureCookie:false,service:f.service});
  const server=http.createServer((req,res)=>handler(req,res).then(done=>{if(!done){res.writeHead(404);res.end();}}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const origin='http://127.0.0.1:'+server.address().port;
  const login=await fetch(origin+'/api/admin/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'fixture',password})});
  const Cookie=login.headers.get('set-cookie').split(';')[0],status=await(await fetch(origin+'/api/admin/status',{headers:{Cookie}})).json();
  const headers={Cookie,Origin:origin,'X-CSRF-Token':status.csrfToken,'Content-Type':'application/json'};
  const request=(route,method='GET',body,overrides={})=>fetch(origin+'/api/admin/candidates'+route,{method,headers:{...headers,...overrides},body:body===undefined?undefined:JSON.stringify(body)});
  return {...f,origin,headers,request};
}

test('candidate HTTP reads and every mutation require a session, same Origin and CSRF',async t=>{
  const f=await authenticatedApp(t);
  for(const [route,method]of [['','GET'],['','POST'],['/batch','POST'],['/'+randomUUID(),'PATCH']])assert.equal((await f.request(route,method,method==='GET'?undefined:{},{Cookie:''})).status,401);
  const create=await f.request('','POST',input());assert.equal(create.status,201);const item=(await create.json()).candidate;
  for(const [route,method,body]of [['','POST',input('x')],['/'+item.id,'PATCH',{revision:1,note:'unsafe'}],['/batch','POST',{items:[{id:item.id,revision:1}],changes:{selected:true}}]]){
    assert.equal((await f.request(route,method,body,{'X-CSRF-Token':''})).status,403);
    assert.equal((await f.request(route,method,body,{Origin:'https://other.invalid'})).status,403);
  }
  assert.equal((await f.candidates.list()).selectedCount,0);
  const select=await f.request('/'+item.id,'PATCH',{revision:1,selected:true});assert.equal(select.status,200);
  const batch=await f.request('/batch','POST',{items:[{id:item.id,revision:2}],changes:{status:'done'}});assert.equal(batch.status,200);
  const read=await f.request('?platform=instagram&industry='+encodeURIComponent('공공기관·지자체')+'&region='+encodeURIComponent('인천'));assert.equal(read.status,200);assert.equal((await read.json()).items[0].status,'done');assert.equal(read.headers.get('cache-control'),'no-store');
  for(const route of ['?platform=bad','?platform=x&platform=blog','?extra=1','?limit=51'])assert.equal((await f.request(route)).status,400);
  assert.equal((await f.request('','POST',input('x'),{'Content-Type':'text/plain'})).status,415);
  assert.equal((await f.request('','POST',{...input('x'),note:'x'.repeat(66000)})).status,413);
  assert.equal((await f.request('/'+item.id,'DELETE')).status,404);
  assert.equal(f.calls(),0);
});

test('storage disabled fails closed without requiring SNS publishing credentials',async()=>{
  const service=new Service({settings:config({})});
  await assert.rejects(()=>service.candidates.list(),rejected('storage_unavailable',503));
  await assert.rejects(()=>service.candidates.create(input()),rejected('storage_unavailable',503));
});

test('custom industries and case-insensitive keyword search combine with SNS and region filters',async t=>{
  const f=await fixture(t);
  const agency=await f.candidates.create({...input(),accountName:'테스트 여행사',industry:'여행사',region:'인천시',reason:'여행·드론 촬영',note:'AgencyMemo & + #'});
  await f.candidates.create({...input('facebook'),industry:'여행사',region:'시흥시'});
  assert.equal((await f.candidates.list({industry:'여행사',region:'인천',q:'여행'})).items[0].id,agency.id);
  assert.equal((await f.candidates.list({q:'agencymemo & + #'})).total,1);
  assert.equal((await f.candidates.list({q:'fixture'})).total,1);
  assert.equal((await f.candidates.list({q:'없는 검색어'})).total,0);
  assert.equal((await f.candidates.list({platform:'facebook',industry:'여행사',region:'인천'})).total,0);
});

test('external search URL encodes keyword and region into a fixed HTTPS engine without fetching results',async()=>{
  const {externalSearchUrl}=await import('../public/candidates-ui.js');
  for(const [platform,domain]of Object.entries({instagram:'instagram.com',facebook:'facebook.com',x:'x.com',blog:'blog.naver.com'})){
    const result=new URL(externalSearchUrl(platform,'여행사 & 드론 + #제주? / @','인천 영흥도'));
    assert.equal(result.origin,'https://www.google.com');assert.equal(result.pathname,'/search');
    assert.equal(result.searchParams.get('q'),'여행사 & 드론 + #제주? / @ 인천 영흥도 site:'+domain);
    assert.equal(result.hash,'');assert.equal([...result.searchParams].length,1);assert.match(result.href,/%26/);
  }
  const adversarial=new URL(externalSearchUrl('x','javascript:alert(1)&redirect=https://evil.invalid','#test'));
  assert.equal(adversarial.origin,'https://www.google.com');assert.equal([...adversarial.searchParams].length,1);
  for(const args of [['youtube','test'],['x',' '],['x',null],['x','x'.repeat(201)],['x','test','x'.repeat(101)]])assert.equal(externalSearchUrl(...args),null);
});

test('failed journal saves roll back candidate memory and persisted data before another transaction runs',async t=>{
  const f=await fixture(t),a=await f.candidates.create(input()),before=await fs.readFile(path.join(f.dir,'journal.json'),'utf8'),save=f.store.save.bind(f.store);
  f.store.save=async()=>{throw Error('synthetic disk failure');};
  await assert.rejects(()=>f.candidates.update(a.id,{revision:1,selected:true,note:'unsaved'}));
  await assert.rejects(()=>f.candidates.create(input('x')));
  assert.equal((await f.candidates.list()).items[0].selected,false);assert.equal((await f.candidates.list()).items[0].revision,1);
  assert.equal(await fs.readFile(path.join(f.dir,'journal.json'),'utf8'),before);
  f.store.save=save;
  const next=await f.candidates.update(a.id,{revision:1,note:'saved after recovery'});assert.equal(next.revision,2);
  assert.equal((await f.candidates.list({platform:'x'})).total,0);
});

test('candidate capacity limit fails without inserting any extra record',async t=>{
  const f=await fixture(t),a=await f.candidates.create(input());
  await f.store.transaction(state=>{for(let i=1;i<2000;i++){const id=randomUUID();state.candidates[id]={...a,id,profileUrl:'https://www.instagram.com/fixture_'+i+'/'};}});
  await assert.rejects(()=>f.candidates.create(input('x')),rejected('candidate_limit',409));
  assert.equal(Object.keys(f.store.state.candidates).length,2000);
});
