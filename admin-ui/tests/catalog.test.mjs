import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {randomUUID,randomBytes,scryptSync,createHash} from 'node:crypto';
import {config} from '../backend/config.cjs';
import {Store} from '../backend/store.cjs';
import {Service} from '../backend/service.cjs';
import {createAdminHandler} from '../server-core.cjs';
const png=Buffer.from('synthetic stored original');
const digest=value=>createHash('sha256').update(value).digest('hex');
test('Windows journal replacement retries transient locks without removing the prior journal',{skip:process.platform!=='win32'},async t=>{
  const f=await fixture(t),rename=fs.rename;
  let attempts=0;
  fs.rename=async(...args)=>{attempts++;if(attempts<=2)throw Object.assign(Error('synthetic transient lock'),{code:'EPERM'});return rename(...args);};
  try{await f.store.transaction(s=>{s.syntheticAtomicSave=true;});}finally{fs.rename=rename;}
  assert.equal(attempts,3);assert.equal(JSON.parse(await fs.readFile(path.join(f.dir,'journal.json'),'utf8')).syntheticAtomicSave,true);
  assert.deepEqual((await fs.readdir(f.dir)).sort(),['converted','journal.json','originals']);
});
test('explicit preparation of the same interrupted upload reuses existing jobs and never replays published work',async t=>{
  const f=await fixture(t),video=await seed(f,'prepared',false);
  await f.store.transaction(s=>{Object.assign(s.media[video.mediaId],{kind:'video',type:'video/mp4',duration:8,name:'synthetic-reupload.mp4'});});
  const draft={title:'same original draft',description:'fixture',tags:[],channels:['instagram','facebook'],mediaIds:[video.mediaId]};
  f.service.media.convert=async()=>{throw Object.assign(Error('fixture conversion'),{status:422,code:'conversion_failed'});};
  const initial=await f.service.jobs.create(draft);await f.service.jobs.tail;
  await f.store.transaction(s=>{for(const item of initial)Object.assign(s.jobs[item.id],{status:'converting',preparationStarted:true});});
  const restartedStore=new Store(f.settings);let conversions=0;
  const converter={tools:async()=>true,convert:async()=>{conversions++;return {id:randomUUID(),kind:'video',type:'video/mp4',size:20};}};
  const restarted=new Service({settings:f.settings,store:restartedStore,media:converter,connectors:f.connectors});
  await restartedStore.init();const keys=initial.map(item=>restartedStore.state.jobs[item.id].key);
  const prepared=await restarted.jobs.create(draft);assert.deepEqual(prepared.map(item=>item.id),initial.map(item=>item.id));
  await restarted.jobs.tail;assert.equal(conversions,2);assert.equal(f.publications(),0);
  for(const [i,item]of prepared.entries()){const actual=await restartedStore.job(item.id);assert.equal(actual.status,'prepared');assert.equal(actual.key,keys[i]);assert.equal(actual.publicationAttempted,false);}
  await restartedStore.transaction(s=>{const item=s.jobs[prepared[0].id];Object.assign(item,{status:'succeeded',publicationAttempted:true,result:{externalId:'synthetic-existing'}});});
  await restarted.jobs.create(draft);await restarted.jobs.tail;assert.equal(conversions,2);
  assert.equal((await restartedStore.job(prepared[0].id)).status,'succeeded');assert.deepEqual((await restartedStore.job(prepared[0].id)).result,{externalId:'synthetic-existing'});
  await restartedStore.transaction(s=>{Object.assign(s.jobs[prepared[1].id],{status:'unknown',publicationAttempted:true,error:'check_channel_before_retry'});});
  await restarted.jobs.create(draft);await restarted.jobs.tail;assert.equal((await restartedStore.job(prepared[1].id)).status,'unknown');
  assert.equal(conversions,2);assert.equal(f.publications(),0);
});
test('interrupted video preparation retains the original and resumes the same two jobs without posting',async t=>{
  const f=await fixture(t);const photo=await seed(f,'succeeded',true);
  const video=await seed(f,'converting',false,'facebook');
  const instagramId=randomUUID();
  await f.store.transaction(s=>{
    Object.assign(s.media[video.mediaId],{name:'mock-interrupted.mp4',kind:'video',type:'video/mp4',duration:8});
    s.jobs[video.id].preparationStarted=true;
    s.jobs[instagramId]={...structuredClone(s.jobs[video.id]),id:instagramId,channel:'instagram',key:randomBytes(32).toString('hex')};
  });
  const before=structuredClone(f.store.state.jobs);
  const restartedStore=new Store(f.settings);let conversions=0;
  const conversion={tools:async()=>true,convert:async(item)=>{
    assert.equal(item.id,video.mediaId);assert.equal(item.kind,'video');
    assert.equal(digest(await fs.readFile(restartedStore.file(item.id))),digest(png));
    conversions++;const id=randomUUID();await fs.writeFile(restartedStore.file(id,true),Buffer.from('synthetic converted video'));
    return {id,kind:'video',type:'video/mp4',size:25,duration:8};
  }};
  const service=new Service({settings:f.settings,store:restartedStore,media:conversion,connectors:f.connectors});
  for(const id of [video.id,instagramId]){
    const interrupted=(await service.jobs.list()).find(j=>j.id===id);
    assert.equal(interrupted.error,'interrupted');assert.equal(interrupted.status,'failed');assert.equal(interrupted.canRetry,true);assert.deepEqual(interrupted.assets,[]);
    assert.equal((await restartedStore.job(id)).publicationAttempted,false);
    await service.jobs.retry(id);await service.jobs.tail;
    const ready=await restartedStore.job(id);assert.equal(ready.id,id);assert.equal(ready.key,before[id].key);assert.deepEqual(ready.input,before[id].input);
    assert.equal(ready.status,'prepared');assert.equal(ready.assets.length,1);assert.equal(ready.assets[0].kind,'video');assert.equal(ready.publicationAttempted,false);
  }
  assert.equal(conversions,2);assert.equal(f.publications(),0);
  const nextRestart=new Store(f.settings);await nextRestart.init();
  assert.equal((await nextRestart.job(video.id)).status,'prepared');assert.equal((await nextRestart.job(instagramId)).status,'prepared');
  assert.equal(digest(await fs.readFile(nextRestart.file(video.mediaId))),digest(png));
  assert.deepEqual((await nextRestart.job(photo.id)).result,before[photo.id].result);
  assert.equal(f.publications(),0);
});
async function fixture(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'spymedia-catalog-test-'));
  t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));return fs.rm(dir,{recursive:true,force:true});});
  const settings=config({SNS_DATA_DIR:dir,SNS_STORAGE_PERSISTENCE:'confirmed',SNS_SINGLE_INSTANCE:'confirmed',SNS_PUBLISH_ENABLED:'true',SNS_LEGACY_PREPARATION_ENABLED:'true'});
  const store=new Store(settings);await store.init();
  let publications=0;
  const media={tools:async()=>true,convert:async()=>{throw Error('No conversion expected');}};
  const connectors={availability:()=>({facebook:true,instagram:true,blog:true}),publish:async()=>{publications++;throw Error('No publication expected');}};
  const service=new Service({settings,store,media,connectors});
  return {dir,settings,store,service,media,connectors,publications:()=>publications};
}
async function seed(f,status='prepared',publicationAttempted=false,channel='facebook') {
  const mediaId=randomUUID(),id=randomUUID();
  const source={id:mediaId,name:'synthetic.png',kind:'image',type:'image/png',size:png.length,sha256:digest(png),createdAt:'2026-10-01T12:00:00.000Z'};
  const job={id,channel,key:randomBytes(32).toString('hex'),input:{title:'synthetic',description:'test fixture only',tags:[]},mediaIds:[mediaId],status,publicationAttempted,assets:[],createdAt:'2026-10-01T12:01:00.000Z',updatedAt:'2026-10-01T12:02:00.000Z',result:status==='succeeded'?{externalId:'mock-result',url:'https://www.facebook.com/mock-result'}:null};
  await f.store.transaction(state=>{state.media[mediaId]=source;state.jobs[id]=job;});await fs.writeFile(f.store.file(mediaId),png);
  return {id,mediaId,job};
}
test('recoverable trash persists through restart and preserves bytes, results and duplicate keys',async t=>{
  const f=await fixture(t);const record=await seed(f,'succeeded',true);const before=structuredClone(record.job);
  await f.service.catalog.change('jobs',[record.id]);await f.service.catalog.change('media',[record.mediaId]);
  assert.equal((await f.service.catalog.list({kind:'jobs'})).total,0);assert.equal((await f.service.jobs.list()).length,0);
  const restarted=new Service({settings:f.settings,store:new Store(f.settings),media:f.media,connectors:f.connectors});
  const trashed=(await restarted.catalog.list({kind:'jobs',bin:'trash'})).items[0];assert.equal(trashed.status,'succeeded');assert.deepEqual(trashed.result,before.result);
  assert.equal((await restarted.store.job(record.id)).key,before.key);
  assert.equal(digest(await fs.readFile(restarted.store.file(record.mediaId))),digest(png));
  await restarted.catalog.change('media',[record.mediaId],true);await restarted.catalog.change('jobs',[record.id],true);
  assert.equal((await restarted.catalog.list({kind:'media'})).total,1);assert.equal((await restarted.catalog.list({kind:'jobs'})).total,1);
  assert.equal((await restarted.store.job(record.id)).publicationAttempted,true);assert.equal(f.publications(),0);
});
test('all protected states reject mixed trash selection atomically for jobs and referenced originals',async t=>{
  const f=await fixture(t);const safe=await seed(f);
  for(const status of ['converting','queued','publishing','unknown']) {
    const protectedRecord=await seed(f,status,status==='unknown');
    assert.equal((await f.service.catalog.list({kind:'jobs',limit:50})).items.find(j=>j.id===protectedRecord.id).canTrash,false);
    await assert.rejects(f.service.catalog.change('jobs',[safe.id,protectedRecord.id]),e=>e.code==='content_in_use');
    await assert.rejects(f.service.catalog.change('media',[safe.mediaId,protectedRecord.mediaId]),e=>e.code==='content_in_use');
    assert.equal(f.store.state.jobs[safe.id].trashedAt,undefined);assert.equal(f.store.state.media[safe.mediaId].trashedAt,undefined);
  }
  await assert.rejects(f.service.catalog.change('media',[safe.mediaId,randomUUID()]),e=>e.code==='not_found');
  assert.equal(f.store.state.media[safe.mediaId].trashedAt,undefined);assert.equal(f.publications(),0);
});
test('trashed original blocks preparation, sending and retry until manual restoration',async t=>{
  const f=await fixture(t);const record=await seed(f);
  await f.service.catalog.change('media',[record.mediaId]);
  assert.equal((await f.service.jobs.list())[0].canSend,false);
  await assert.rejects(f.service.jobs.start([record.id]),e=>e.code==='media_in_trash');
  await assert.rejects(f.service.jobs.create({title:'new',description:'fixture',tags:[],channels:['blog'],mediaIds:[record.mediaId]}),e=>e.code==='media_in_trash');
  await f.store.transaction(s=>{s.jobs[record.id].status='failed';});
  assert.equal((await f.service.jobs.list())[0].canRetry,false);
  await assert.rejects(f.service.jobs.retry(record.id),e=>e.code==='media_in_trash');
  await f.service.catalog.change('media',[record.mediaId],true);
  assert.equal((await f.service.jobs.list())[0].canRetry,true);assert.equal(f.store.state.jobs[record.id].status,'failed');assert.equal(f.publications(),0);
});
test('hidden duplicate job cannot create a new publication and restoration never sends automatically',async t=>{
  const f=await fixture(t);const record=await seed(f,'prepared',false,'blog');
  const draft={title:'unique draft',description:'fixture',tags:[],channels:['blog'],mediaIds:[record.mediaId]};
  const created=(await f.service.jobs.create(draft))[0];
  await f.service.catalog.change('jobs',[created.id]);
  await assert.rejects(f.service.jobs.create({...draft,channels:['facebook','blog']}),e=>e.code==='job_in_trash');
  assert.equal(Object.keys(f.store.state.jobs).length,2);
  await f.service.catalog.change('jobs',[created.id],true);
  assert.equal((await f.service.jobs.create(draft))[0].id,created.id);assert.equal(f.publications(),0);
  const regular=await seed(f);await f.service.catalog.change('jobs',[regular.id]);
  await assert.rejects(f.service.jobs.start([regular.id]),e=>e.code==='job_in_trash');
});
test('catalog pagination exposes history older than the recent 100-job display',async t=>{
  const f=await fixture(t);const record=await seed(f,'succeeded',true);
  await f.store.transaction(state=>{for(let i=0;i<125;i++){const id=randomUUID();state.jobs[id]={...structuredClone(record.job),id,createdAt:new Date(Date.UTC(2026,9,2,0,i)).toISOString()};}});
  assert.equal((await f.service.jobs.list()).length,100);
  const last=await f.service.catalog.list({kind:'jobs',offset:120,limit:20});assert.equal(last.total,126);assert.equal(last.items.length,6);assert.ok(last.items.some(item=>item.id===record.id));
  for(const query of [{limit:51},{limit:0},{offset:-1},{offset:NaN},{bin:'everything'},{kind:'credentials'}])await assert.rejects(f.service.catalog.list(query),e=>e.code==='invalid_catalog_query');
  await assert.rejects(f.service.catalog.change('media',['../journal.json']),e=>e.code==='invalid_catalog_selection');
});
test('authenticated catalog APIs enforce CSRF, survive restart and leave public diagnostics private',async t=>{
  const f=await fixture(t);const record=await seed(f);
  const salt=randomBytes(16),password=randomBytes(32).toString('hex'),passwordHash=salt.toString('hex')+':'+scryptSync(password,salt,64).toString('hex');
  const options={mode:'authenticated',username:'synthetic',passwordHash,service:f.service,secureCookie:false};
  let handler=createAdminHandler(options);
  const server=http.createServer((req,res)=>handler(req,res).then(done=>{if(!done){res.writeHead(404);res.end();}}));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));const origin='http://127.0.0.1:'+server.address().port;
  const get=(route,cookie)=>fetch(origin+route,{headers:cookie?{Cookie:cookie}:{}});
  assert.equal((await get('/api/admin/catalog')).status,401);
  const publicStatus=await(await get('/api/admin/status')).json();assert.equal(publicStatus.channels,undefined);assert.equal(publicStatus.csrfToken,undefined);
  const login=async()=>{const r=await fetch(origin+'/api/admin/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'synthetic',password})});assert.equal(r.status,200);const cookie=r.headers.get('set-cookie').split(';')[0];const status=await(await get('/api/admin/status',cookie)).json();return {cookie,csrf:status.csrfToken};};
  let auth=await login();
  const post=(path,body,token=auth.csrf)=>fetch(origin+path,{method:'POST',headers:{Cookie:auth.cookie,Origin:origin,'Content-Type':'application/json','X-CSRF-Token':token},body:JSON.stringify(body)});
  assert.equal((await post('/api/admin/catalog/trash',{kind:'media',ids:[record.mediaId]},'invalid')).status,403);
  assert.equal((await post('/api/admin/catalog/trash',{kind:'media',ids:[record.mediaId]})).status,200);
  const download=await get('/api/admin/media/'+record.mediaId,auth.cookie);assert.equal(download.status,200);assert.equal(digest(Buffer.from(await download.arrayBuffer())),digest(png));
  handler=createAdminHandler({...options,service:new Service({settings:f.settings,store:new Store(f.settings),media:f.media,connectors:f.connectors})});
  assert.equal((await get('/api/admin/catalog',auth.cookie)).status,401);
  auth=await login();
  const catalog=await(await get('/api/admin/catalog?bin=trash',auth.cookie)).json();assert.equal(catalog.total,1);assert.equal(catalog.items[0].id,record.mediaId);
  assert.equal((await post('/api/admin/catalog/restore',{kind:'media',ids:[record.mediaId]})).status,200);assert.equal(f.publications(),0);
});
