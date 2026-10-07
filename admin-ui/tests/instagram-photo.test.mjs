import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {Readable} from 'node:stream';
import {randomBytes,randomUUID,scryptSync} from 'node:crypto';
import {config} from '../backend/config.cjs';
import {Store} from '../backend/store.cjs';
import {Service} from '../backend/service.cjs';
import {Connectors,caption,request} from '../backend/connectors.cjs';
import {failureDetails,logJobFailure} from '../backend/diagnostics.cjs';
import {createAdminHandler} from '../server-core.cjs';
const secret='synthetic-private-provider-payload',userId='178414000000001';
const photo=(width=1080,height=1080)=>{const bytes=Buffer.from('ffd8ffc00011080010002003011100021100031100ffd9','hex');bytes.writeUInt16BE(height,7);bytes.writeUInt16BE(width,9);return bytes;};
const stream=(bytes=photo(),type='image/jpeg')=>{const r=Readable.from([bytes]);r.headers={'content-type':type,'content-length':String(bytes.length),'x-upload-name':'synthetic.jpg'};return r;};
const draft=id=>({type:'instagram-photo',title:'Synthetic photo',description:'Reviewed caption',tags:['SpyMedia'],channels:['instagram'],mediaIds:[id]});
async function fixture(t,env={},transport){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'spymedia-instagram-'));
  t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));return fs.rm(dir,{recursive:true,force:true});});
  const settings=config({SNS_DATA_DIR:dir,SNS_STORAGE_PERSISTENCE:'confirmed',SNS_SINGLE_INSTANCE:'confirmed',PUBLIC_ORIGIN:'https://synthetic.invalid',MEDIA_SIGNING_KEY:randomBytes(32).toString('hex'),META_GRAPH_VERSION:'v25.0',IG_USER_ID:userId,IG_ACCESS_TOKEN:randomBytes(20).toString('hex'),SNS_PUBLISH_ENABLED:'true',IG_PUBLISH_ENABLED:'true',...env});
  const store=new Store(settings);await store.init();const calls=[],pauses=[];
  const connector=new Connectors(settings,{mediaUrl:asset=>service.signedUrl(asset),sleep:async ms=>pauses.push(ms),request:async(method,url,token,body)=>{
    calls.push({method,url,body});assert.equal(token,settings.env.IG_ACCESS_TOKEN);
    if(transport)return transport(method,url,body);
    if(url.includes('?fields=id,username'))return {data:{id:userId,username:'spymedia_kr',token:secret}};
    if(url.endsWith('/media'))return {data:{id:'container_1'}};
    if(url.includes('?fields=status_code'))return {data:{status_code:'FINISHED'}};
    if(url.endsWith('/media_publish'))return {data:{id:'media_1'}};
    if(url.includes('?fields=id,permalink'))return {data:{id:'media_1',permalink:'https://www.instagram.com/p/synthetic_1/'}};
    throw Error('Unexpected synthetic endpoint');
  }});
  let conversions=0;
  const service=new Service({settings,store,connectors:connector,media:{tools:async()=>{conversions++;throw Error('No probe allowed');},convert:async()=>{conversions++;throw Error('No conversion allowed');}}});
  service.jobs.failureLogger=()=>{};
  return {dir,settings,store,service,connector,calls,pauses,conversions:()=>conversions};
}
async function apiFixture(t,f){
  const salt=randomBytes(16),password=randomBytes(20).toString('hex'),handler=createAdminHandler({mode:'authenticated',username:'synthetic',passwordHash:salt.toString('hex')+':'+scryptSync(password,salt,64).toString('hex'),secureCookie:false,service:f.service});
  const server=http.createServer((req,res)=>handler(req,res).then(done=>{if(!done){res.writeHead(404);res.end();}}));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const origin='http://127.0.0.1:'+server.address().port;f.settings.origin=origin;
  const req=(route,opts={})=>fetch(origin+route,{redirect:'manual',...opts});
  const login=await req('/api/admin/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'synthetic',password})});
  const cookie=login.headers.get('set-cookie').split(';')[0],status=await(await req('/api/admin/status',{headers:{Cookie:cookie}})).json();
  const headers={Cookie:cookie,Origin:origin,'Content-Type':'application/json','X-CSRF-Token':status.csrfToken};
  return {origin,req,headers,cookie};
}
test('Instagram status reports only configuration booleans; read-only identity works with posting and delivery disabled',async t=>{
  const f=await fixture(t,{SNS_PUBLISH_ENABLED:'false',IG_PUBLISH_ENABLED:'false',PUBLIC_ORIGIN:'',MEDIA_SIGNING_KEY:''});
  const status=await f.service.status();assert.equal(f.calls.length,0);assert.equal(status.instagramConnection.credentialsConfigured,true);assert.equal(status.instagramConnection.mediaDeliveryConfigured,false);assert.equal(status.instagramConnection.publishingEnabled,false);
  const checked=await f.service.checkInstagramConnection();assert.equal(checked.username,'spymedia_kr');assert.equal(checked.publishingPermissionsVerified,false);assert.equal(checked.publishingEnabled,false);assert.equal(f.calls.length,1);assert.equal(f.calls[0].method,'GET');assert.equal(JSON.stringify(checked).includes(secret),false);
  f.settings.env.IG_ACCESS_TOKEN='';await assert.rejects(f.connector.checkInstagramConnection(),e=>e.code==='instagram_not_configured');assert.equal(f.calls.length,1);
});
test('wrong Instagram account and malformed identity cause zero container or publish writes',async t=>{
  for(const identity of [{id:userId,username:'other_account'},{id:'178414000000002',username:'spymedia_kr'},null]){
    const f=await fixture(t,{},async()=>({data:identity})),photo=await f.service.photos.upload(stream()),[job]=await f.service.jobs.create(draft(photo.id));
    await f.service.jobs.start([job.id]);await f.service.jobs.tail;
    const result=(await f.service.jobs.list())[0];assert.equal(result.status,'failed');assert.equal(result.canRetry,true);assert.equal(result.errorDetails.phase,'instagram_identity');assert.ok(f.calls.every(c=>c.method==='GET'));
  }
});
test('photo preparation saves one original, deduplicates across concurrency and restart, and invokes no provider or conversion',async t=>{
  const f=await fixture(t),saved=await f.service.photos.upload(stream());
  const created=await Promise.all(Array.from({length:4},()=>f.service.jobs.create(draft(saved.id))));assert.ok(created.every(j=>j[0].id===created[0][0].id));
  const job=created[0][0];assert.equal(job.type,'instagram-photo');assert.equal(job.status,'prepared');assert.equal(job.legacyReadOnly,false);assert.equal(job.canSend,true);assert.match(job.assets[0].preview,/preview=1$/);assert.equal(job.sourceMedia[0].name,'synthetic.jpg');
  const restarted=new Service({settings:f.settings,store:new Store(f.settings),media:f.service.media,connectors:f.connector});assert.equal((await restarted.jobs.create(draft(saved.id)))[0].id,job.id);
  assert.deepEqual(await fs.readFile(f.store.file(saved.id)),photo());
  assert.equal(f.calls.length,0);assert.equal(f.conversions(),0);assert.deepEqual(await fs.readdir(path.join(f.dir,'converted')),[]);
});
test('native Instagram preparation rejects extra channels, media, URLs, captions, formats and out-of-policy geometry',async t=>{
  const f=await fixture(t),saved=await f.service.photos.upload(stream());
  for(const patch of [{channels:['facebook']},{channels:['instagram','x']},{mediaIds:[saved.id,saved.id]},{mediaIds:[]},{mediaIds:['https://www.youtube.com/watch?v=AbCdEf123_-']},{youtubeUrl:'https://www.youtube.com/watch?v=AbCdEf123_-'},{description:'x'.repeat(2200)}])await assert.rejects(f.service.jobs.create({...draft(saved.id),...patch}));
  for(const [width,height] of [[319,319],[1441,1441],[1080,1351],[1080,565]]){const media=await f.service.photos.upload(stream(photo(width,height)));await assert.rejects(f.service.jobs.create(draft(media.id)),e=>e.code==='instagram_photo_dimensions');}
  for(const [width,height] of [[320,400],[1080,1350],[1440,1440],[955,500]]){const media=await f.service.photos.upload(stream(photo(width,height)));assert.equal((await f.service.jobs.create(draft(media.id)))[0].status,'prepared');}
  for(const type of ['image/png','image/webp','video/mp4']){const id=randomUUID();await f.store.transaction(s=>{s.media[id]={id,kind:type.startsWith('video')?'video':'image',type,size:100,profile:'link-photo',width:1080,height:1080,sha256:'synthetic-'+type};});await assert.rejects(f.service.jobs.create(draft(id)),e=>e.code==='instagram_photo_only');}
  assert.equal(f.calls.length,0);assert.equal(f.conversions(),0);
});
test('native photo publish checks identity, waits before one publication, verifies the result and never sends video fields',async t=>{
  let polls=0;
  const f=await fixture(t,{},async(method,url)=>{
    if(url.includes('fields=id,username'))return {data:{id:userId,username:'spymedia_kr'}};
    if(url.endsWith('/media'))return {data:{id:'container_1'}};
    if(url.includes('fields=status_code'))return {data:{status_code:++polls===1?'IN_PROGRESS':'FINISHED'}};
    if(url.endsWith('/media_publish')){assert.equal(Object.values(f.store.state.jobs)[0].publicationAttempted,true);return {data:{id:'media_1'}};}
    return {data:{id:'media_1',permalink:'https://www.instagram.com/p/synthetic_1/'}};
  });
  const saved=await f.service.photos.upload(stream()),[job]=await f.service.jobs.create(draft(saved.id));assert.equal(f.calls.length,0);
  await f.service.jobs.start([job.id]);await f.service.jobs.tail;
  const result=(await f.service.jobs.list())[0];assert.equal(result.status,'succeeded');assert.equal(result.result.url,'https://www.instagram.com/p/synthetic_1/');assert.equal(result.canSend,false);
  assert.deepEqual(f.calls.map(c=>c.method),['GET','POST','GET','GET','POST','GET']);assert.deepEqual(f.pauses,[2000]);
  const created=f.calls.find(c=>c.url.endsWith('/media'));assert.deepEqual(Object.keys(created.body).sort(),['caption','image_url']);assert.equal(created.body.caption,caption(draft(saved.id)));assert.equal(f.service.validSignature(new URL(created.body.image_url)),true);
  assert.equal((await f.service.jobs.create(draft(saved.id)))[0].id,job.id);await assert.rejects(f.service.jobs.start([job.id]),e=>e.code==='job_not_ready');assert.equal(f.calls.length,6);
});
test('permission failures before publication allow explicit preparation; uncertain publication and verification never replay',async t=>{
  for(const phase of ['instagram_identity','instagram_photo_create','instagram_photo_publish','instagram_photo_verify']){
    const f=await fixture(t),saved=await f.service.photos.upload(stream()),[job]=await f.service.jobs.create(draft(saved.id));
    const original=f.connector.request;f.connector.request=async(method,url,token,body)=>{
      const matched=phase==='instagram_identity'?url.includes('fields=id,username'):phase==='instagram_photo_create'?url.endsWith('/media'):phase==='instagram_photo_publish'?url.endsWith('/media_publish'):url.includes('fields=id,permalink');
      if(matched)throw Object.assign(Error(secret),{status:409,code:'channel_auth_or_permission',providerDetails:{httpStatus:403,providerCode:200,message:secret,token:secret}});return original(method,url,token,body);
    };
    await f.service.jobs.start([job.id]);await f.service.jobs.tail;
    const result=(await f.service.jobs.list())[0],uncertain=['instagram_photo_publish','instagram_photo_verify'].includes(phase);assert.equal(result.status,uncertain?'unknown':'failed');assert.equal(result.errorDetails.phase,phase);assert.equal(result.canRetry,!uncertain);assert.equal(JSON.stringify(f.store.state.jobs[job.id]).includes(secret),false);
    if(uncertain)await assert.rejects(f.service.jobs.retry(job.id),e=>e.code==='check_channel_before_retry');else{const count=f.calls.length;await f.service.jobs.retry(job.id);assert.equal((await f.service.jobs.list())[0].status,'prepared');assert.equal(f.calls.length,count);}
    assert.equal((await f.service.jobs.create(draft(saved.id)))[0].id,job.id);
  }
});
test('unfinished containers time out before publication, retain the phase, and do not revive video preparation',async t=>{
  const f=await fixture(t),saved=await f.service.photos.upload(stream()),[job]=await f.service.jobs.create(draft(saved.id)),original=f.connector.request;
  f.connector.request=(method,url,token,body)=>url.includes('fields=status_code')?Promise.resolve({data:{status_code:'IN_PROGRESS'}}):original(method,url,token,body);
  await f.service.jobs.start([job.id]);await f.service.jobs.tail;const result=(await f.service.jobs.list())[0];assert.equal(result.status,'failed');assert.equal(result.error,'channel_media_processing_timeout');assert.equal(result.errorDetails.phase,'instagram_photo_prepare');assert.ok(f.calls.every(c=>!c.url.endsWith('/media_publish')));
  await f.service.jobs.retry(job.id);assert.equal((await f.service.jobs.list())[0].status,'prepared');assert.equal(f.conversions(),0);
});
test('unapproved provider permalinks are omitted after verified photo publication',async t=>{
  for(const permalink of ['javascript:alert(1)','https://instagram.com.evil.invalid/p/a/','https://www.instagram.com/p/a/?token='+secret]){
    const f=await fixture(t),original=f.connector.request;f.connector.request=(m,u,tok,b)=>u.includes('fields=id,permalink')?Promise.resolve({data:{id:'media_1',permalink}}):original(m,u,tok,b);
    const saved=await f.service.photos.upload(stream()),[job]=await f.service.jobs.create(draft(saved.id));await f.service.jobs.start([job.id]);await f.service.jobs.tail;assert.equal((await f.service.jobs.list())[0].result.url,null);
  }
});
test('shared Instagram diagnosis blocks overlap after cooldown and counts failures without leaking provider fields',async t=>{
  const f=await fixture(t);let now=1000,calls=0,release;f.service.diagnosticNow=()=>now;
  f.connector.checkInstagramConnection=async()=>{calls++;await new Promise(r=>release=r);return {userId,username:'spymedia_kr',identityVerified:true,publishingEnabled:true,token:secret};};
  const pending=f.service.checkInstagramConnection();await assert.rejects(f.service.checkInstagramConnection(),e=>e.code==='instagram_check_rate_limited'&&e.retryAfter===60);now+=60000;await assert.rejects(f.service.checkInstagramConnection(),e=>e.code==='instagram_check_rate_limited');release();assert.equal(JSON.stringify(await pending).includes(secret),false);
  f.connector.checkInstagramConnection=async()=>{calls++;throw Object.assign(Error(secret),{status:409,code:'channel_auth_or_permission'});};await assert.rejects(f.service.checkInstagramConnection());await assert.rejects(f.service.checkInstagramConnection(),e=>e.code==='instagram_check_rate_limited');assert.equal(calls,2);
});
test('Instagram connection route requires login, Origin, CSRF and empty JSON; expired provider auth keeps the admin session',async t=>{
  const f=await fixture(t),{req,headers}=await apiFixture(t,f),route='/api/admin/instagram/check';
  assert.equal((await req(route,{method:'POST'})).status,401);const publicStatus=await(await req('/api/admin/status')).json();assert.equal(publicStatus.instagramConnection,undefined);
  for(const bad of [{...headers,'X-CSRF-Token':''},{...headers,Origin:'https://evil.invalid'}])assert.equal((await req(route,{method:'POST',headers:bad,body:'{}'})).status,403);
  assert.equal((await req(route,{headers})).status,404);
  for(const body of ['null','[]',JSON.stringify({token:secret})])assert.equal((await req(route,{method:'POST',headers,body})).status,400);
  assert.equal((await req(route+'?token='+secret,{method:'POST',headers,body:'{}'})).status,400);assert.equal(f.calls.length,0);
  assert.equal((await req(route,{method:'POST',headers,body:'{}'})).status,200);assert.equal(f.calls.length,1);
  const limited=await req(route,{method:'POST',headers,body:'{}'});assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'60');
  f.service.instagramCheckNextAt=0;f.connector.request=async(method,url,token,body)=>request(method,url,token,body,{},async()=>({status:401,data:{error:{code:190,type:'OAuthException',message:secret}}}));
  const failed=await req(route,{method:'POST',headers,body:'{}'});assert.equal(failed.status,409);const text=await failed.text();assert.equal(text.includes(secret),false);assert.equal(JSON.parse(text).details.phase,'instagram_identity');assert.equal((await(await req('/api/admin/status',{headers})).json()).authenticated,true);
});
test('signed native photo route serves original bytes and ranges while converted history and private guards remain intact',async t=>{
  const f=await fixture(t),saved=await f.service.photos.upload(stream()),[job]=await f.service.jobs.create(draft(saved.id)),{req}=await apiFixture(t,f);
  const url=new URL(f.service.signedUrl(f.store.state.jobs[job.id].assets[0])),route=url.pathname+url.search,response=await req(route);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/jpeg');assert.deepEqual(Buffer.from(await response.arrayBuffer()),photo());
  const range=await req(route,{headers:{Range:'bytes=0-3'}});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),photo().subarray(0,4));assert.equal((await req(route,{method:'HEAD'})).headers.get('content-length'),String(photo().length));
  assert.equal((await req(route.replace('signature=','signature=0'))).status,403);assert.equal((await req('/api/admin/media/'+saved.id)).status,401);
  const id=randomUUID();await fs.writeFile(f.store.file(id,true),Buffer.from('synthetic-converted'));await f.store.transaction(s=>{s.jobs[randomUUID()]={assets:[{id,kind:'image',type:'image/jpeg',size:19,name:'converted.jpg'}]};});
  const old=new URL(f.service.signedUrl({id}));assert.equal(await(await req(old.pathname+old.search)).text(),'synthetic-converted');
});
test('native photo trash/restore and interrupted publication retain deduplication and never send on restart',async t=>{
  const f=await fixture(t),saved=await f.service.photos.upload(stream()),[job]=await f.service.jobs.create(draft(saved.id));
  await f.service.catalog.change('jobs',[job.id]);await f.service.catalog.change('media',[saved.id]);await assert.rejects(f.service.jobs.create(draft(saved.id)),e=>e.code==='media_in_trash');
  await f.service.catalog.change('media',[saved.id],true);await assert.rejects(f.service.jobs.create(draft(saved.id)),e=>e.code==='job_in_trash');await f.service.catalog.change('jobs',[job.id],true);
  await f.store.transaction(s=>Object.assign(s.jobs[job.id],{status:'publishing',publicationAttempted:true}));
  const restarted=new Service({settings:f.settings,store:new Store(f.settings),media:f.service.media,connectors:f.connector});const [retained]=await restarted.jobs.create(draft(saved.id));assert.equal(retained.id,job.id);assert.equal(retained.status,'unknown');assert.equal(retained.canRetry,false);assert.equal(f.calls.length,0);assert.deepEqual(await fs.readFile(f.store.file(saved.id)),photo());
});
test('Instagram failure logs retain only fixed channel, bounded details and known phases',()=>{
  const logs=[],original=console.error;try{console.error=value=>logs.push(value);logJobFailure({id:randomUUID(),channel:'instagram',error:secret},{phase:'instagram_photo_publish',httpStatus:403,providerCode:200,providerSubcode:secret,providerType:secret,message:secret,request:secret});}finally{console.error=original;}
  assert.equal(logs.length,1);assert.equal(logs[0].includes(secret),false);assert.equal(JSON.parse(logs[0]).channel,'instagram');assert.deepEqual(failureDetails({phase:'instagram_photo_publish',httpStatus:403,token:secret}),{httpStatus:403,phase:'instagram_photo_publish'});
});
