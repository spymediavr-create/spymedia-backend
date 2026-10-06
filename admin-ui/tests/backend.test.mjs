import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {Readable} from 'node:stream';
import {config} from '../backend/config.cjs';
import {Store} from '../backend/store.cjs';
import {Media} from '../backend/media.cjs';
import {Service} from '../backend/service.cjs';
import {Jobs} from '../backend/jobs.cjs';
import {Connectors,request,TARGETS,xLength} from '../backend/connectors.cjs';
import {error} from '../backend/errors.cjs';

async function fixture(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'spymedia-test-'));
  t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));return fs.rm(dir,{recursive:true,force:true});});
  const settings=config({SNS_DATA_DIR:dir,SNS_STORAGE_PERSISTENCE:'confirmed',SNS_SINGLE_INSTANCE:'confirmed',SNS_PUBLISH_ENABLED:'true',SNS_LEGACY_PREPARATION_ENABLED:'true',PUBLIC_ORIGIN:'https://fixture.invalid',MEDIA_SIGNING_KEY:'ab'.repeat(32)});
  const store=new Store(settings);await store.init();
  return {settings,store,dir};
}
function stream(data,type='image/png',name='fixture.png') {const req=Readable.from([data]);req.headers={'content-type':type,'content-length':String(data.length),'x-upload-name':encodeURIComponent(name)};return req;}
const processOnlySecret=crypto.randomBytes(32).toString('hex');
const png=Buffer.from('89504e470d0a1a0a00000000','hex');
test('storage requires an explicit persistent path outside the repository and single-instance confirmation',()=>{
  assert.equal(config({}).storageConfigured,false);
  assert.equal(config({SNS_DATA_DIR:path.resolve('public'),SNS_STORAGE_PERSISTENCE:'confirmed',SNS_SINGLE_INSTANCE:'confirmed'}).storageConfigured,false);
  assert.equal(config({NODE_ENV:'production',PUBLIC_ORIGIN:'http://127.0.0.1'}).origin,'');
});
test('upload validates bytes and declared size, deduplicates content, and retains no rejected file',async t=>{
  const {settings,store}=await fixture(t);const media=new Media(settings,store);media.tools=async()=>true;media.inspect=async()=>({width:10,height:10,duration:0});
  const original=await media.upload(stream(png));const duplicate=await media.upload(stream(png,'image/png','other.png'));assert.equal(original.id,duplicate.id);
  await assert.rejects(media.upload(stream(Buffer.from('<svg>'))),e=>e.code==='invalid_media');
  const wrong=stream(png);wrong.headers['content-length']='100';await assert.rejects(media.upload(wrong),e=>e.code==='invalid_media');
  await assert.rejects(media.upload(stream(png,'text/html')),e=>e.code==='unsupported_media');
  assert.deepEqual(await fs.readdir(path.join(store.root,'originals')),[original.id]);
});
test('signed media is short-lived, tamper-resistant, and never exposes an arbitrary path',async t=>{
  const {settings,store}=await fixture(t);const service=new Service({settings,store});const asset={id:crypto.randomUUID()};
  const url=new URL(service.signedUrl(asset));assert.equal(service.validSignature(url),true);
  url.pathname='/sns-media/'+crypto.randomUUID();assert.equal(service.validSignature(url),false);
  url.searchParams.set('expires','1000000000');assert.equal(service.validSignature(url),false);
  assert.throws(()=>store.file('../journal.json'),e=>e.code==='not_found');
});
test('durable jobs deduplicate concurrent preparation and preserve successful channels when another is uncertain',async t=>{
  const {settings,store}=await fixture(t);const id=crypto.randomUUID();await store.transaction(s=>{s.media[id]={id,kind:'image',sha256:'1'.repeat(64),size:20,width:10,height:10};});
  let conversions=0,posts=0;
  const media={convert:async(item,channel)=>{conversions++;return {id:crypto.randomUUID(),kind:'image',type:'image/jpeg',size:20};}};
  const connector={availability:()=>({instagram:true,facebook:true}),publish:async(job,ctx)=>{posts++;await ctx.beforePublication({});if(job.channel==='instagram')throw error(502,'channel_network_failure',true);return {externalId:'verified-facebook'};}};
  const jobs=new Jobs(settings,store,media,connector);const draft={title:'fixture',description:'description',tags:[],channels:['instagram','facebook','blog'],mediaIds:[id]};
  const [first,second]=await Promise.all([jobs.create(draft),jobs.create(draft)]);assert.deepEqual(first.map(j=>j.id),second.map(j=>j.id));await jobs.tail;assert.equal(conversions,2);
  await jobs.start(first.filter(j=>j.channel!=='blog').map(j=>j.id));await jobs.tail;
  const result=await jobs.list();assert.equal(result.find(j=>j.channel==='instagram').status,'unknown');assert.equal(result.find(j=>j.channel==='facebook').status,'succeeded');assert.equal(result.find(j=>j.channel==='blog').status,'prepared');assert.equal(posts,2);
  await assert.rejects(jobs.start([first[0].id]),e=>e.code==='job_not_ready');assert.equal(posts,2);
  await assert.rejects(jobs.retry(first[0].id),e=>e.code==='check_channel_before_retry');assert.equal(posts,2);
  const restored=new Store(settings);await restored.init();assert.equal((await restored.job(first[1].id)).status,'succeeded');
});
test('restart never replays queued or interrupted publishing jobs',async t=>{
  const {settings,store}=await fixture(t);await store.transaction(s=>{s.jobs.a={status:'publishing',publicationAttempted:true};s.jobs.b={status:'queued',publicationAttempted:false};});
  const restored=new Store(settings);await restored.init();assert.equal(restored.state.jobs.a.status,'unknown');assert.equal(restored.state.jobs.b.status,'failed');
});
test('job views expose stored source names during preparation without changing historical records',async t=>{
  const {settings,store}=await fixture(t);const id=crypto.randomUUID();
  await store.transaction(s=>{s.media[id]={id,name:'mock-drone.webm',kind:'video',sha256:'3'.repeat(64),size:20,duration:8};});
  const jobs=new Jobs(settings,store,{convert:async()=>({id:crypto.randomUUID(),kind:'video',type:'video/mp4',size:20})},{});
  const [created]=await jobs.create({title:'mock video',description:'local fixture',tags:[],channels:['facebook'],mediaIds:[id]});
  assert.deepEqual(created.sourceMedia,[{kind:'video',name:'mock-drone.webm'}]);
  await jobs.tail;assert.deepEqual((await jobs.list())[0].sourceMedia,created.sourceMedia);
  const historical={...await store.job(created.id),mediaIds:[crypto.randomUUID()]};
  const before=JSON.stringify(historical);assert.deepEqual(jobs.view(historical).sourceMedia,[{kind:null,name:null}]);
  assert.equal(JSON.stringify(historical),before);
  delete store.state.media[id].name;
  assert.deepEqual(jobs.view(await store.job(created.id)).sourceMedia,[{kind:'video',name:null}]);
});
test('retry prepares a failure before publication but never starts posting on its own',async t=>{
  const {settings,store}=await fixture(t);const id=crypto.randomUUID(),jobId=crypto.randomUUID();
  await store.transaction(s=>{s.media[id]={id,kind:'video',sha256:'2'.repeat(64),size:20,duration:3};s.jobs[jobId]={id:jobId,channel:'blog',input:{title:'fixture',description:'description',tags:[]},mediaIds:[id],status:'failed',assets:[],publicationAttempted:false,createdAt:new Date().toISOString()};});
  let kind,posts=0;const jobs=new Jobs(settings,store,{convert:async(item)=>{kind=item.kind;return {id:crypto.randomUUID(),kind:'image',type:'image/jpeg',size:20};}},{publish:async()=>{posts++;}});
  await jobs.retry(jobId);await jobs.tail;assert.equal((await store.job(jobId)).status,'prepared');assert.equal(kind,'image');assert.equal(posts,0);
});
test('public transport rejects an unapproved API host before network access',async()=>{
  await assert.rejects(request('POST','https://example.invalid/token','fixture'),e=>e.code==='invalid_api_endpoint');
});
function adapter(env,fn) {return new Connectors(config({PUBLIC_ORIGIN:'https://fixture.invalid',MEDIA_SIGNING_KEY:'ab'.repeat(32),SNS_PUBLISH_ENABLED:'true',...env}),{request:fn,sleep:async()=>{},mediaUrl:()=> 'https://fixture.invalid/signed-fixture'});}
const context={checkpoint:async()=>{},beforePublication:async()=>{},assetPath:()=>''};
const imageJob={channel:'instagram',input:{title:'fixture',description:'description',tags:[]},assets:[{id:crypto.randomUUID(),kind:'image',type:'image/jpeg',size:20}]};
test('Instagram verifies the exact account and container readiness before publishing, then verifies the returned ID',async()=>{
  const calls=[];const c=adapter({META_GRAPH_VERSION:'v26.0',IG_USER_ID:'123',IG_ACCESS_TOKEN:processOnlySecret,IG_PUBLISH_ENABLED:'true'},async(method,url,token,body)=>{
    calls.push({method,url,body});assert.equal(token,processOnlySecret);
    if(url.includes('fields=id,username'))return {data:{id:'123',username:TARGETS.instagram}};
    if(url.endsWith('/media'))return {data:{id:'456'}};
    if(url.includes('status_code'))return {data:{status_code:'FINISHED'}};
    if(url.endsWith('/media_publish'))return {data:{id:'789'}};
    return {data:{id:'789',permalink:'https://www.instagram.com/p/fixture/'}};
  });assert.equal((await c.publish(imageJob,context)).externalId,'789');
  assert.equal(calls.filter(c=>c.url.endsWith('/media_publish')).length,1);assert.match(calls[1].url,/graph\.instagram\.com/);assert.equal(calls[1].body.caption,'fixture\n\ndescription');
});
test('Facebook rejects a personal-profile token before any photo or video write',async()=>{
  let writes=0;const c=adapter({META_GRAPH_VERSION:'v26.0',FB_PAGE_ACCESS_TOKEN:processOnlySecret,FB_PUBLISH_ENABLED:'true'},async(method)=>{if(method==='POST')writes++;return {data:{id:'100069643772419',name:'personal fixture'}};});
  await assert.rejects(c.publish({...imageJob,channel:'facebook'},context),e=>e.code==='account_mismatch');assert.equal(writes,0);
});
test('Facebook photo publication checks page identity and returned publication ID',async()=>{
  const calls=[];const c=adapter({META_GRAPH_VERSION:'v26.0',FB_PAGE_ACCESS_TOKEN:processOnlySecret,FB_PUBLISH_ENABLED:'true'},async(method,url,token,body)=>{calls.push({method,url,body});return {data:url.includes('/me?')?{id:TARGETS.facebook}:url.endsWith('/photos')?{id:'photo',post_id:'page_post'}:{id:'page_post',permalink_url:'https://www.facebook.com/fixture'}};});
  assert.equal((await c.publish({...imageJob,channel:'facebook'},context)).externalId,'page_post');assert.equal(calls[1].body.published,true);assert.match(calls[1].url,new RegExp(TARGETS.facebook));
});
test('X requires cost acknowledgement and verifies the posting account before media upload',async()=>{
  const env={X_USER_ACCESS_TOKEN:processOnlySecret,X_PUBLISH_ENABLED:'true'};let writes=0;
  const blocked=adapter(env,async()=>{throw new Error('must not call');});assert.equal(blocked.availability().x,false);
  const c=adapter({...env,X_COST_LIMIT_ACKNOWLEDGED:'true'},async(method)=>{if(method==='POST')writes++;return {data:{data:{username:'other-fixture'}}};});
  await assert.rejects(c.publish({...imageJob,channel:'x'},context),e=>e.code==='account_mismatch');assert.equal(writes,0);assert.equal(xLength('한글'),4);
});
test('YouTube refreshes only server credentials and rejects a different channel before upload',async()=>{
  const env={YOUTUBE_OAUTH_CLIENT_ID:processOnlySecret,YOUTUBE_OAUTH_CLIENT_SECRET:processOnlySecret,YOUTUBE_OAUTH_REFRESH_TOKEN:processOnlySecret,YOUTUBE_PUBLISH_ENABLED:'true'};let uploads=0;
  const c=adapter(env,async(method,url,token,body)=>{if(url.includes('/upload/'))uploads++;if(url.includes('/token')){assert.equal(token,null);assert.match(body,/grant_type=refresh_token/);return {data:{access_token:processOnlySecret}};}return {data:{items:[{id:'other-channel'}]}};});
  await assert.rejects(c.publish({...imageJob,channel:'youtube'},context),e=>e.code==='account_mismatch');assert.equal(uploads,0);
});
test('X uploads chunks once, waits for processing, then verifies the created post',async t=>{
  const {dir}=await fixture(t);const file=path.join(dir,'x-fixture');await fs.writeFile(file,Buffer.from('process-only-fixture'));
  const calls=[];const c=adapter({X_USER_ACCESS_TOKEN:processOnlySecret,X_PUBLISH_ENABLED:'true',X_COST_LIMIT_ACKNOWLEDGED:'true'},async(method,url,token,body)=>{
    calls.push({method,url,body});
    if(url.endsWith('/users/me'))return {data:{data:{username:TARGETS.x}}};
    if(url.endsWith('/initialize'))return {data:{data:{id:'101'}}};
    if(url.endsWith('/append'))return {data:{data:{}}};
    if(url.endsWith('/finalize'))return {data:{data:{processing_info:{state:'pending',check_after_secs:1}}}};
    if(url.includes('command=STATUS'))return {data:{data:{processing_info:{state:'succeeded'}}}};
    return {data:{data:{id:'202'}}};
  });
  let marked=false;const result=await c.publish({...imageJob,channel:'x',assets:[{...imageJob.assets[0],size:20}]},{...context,assetPath:()=>file,beforePublication:async()=>{marked=true;}});
  assert.equal(result.externalId,'202');assert.equal(marked,true);assert.equal(calls.filter(r=>r.url.endsWith('/append')).length,1);assert.equal(calls.find(r=>r.url.endsWith('/tweets')).body.media.media_ids[0],'101');
});
test('YouTube uses resumable upload with explicit privacy and child-audience settings and verifies server status',async t=>{
  const {dir}=await fixture(t);const file=path.join(dir,'youtube-fixture');await fs.writeFile(file,'process-only-fixture');
  let metadata,marked=false;
  const c=adapter({YOUTUBE_OAUTH_CLIENT_ID:processOnlySecret,YOUTUBE_OAUTH_CLIENT_SECRET:processOnlySecret,YOUTUBE_OAUTH_REFRESH_TOKEN:processOnlySecret,YOUTUBE_PUBLISH_ENABLED:'true'},async(method,url,token,body)=>{
    if(url.endsWith('/token'))return {data:{access_token:processOnlySecret}};
    if(url.includes('/channels?'))return {data:{items:[{id:TARGETS.youtube}]}};
    if(method==='POST'){metadata=body;return {data:{},headers:{location:'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=fixture'}};}
    if(method==='PUT'){assert.equal(marked,true);body.destroy();return {data:{id:'video-fixture'}};}
    return {data:{items:[{id:'video-fixture',status:{privacyStatus:'private',uploadStatus:'uploaded'}}]}};
  });
  const result=await c.publish({...imageJob,channel:'youtube',input:{...imageJob.input,youtubePrivacy:'private',madeForKids:false},assets:[{...imageJob.assets[0],kind:'video',type:'video/mp4'}]},{...context,assetPath:()=>file,beforePublication:async()=>{marked=true;}});
  assert.equal(metadata.status.privacyStatus,'private');assert.equal(metadata.status.selfDeclaredMadeForKids,false);assert.equal(result.processing,true);assert.equal(result.privacyStatus,'private');
});
