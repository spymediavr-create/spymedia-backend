import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {config} from '../backend/config.cjs';
import {Store} from '../backend/store.cjs';
import {Service} from '../backend/service.cjs';
import {Connectors,caption} from '../backend/connectors.cjs';
import {failureDetails,logJobFailure} from '../backend/diagnostics.cjs';

const userId='178414000000001',appScopedId='900000000001',secret='synthetic-private-reel-provider-payload';
const original=Buffer.from('synthetic original bytes: never transcode this fixture');
const draft=id=>({type:'instagram-reel',title:'Synthetic reel',description:'Reviewed original video',tags:['SpyMedia'],channels:['instagram'],mediaIds:[id]});
const metadata={kind:'video',type:'video/mp4',profile:'instagram-reel-original',width:1080,height:1920,duration:6,videoCodec:'h264',audioCodec:'aac',frameRate:30,videoBitrate:8_000_000,audioSampleRate:48000,audioChannels:2,audioBitrate:128000,pixelFormat:'yuv420p',fieldOrder:'progressive',rotation:0,fastStart:true,hasEditList:false};

async function fixture(t,{env={},transport}={}){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'spymedia-reel-test-'));
  t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));return fs.rm(dir,{recursive:true,force:true});});
  const settings=config({SNS_DATA_DIR:dir,SNS_STORAGE_PERSISTENCE:'confirmed',SNS_SINGLE_INSTANCE:'confirmed',PUBLIC_ORIGIN:'https://synthetic.invalid',MEDIA_SIGNING_KEY:randomBytes(32).toString('hex'),META_GRAPH_VERSION:'v25.0',IG_USER_ID:userId,IG_ACCESS_TOKEN:randomBytes(20).toString('hex'),SNS_PUBLISH_ENABLED:'true',IG_PUBLISH_ENABLED:'true',...env});
  const store=new Store(settings);await store.init();const calls=[],pauses=[];let conversions=0,service;
  const connector=new Connectors(settings,{mediaUrl:asset=>service.signedUrl(asset),sleep:async ms=>pauses.push(ms),request:async(method,url,token,body)=>{
    calls.push({method,url,body});assert.equal(token,settings.env.IG_ACCESS_TOKEN);
    if(transport)return transport(method,url,body);
    if(url.includes('?fields=id,user_id,username'))return {data:{id:appScopedId,user_id:userId,username:'spymedia_kr',token:secret}};
    if(url.endsWith('/media'))return {data:{id:'reel_container_1'}};
    if(url.includes('?fields=status_code'))return {data:{status_code:'FINISHED'}};
    if(url.endsWith('/media_publish'))return {data:{id:'reel_media_1'}};
    if(url.includes('?fields=id,permalink,media_product_type'))return {data:{id:'reel_media_1',permalink:'https://www.instagram.com/reel/synthetic_1/',media_product_type:'REELS'}};
    throw Error('Unexpected synthetic endpoint');
  }});
  service=new Service({settings,store,connectors:connector,media:{tools:async()=>{conversions++;throw Error('No preparation probe allowed');},convert:async()=>{conversions++;throw Error('No conversion allowed');}}});
  service.jobs.failureLogger=()=>{};
  const addMedia=async(patch={})=>{
    const id=randomUUID(),item={...metadata,id,name:'synthetic-original.mp4',size:original.length,sha256:createHash('sha256').update(original).digest('hex'),createdAt:new Date().toISOString(),...patch};
    await fs.writeFile(store.file(id),original);await store.transaction(s=>{s.media[id]=item;});return item;
  };
  return {dir,settings,store,service,connector,calls,pauses,addMedia,conversions:()=>conversions};
}
async function prepared(f,patch={}){const media=await f.addMedia(patch),[job]=await f.service.jobs.create(draft(media.id));return {media,job};}
async function send(f,id){await f.service.jobs.start([id]);await f.service.jobs.tail;return (await f.service.jobs.list()).find(j=>j.id===id);}

test('original reel preparation accepts MP4 and MOV, preserves metadata and bytes, and never invokes conversion or provider APIs',async t=>{
  for(const type of ['video/mp4','video/quicktime']){
    const f=await fixture(t),{media,job}=await prepared(f,{type});
    assert.equal(job.type,'instagram-reel');assert.equal(job.status,'prepared');assert.equal(job.canSend,true);assert.equal(job.legacyReadOnly,false);assert.equal(job.sourceMedia[0].name,media.name);
    assert.match(job.assets[0].preview,/preview=1$/);assert.equal(job.assets[0].duration,6);
    const asset=f.store.state.jobs[job.id].assets[0];for(const key of Object.keys(metadata))assert.equal(asset[key],media[key]);assert.equal(asset.original,true);
    assert.deepEqual(await fs.readFile(f.store.file(media.id)),original);assert.deepEqual(await fs.readdir(path.join(f.dir,'converted')),[]);assert.equal(f.calls.length,0);assert.equal(f.conversions(),0);
  }
});

test('reel drafts deduplicate concurrent prepares and restart without publishing, converting or losing their original source',async t=>{
  const f=await fixture(t),media=await f.addMedia();
  const jobs=await Promise.all(Array.from({length:4},()=>f.service.jobs.create(draft(media.id))));assert.ok(jobs.every(j=>j[0].id===jobs[0][0].id));
  const restarted=new Service({settings:f.settings,store:new Store(f.settings),media:f.service.media,connectors:f.connector});
  const [same]=await restarted.jobs.create(draft(media.id));assert.equal(same.id,jobs[0][0].id);assert.equal(same.status,'prepared');assert.equal(same.canSend,true);assert.equal(same.assets[0].id,media.id);assert.equal(f.calls.length,0);assert.equal(f.conversions(),0);
});

test('silent original reels retain explicit absence of audio without adding or transcoding a track',async t=>{
  const f=await fixture(t),{job}=await prepared(f,{audioCodec:null,audioSampleRate:0,audioChannels:0,audioBitrate:0});
  const asset=f.store.state.jobs[job.id].assets[0];assert.equal(asset.audioCodec,null);assert.equal(asset.audioBitrate,0);assert.equal((await send(f,job.id)).status,'succeeded');assert.equal(f.conversions(),0);
});

test('reel preparation rejects extra channels, external URLs, unverified media, missing metadata and oversized captions',async t=>{
  const f=await fixture(t),media=await f.addMedia();
  for(const patch of [{channels:['facebook']},{channels:['instagram','x']},{mediaIds:[]},{mediaIds:[media.id,media.id]},{mediaIds:['https://video.invalid/video.mp4']},{youtubeUrl:'https://www.youtube.com/watch?v=AbCdEf123_-'},{description:'x'.repeat(2200)}])await assert.rejects(f.service.jobs.create({...draft(media.id),...patch}));
  for(const patch of [{kind:'image'},{type:'video/webm'},{type:'image/jpeg'},{profile:undefined},{profile:'legacy-converted'},{size:0},{size:300_000_001},{size:1.5}]){
    const invalid=await f.addMedia(patch);await assert.rejects(f.service.jobs.create(draft(invalid.id)),e=>e.code==='instagram_reel_only');
  }
  for(const patch of [{width:0},{height:0},{duration:0},{duration:901},{videoCodec:'vp9'},{audioCodec:'mp3'},{frameRate:undefined},{frameRate:61},{videoBitrate:undefined},{audioSampleRate:undefined},{audioChannels:undefined},{audioBitrate:128001},{pixelFormat:undefined},{fieldOrder:undefined},{rotation:90},{fastStart:false},{hasEditList:true}]){
    const invalid=await f.addMedia(patch);await assert.rejects(f.service.jobs.create(draft(invalid.id)));
  }
  const allowed=await f.addMedia({size:300_000_000});assert.equal((await f.service.jobs.create(draft(allowed.id)))[0].status,'prepared');
  assert.equal(f.calls.length,0);assert.equal(f.conversions(),0);
});

test('explicit reel publication uses verified professional user_id, signed original URL, bounded polling, and verifies REELS after one publish',async t=>{
  let polls=0;
  const f=await fixture(t),{media,job}=await prepared(f),originalRequest=f.connector.request;
  f.connector.request=async(method,url,token,body)=>{
    if(url.includes('?fields=status_code')){const result=await originalRequest(method,url,token,body);result.data.status_code=++polls===1?'IN_PROGRESS':'FINISHED';return result;}
    if(url.endsWith('/media_publish'))assert.equal(f.store.state.jobs[job.id].publicationAttempted,true);
    return originalRequest(method,url,token,body);
  };
  assert.equal(f.calls.length,0);const result=await send(f,job.id);
  assert.equal(result.status,'succeeded');assert.equal(result.result.mediaProductType,'REELS');assert.equal(result.result.url,'https://www.instagram.com/reel/synthetic_1/');assert.equal(result.canSend,false);assert.equal(result.canRetry,false);
  assert.deepEqual(f.calls.map(c=>c.method),['GET','POST','GET','GET','POST','GET']);assert.deepEqual(f.pauses,[60000]);
  const created=f.calls.find(c=>c.url.endsWith('/media')),published=f.calls.find(c=>c.url.endsWith('/media_publish')),root='https://graph.instagram.com/'+f.settings.env.META_GRAPH_VERSION+'/'+userId;
  assert.equal(created.url,root+'/media');assert.equal(published.url,root+'/media_publish');assert.equal(created.body.media_type,'REELS');assert.equal(created.body.share_to_feed,true);assert.equal(created.body.caption,caption(draft(media.id)));
  assert.deepEqual(Object.keys(created.body).sort(),['caption','media_type','share_to_feed','video_url']);assert.equal(f.service.validSignature(new URL(created.body.video_url)),true);assert.match(new URL(created.body.video_url).pathname,new RegExp(media.id+'$'));assert.ok(f.calls.every(c=>!c.url.includes('/'+appScopedId)));
  assert.match(f.calls.at(-1).url,/fields=id,permalink,media_product_type$/);assert.equal(f.conversions(),0);assert.deepEqual(await fs.readFile(f.store.file(media.id)),original);
  assert.equal((await f.service.jobs.create(draft(media.id)))[0].id,job.id);await assert.rejects(f.service.jobs.start([job.id]),e=>e.code==='job_not_ready');assert.equal(f.calls.length,6);
});

test('reel publication rejects mismatched or malformed identity before any container write',async t=>{
  for(const identity of [{id:appScopedId,user_id:userId,username:'wrong_account'},{id:userId,user_id:'178414000000002',username:'spymedia_kr'},{id:appScopedId,username:'spymedia_kr'},null]){
    const f=await fixture(t,{transport:async()=>({data:identity})}),{job}=await prepared(f),result=await send(f,job.id);
    assert.equal(result.status,'failed');assert.equal(result.canRetry,true);assert.equal(result.errorDetails.phase,'instagram_identity');assert.ok(f.calls.every(c=>c.method==='GET'));assert.equal(f.conversions(),0);
  }
});

test('persisted reel assets must still be verified originals before a container can be sent',async t=>{
  for(const patch of [{original:false},{profile:'legacy-converted'},{kind:'image'},{type:'video/webm'},{size:300_000_001},{videoCodec:'vp9'},{fastStart:false}]){
    const f=await fixture(t),{job}=await prepared(f);await f.store.transaction(s=>Object.assign(s.jobs[job.id].assets[0],patch));
    const result=await send(f,job.id);assert.equal(result.status,'failed');assert.equal(result.errorDetails.phase,'instagram_reel_create');assert.ok(f.calls.every(c=>c.method==='GET'));assert.equal(f.conversions(),0);
  }
});

test('reel publication requires enablement and a distinct explicit start after preparation or safe retry',async t=>{
  const f=await fixture(t,{env:{SNS_PUBLISH_ENABLED:'false'}}),{job}=await prepared(f);await assert.rejects(f.service.jobs.start([job.id]),e=>e.code==='publishing_disabled');assert.equal(f.calls.length,0);
  f.settings.publishingEnabled=true;f.settings.env.IG_PUBLISH_ENABLED='false';await assert.rejects(f.service.jobs.start([job.id]),e=>e.code==='channel_not_configured');assert.equal(f.calls.length,0);
  f.settings.env.IG_PUBLISH_ENABLED='true';await f.store.transaction(s=>Object.assign(s.jobs[job.id],{status:'failed',error:'interrupted'}));
  await f.service.jobs.retry(job.id);assert.equal((await f.service.jobs.list())[0].status,'prepared');assert.equal(f.calls.length,0);assert.equal(f.conversions(),0);
  const [first,second]=await Promise.allSettled([f.service.jobs.start([job.id]),f.service.jobs.start([job.id])]);assert.equal(first.status,'fulfilled');assert.equal(second.status,'rejected');assert.equal(second.reason.code,'job_not_ready');await f.service.jobs.tail;
  assert.equal(f.calls.filter(c=>c.url.endsWith('/media_publish')).length,1);
});

test('container processing errors and timeout never publish or start legacy conversion',async t=>{
  for(const state of ['IN_PROGRESS','ERROR','EXPIRED','PUBLISHED']){
    const f=await fixture(t),{job}=await prepared(f),originalRequest=f.connector.request;
    f.connector.request=async(method,url,token,body)=>{const result=await originalRequest(method,url,token,body);if(url.includes('?fields=status_code'))result.data.status_code=state;return result;};
    const result=await send(f,job.id);assert.equal(result.status,'failed');assert.equal(result.errorDetails.phase,'instagram_reel_prepare');assert.equal(result.error,state==='IN_PROGRESS'?'channel_media_processing_timeout':'channel_media_processing');assert.ok(f.calls.every(c=>!c.url.endsWith('/media_publish')));
    if(state==='IN_PROGRESS'){assert.equal(f.calls.filter(c=>c.url.includes('?fields=status_code')).length,6);assert.deepEqual(f.pauses,Array(5).fill(60000));}
    const previous=f.calls.length;await f.service.jobs.retry(job.id);assert.equal((await f.service.jobs.list())[0].status,'prepared');assert.equal(f.calls.length,previous);assert.equal(f.conversions(),0);
  }
});

test('permission failures before publication may be explicitly retried; publication and verification uncertainty never replay',async t=>{
  for(const phase of ['instagram_identity','instagram_reel_create','instagram_reel_prepare','instagram_reel_publish','instagram_reel_verify']){
    const f=await fixture(t),{media,job}=await prepared(f),originalRequest=f.connector.request;
    f.connector.request=async(method,url,token,body)=>{
      const matched=phase==='instagram_identity'?url.includes('fields=id,user_id,username'):phase==='instagram_reel_create'?url.endsWith('/media'):phase==='instagram_reel_prepare'?url.includes('fields=status_code'):phase==='instagram_reel_publish'?url.endsWith('/media_publish'):url.includes('fields=id,permalink,media_product_type');
      if(matched)throw Object.assign(Error(secret),{status:409,code:'channel_auth_or_permission',providerDetails:{httpStatus:403,providerCode:200,message:secret,token:secret}});return originalRequest(method,url,token,body);
    };
    const result=await send(f,job.id),uncertain=['instagram_reel_publish','instagram_reel_verify'].includes(phase);
    assert.equal(result.status,uncertain?'unknown':'failed');assert.equal(result.errorDetails.phase,phase);assert.equal(result.canRetry,!uncertain);assert.equal(JSON.stringify(f.store.state.jobs[job.id]).includes(secret),false);
    if(uncertain)await assert.rejects(f.service.jobs.retry(job.id),e=>e.code==='check_channel_before_retry');else{const calls=f.calls.length;await f.service.jobs.retry(job.id);assert.equal((await f.service.jobs.list())[0].status,'prepared');assert.equal(f.calls.length,calls);}
    assert.equal((await f.service.jobs.create(draft(media.id)))[0].id,job.id);
  }
});

test('a lost publish response or mismatched published product is unknown and blocks duplicate transmission',async t=>{
  for(const scenario of ['network','wrong-id','wrong-product','missing-product']){
    const f=await fixture(t),{job}=await prepared(f),originalRequest=f.connector.request;
    f.connector.request=async(method,url,token,body)=>{
      if(scenario==='network'&&url.endsWith('/media_publish'))throw Object.assign(Error(secret),{code:'channel_network_failure',status:502,uncertain:true});
      const result=await originalRequest(method,url,token,body);
      if(url.includes('fields=id,permalink,media_product_type')){
        if(scenario==='wrong-id')result.data.id='another_media';
        if(scenario==='wrong-product')result.data.media_product_type='FEED';
        if(scenario==='missing-product')delete result.data.media_product_type;
      }
      return result;
    };
    const result=await send(f,job.id);assert.equal(result.status,'unknown');assert.equal(result.canRetry,false);assert.equal(result.canSend,false);await assert.rejects(f.service.jobs.retry(job.id));await assert.rejects(f.service.jobs.start([job.id]));
    assert.equal(result.errorDetails.phase,scenario==='network'?'instagram_reel_publish':'instagram_reel_verify');assert.equal(JSON.stringify(result).includes(secret),false);
  }
});

test('verification never exposes an unapproved provider permalink',async t=>{
  for(const permalink of ['javascript:alert(1)','https://instagram.com.evil.invalid/reel/a/','https://www.instagram.com/reel/a/?token='+secret,'https://user:pass@www.instagram.com/reel/a/']){
    const f=await fixture(t),{job}=await prepared(f),originalRequest=f.connector.request;
    f.connector.request=async(method,url,token,body)=>{const result=await originalRequest(method,url,token,body);if(url.includes('fields=id,permalink,media_product_type'))result.data.permalink=permalink;return result;};
    const result=await send(f,job.id);assert.equal(result.status,'succeeded');assert.equal(result.result.url,null);assert.equal(JSON.stringify(result).includes(secret),false);
  }
});

test('original signed reel delivery returns identical bytes, range and HEAD responses; invalid signatures cannot read them',async t=>{
  const f=await fixture(t),{media,job}=await prepared(f);
  const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://127.0.0.1');f.service.sendMedia(req,res,url,true).catch(e=>{res.writeHead(e.status||500);res.end();});});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));f.settings.origin='http://127.0.0.1:'+server.address().port;
  const url=f.service.signedUrl(f.store.state.jobs[job.id].assets[0]),response=await fetch(url);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'video/mp4');assert.deepEqual(Buffer.from(await response.arrayBuffer()),original);
  const range=await fetch(url,{headers:{Range:'bytes=3-8'}});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),original.subarray(3,9));assert.equal((await fetch(url,{method:'HEAD'})).headers.get('content-length'),String(original.length));
  assert.equal((await fetch(url.replace('signature=','signature=0'))).status,403);assert.deepEqual(await fs.readFile(f.store.file(media.id)),original);assert.equal(f.conversions(),0);
});

test('trash and restart preserve reel originals, deduplication and uncertain publication without replay',async t=>{
  const f=await fixture(t),{media,job}=await prepared(f);
  await f.service.catalog.change('jobs',[job.id]);await f.service.catalog.change('media',[media.id]);await assert.rejects(f.service.jobs.create(draft(media.id)),e=>e.code==='media_in_trash');
  await f.service.catalog.change('media',[media.id],true);await assert.rejects(f.service.jobs.create(draft(media.id)),e=>e.code==='job_in_trash');await f.service.catalog.change('jobs',[job.id],true);
  await f.store.transaction(s=>Object.assign(s.jobs[job.id],{status:'publishing',publicationAttempted:true,containerId:'reel_container_1'}));
  const restarted=new Service({settings:f.settings,store:new Store(f.settings),media:f.service.media,connectors:f.connector}),[retained]=await restarted.jobs.create(draft(media.id));
  assert.equal(retained.id,job.id);assert.equal(retained.status,'unknown');assert.equal(retained.canRetry,false);assert.equal(retained.canSend,false);assert.equal(f.calls.length,0);assert.deepEqual(await fs.readFile(f.store.file(media.id)),original);
  await assert.rejects(restarted.jobs.retry(job.id),e=>e.code==='check_channel_before_retry');
});

test('restart during a queued or preparing reel preserves it for explicit retry without automatic replay',async t=>{
  for(const status of ['queued','publishing']){
    const f=await fixture(t),{media,job}=await prepared(f);await f.store.transaction(s=>Object.assign(s.jobs[job.id],{status,publicationAttempted:false,containerId:'reel_container_1'}));
    const restarted=new Service({settings:f.settings,store:new Store(f.settings),media:f.service.media,connectors:f.connector}),[retained]=await restarted.jobs.create(draft(media.id));
    assert.equal(retained.id,job.id);assert.equal(retained.status,'failed');assert.equal(retained.canRetry,true);assert.equal(f.calls.length,0);
    await restarted.jobs.retry(job.id);assert.equal((await restarted.jobs.list())[0].status,'prepared');assert.equal(f.calls.length,0);assert.equal(f.conversions(),0);
  }
});

test('reel failure diagnostics retain only known phases and bounded provider facts',()=>{
  for(const phase of ['instagram_reel_create','instagram_reel_prepare','instagram_reel_publish','instagram_reel_verify']){
    assert.deepEqual(failureDetails({phase,httpStatus:403,providerCode:200,message:secret,video_url:secret,token:secret,identityComparison:{usernameMatches:true,idMatches:true}}),{httpStatus:403,providerCode:200,phase});
    const logs=[],saved=console.error;try{console.error=value=>logs.push(value);logJobFailure({id:randomUUID(),channel:'instagram',error:'channel_auth_or_permission'},{phase,httpStatus:403,message:secret,token:secret});}finally{console.error=saved;}
    assert.equal(logs.length,1);assert.equal(logs[0].includes(secret),false);assert.equal(JSON.parse(logs[0]).phase,phase);
  }
});
