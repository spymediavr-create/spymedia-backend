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
import {Photos,dimensions,LIMIT} from '../backend/photos.cjs';
import {YouTubeSource,thumbnailUrl} from '../backend/youtube-source.cjs';
import {parseYouTubeUrl} from '../backend/links.cjs';
import {parseYouTubeUrl as clientParse} from '../public/youtube-url.js';
import {Connectors,TARGETS,caption} from '../backend/connectors.cjs';
import {createAdminHandler} from '../server-core.cjs';
const id='AbCdEf123_-',url='https://www.youtube.com/watch?v='+id;
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPucAAAAASUVORK5CYII=','base64');
// Small synthetic JPEG header for header/size tests only; the browser test uses a real canvas JPEG.
const jpeg=Buffer.from('ffd8ffc00011080010002003011100021100031100ffd9','hex');
const stream=(bytes,type='image/png',name='local-fixture.png')=>{const r=Readable.from([bytes]);r.headers={'content-type':type,'content-length':String(bytes.length),'x-upload-name':encodeURIComponent(name)};return r;};
const body=(channels=['facebook','blog'])=>({type:'link',youtubeUrl:url,title:'Local reviewed title',description:'Local reviewed description',tags:['SpyMedia'],xText:'Local short introduction',channels,mediaIds:[]});
async function fixture(t,env={}){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'spymedia-link-test-'));
  t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));return fs.rm(dir,{recursive:true,force:true});});
  const settings=config({SNS_DATA_DIR:dir,SNS_STORAGE_PERSISTENCE:'confirmed',SNS_SINGLE_INSTANCE:'confirmed',SNS_PUBLISH_ENABLED:'true',YOUTUBE_API_KEY:randomBytes(10).toString('hex'),...env});
  const store=new Store(settings);await store.init();let toolCalls=0,posts=0;
  const media={tools:async()=>{toolCalls++;throw Error('Unexpected video probe');},convert:async()=>{toolCalls++;throw Error('Unexpected video transform');}};
  const connectors={availability:()=>({facebook:true,x:false,blog:true,instagram:true,youtube:true}),publish:async()=>{posts++;throw Object.assign(Error('Synthetic failure before publication'),{code:'channel_auth_or_permission'});}};
  const service=new Service({settings,store,media,connectors});
  return {dir,settings,store,service,photos:service.photos,connectors,toolCalls:()=>toolCalls,posts:()=>posts};
}
const video=(override={})=>({id,status:{privacyStatus:'public'},snippet:{title:'<script>literal title</script>',description:'Literal <img onerror=bad> description',channelTitle:'Local source',thumbnails:{high:{url:'https://i.ytimg.com/vi/'+id+'/hqdefault.jpg'}}},...override});
test('server and client accept only supported canonical YouTube video URLs',()=>{
  const valid=[url,url+'&list=tracking#x','https://youtu.be/'+id+'?si=tracking','https://m.youtube.com/watch?v='+id,'https://www.youtube.com/shorts/'+id,'https://youtube.com/live/'+id];
  for(const value of valid){assert.deepEqual(parseYouTubeUrl(value),{id,url});assert.deepEqual(clientParse(value),{id,url});}
  for(const value of ['http://youtu.be/'+id,'https://youtube.com.evil.invalid/watch?v='+id,'https://user:pass@youtube.com/watch?v='+id,'https://youtube.com:444/watch?v='+id,url+'&v='+id,'https://youtu.be/notvalid','javascript:alert(1)','https://youtube.com/playlist?list=abc','https://youtube.com/watch?v='+id+'\\evil',url+'\ntrailing']){
    assert.equal(parseYouTubeUrl(value),null);assert.equal(clientParse(value),null);
  }
});
test('photo-only storage bounds dimensions and bytes, deduplicates, and leaves no rejected original',async t=>{
  const f=await fixture(t),first=await f.photos.upload(stream(png));assert.deepEqual(dimensions(png,'image/png'),{width:1,height:1,duration:0});
  assert.equal((await f.photos.upload(stream(png))).id,first.id);assert.equal((await fs.readdir(path.join(f.dir,'originals'))).length,1);
  await assert.rejects(f.photos.upload(stream(png,'video/mp4')),e=>e.code==='photo_only');
  const declared=stream(png);declared.headers['content-length']=String(LIMIT+1);await assert.rejects(f.photos.upload(declared),e=>e.code==='photo_too_large');
  const over=Buffer.from(png);over.writeUInt32BE(5000,16);await assert.rejects(f.photos.upload(stream(over)),e=>e.code==='invalid_photo_dimensions');
  await assert.rejects(f.photos.upload(stream(Buffer.from('not an image'))),e=>e.code==='invalid_photo_dimensions');
  const mismatch=stream(png);mismatch.headers['content-length']=String(png.length+1);await assert.rejects(f.photos.upload(mismatch),e=>e.code==='invalid_media');
  assert.equal((await fs.readdir(path.join(f.dir,'originals'))).length,1);assert.equal(f.toolCalls(),0);
});
test('YouTube lookup reuses only the existing API key and stores a bounded allowlisted thumbnail without video tools',async t=>{
  const f=await fixture(t),calls=[];
  const source=new YouTubeSource(f.settings,f.photos,{get:async(endpoint,options)=>{calls.push({endpoint,options});return endpoint.includes('googleapis')?{status:200,data:{items:[video()]}}:{status:200,data:jpeg};}});
  const result=await source.fetch('https://youtu.be/'+id);
  assert.equal(calls[0].endpoint,'https://www.googleapis.com/youtube/v3/videos');assert.equal(calls[0].options.params.key,f.settings.env.YOUTUBE_API_KEY);
  assert.equal(calls[0].options.maxRedirects,0);assert.equal(calls[1].options.maxRedirects,0);assert.equal(calls[1].options.maxContentLength,2*1024**2);
  assert.equal(result.url,url);assert.match(result.title,/<script>/);assert.match(result.description,/<img/);assert.match(result.thumbnail.preview,/^\/api\/admin\/media\/[a-f0-9-]{36}\?preview=1$/);
  assert.deepEqual(await fs.readFile(f.store.file(result.thumbnail.id)),jpeg);assert.equal(f.toolCalls(),0);
  const status=await f.service.status();assert.equal(status.youtubeImportReady,true);assert.equal(status.conversionReady,false);assert.equal(f.toolCalls(),0);
});
test('unavailable, quota, network, missing-key and unsafe-thumbnail cases give bounded errors and partial metadata',async t=>{
  const f=await fixture(t);let requests=0;
  const noKey=new YouTubeSource({...f.settings,env:{}},f.photos,{get:async()=>{requests++;}});
  await assert.rejects(noKey.fetch(url),e=>e.code==='youtube_key_missing');assert.equal(requests,0);
  for(const response of [{status:200,data:{items:[]}},{status:200,data:{items:[video({status:{privacyStatus:'private'}})]}}]){
    await assert.rejects(new YouTubeSource(f.settings,f.photos,{get:async()=>response}).fetch(url),e=>e.code==='youtube_unavailable');
  }
  await assert.rejects(new YouTubeSource(f.settings,f.photos,{get:async()=>({status:403,data:{error:{}}})}).fetch(url),e=>e.code==='youtube_access_or_quota');
  await assert.rejects(new YouTubeSource(f.settings,f.photos,{get:async()=>{throw Error('secret must not escape');}}).fetch(url),e=>e.code==='youtube_fetch_failed'&&!e.message.includes('secret'));
  for(const unsafe of ['https://127.0.0.1/vi/'+id+'/hqdefault.jpg','https://i.ytimg.com/vi/differentID/hqdefault.jpg','https://user@i.ytimg.com/vi/'+id+'/hqdefault.jpg','https://i.ytimg.com/vi/'+id+'/hqdefault.jpg?redirect=x']){
    assert.equal(thumbnailUrl(unsafe,id),null);let n=0;
    const v=video();v.snippet.thumbnails.high.url=unsafe;
    const result=await new YouTubeSource(f.settings,f.photos,{get:async()=>{n++;return {status:200,data:{items:[v]}};}}).fetch(url);
    assert.equal(n,1);assert.equal(result.thumbnail,null);assert.equal(result.thumbnailError,'youtube_thumbnail_unavailable');assert.match(result.title,/<script>/);
  }
  const partial=await new YouTubeSource(f.settings,f.photos,{get:async endpoint=>endpoint.includes('googleapis')?{status:200,data:{items:[video()]}}:{status:302,data:jpeg}}).fetch(url);
  assert.equal(partial.thumbnail,null);assert.equal(partial.thumbnailError,'youtube_thumbnail_unavailable');
});
test('a concurrent import is rejected while the first official lookup is in flight',async t=>{
  const f=await fixture(t);let resolve;
  const source=new YouTubeSource(f.settings,f.photos,{get:()=>new Promise(r=>resolve=r)});
  const pending=source.fetch(url);await assert.rejects(source.fetch(url),e=>e.code==='youtube_import_busy');resolve({status:200,data:{items:[]}});await assert.rejects(pending,e=>e.code==='youtube_unavailable');assert.equal(source.busy,false);
});
test('link jobs prepare immediately, canonical duplicates persist, and Instagram/YouTube/video input cannot reach conversion',async t=>{
  const f=await fixture(t),photo=await f.photos.upload(stream(png));
  const jobs=await f.service.jobs.create({...body(),mediaIds:[photo.id]});assert.equal(jobs.length,2);assert.ok(jobs.every(j=>j.type==='link'&&j.status==='prepared'));
  assert.equal(jobs.find(j=>j.channel==='facebook').assets.length,0);
  const blog=jobs.find(j=>j.channel==='blog');assert.match(blog.manuscript,/https:\/\/www.youtube.com\/watch/);assert.match(blog.assets[0].preview,/preview=1/);
  const same=await f.service.jobs.create({...body(),youtubePrivacy:'public',madeForKids:true,youtubeUrl:'https://youtu.be/'+id+'?si=tracking',mediaIds:[photo.id]});assert.deepEqual(same.map(j=>j.id),jobs.map(j=>j.id));
  const edited=await f.service.jobs.create({...body(['facebook']),title:'Changed review',mediaIds:[]});assert.notEqual(edited[0].id,jobs[0].id);
  for(const channel of ['instagram','youtube'])await assert.rejects(f.service.jobs.create(body([channel])),e=>e.code==='invalid_link_channel');
  await assert.rejects(f.service.jobs.create({...body(['x']),xText:'가'.repeat(140)}),e=>e.code==='x_content_limits');
  const videoId=randomUUID();await f.store.transaction(s=>{s.media[videoId]={id:videoId,kind:'video',type:'video/mp4',size:10,sha256:'fixture-video'};});
  await assert.rejects(f.service.jobs.create({...body(),mediaIds:[videoId]}),e=>e.code==='link_photos_only');
  assert.equal(f.posts(),0);assert.equal(f.toolCalls(),0);
});
test('link retry requires explicit start and an uncertain write cannot be retried or duplicated',async t=>{
  const f=await fixture(t),[job]=await f.service.jobs.create(body(['facebook']));
  await f.service.jobs.start([job.id]);await f.service.jobs.tail;assert.equal((await f.service.jobs.list())[0].status,'failed');assert.equal(f.posts(),1);
  await f.service.jobs.retry(job.id);assert.equal((await f.service.jobs.list())[0].status,'prepared');assert.equal(f.posts(),1);
  f.connectors.publish=async(j,ctx)=>{await ctx.beforePublication({});throw Object.assign(Error('mock uncertain response'),{code:'channel_network_failure',uncertain:true});};
  await f.service.jobs.start([job.id]);await f.service.jobs.tail;assert.equal((await f.service.jobs.list())[0].status,'unknown');
  await assert.rejects(f.service.jobs.retry(job.id),e=>e.code==='check_channel_before_retry');
  const [same]=await f.service.jobs.create(body(['facebook']));assert.equal(same.id,job.id);assert.equal(same.status,'unknown');assert.equal(f.toolCalls(),0);
});
test('legacy records remain readable but new link mode prevents conversion, retry and sending of old jobs',async t=>{
  const f=await fixture(t),oldId=randomUUID();
  await f.store.transaction(s=>{s.jobs[oldId]={id:oldId,channel:'instagram',key:'retained-key',input:{title:'Retained',description:'History',tags:[]},mediaIds:[],assets:[],status:'failed',error:'interrupted',publicationAttempted:false,createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z'};});
  const old=(await f.service.jobs.list())[0];assert.equal(old.legacyReadOnly,true);assert.equal(old.canRetry,false);assert.equal(old.canSend,false);
  await assert.rejects(f.service.jobs.retry(oldId),e=>e.code==='legacy_operation_disabled');
  await f.store.transaction(s=>{s.jobs[oldId].status='prepared';});
  await assert.rejects(f.service.jobs.start([oldId]),e=>e.code==='legacy_operation_disabled');
  await assert.rejects(f.service.jobs.create({title:'new',description:'legacy',tags:[],channels:['facebook'],mediaIds:['anything']}),e=>e.code==='legacy_operation_disabled');
  assert.equal(f.store.state.jobs[oldId].key,'retained-key');assert.equal(f.posts(),0);assert.equal(f.toolCalls(),0);
});
test('Facebook links and X text use only their post endpoints and verify identity before writes',async()=>{
  const env={META_GRAPH_VERSION:'v25.0',FB_PAGE_ACCESS_TOKEN:randomBytes(10).toString('hex'),FB_PUBLISH_ENABLED:'true',X_USER_ACCESS_TOKEN:randomBytes(10).toString('hex'),X_PUBLISH_ENABLED:'true',X_COST_LIMIT_ACKNOWLEDGED:'true'};
  const calls=[],checkpoints=[],ctx={beforePublication:async()=>checkpoints.push('before'),checkpoint:async()=>checkpoints.push('checkpoint'),assetPath:()=>{throw Error('No file should be opened');}};
  const c=new Connectors({env,publishingEnabled:true},{request:async(method,endpoint,token,data)=>{
    calls.push({method,endpoint,data});if(endpoint.includes('/me?'))return {data:{id:TARGETS.facebook}};
    if(endpoint.endsWith('/users/me'))return {data:{data:{id:'mock-user',username:TARGETS.x}}};
    if(method==='POST'){assert.equal(checkpoints.at(-1),'before');return endpoint.endsWith('/tweets')?{data:{data:{id:'mock-tweet'}}}:{data:{id:'mock-post'}};}
    return endpoint.includes('/tweets/')?{data:{data:{id:'mock-tweet'}}}:{data:{id:'mock-post',permalink_url:'https://www.facebook.com/mock-post'}};
  }});
  assert.equal(c.availability().facebook,true);
  const job={type:'link',input:{title:'Reviewed',description:'Description',tags:['SpyMedia'],youtubeUrl:url},assets:[]};
  await c.publish({...job,channel:'facebook'},ctx);const fb=calls.find(x=>x.method==='POST');assert.match(fb.endpoint,/1387247911137772\/feed$/);assert.deepEqual(fb.data,{message:caption(job.input),link:url});
  await c.publish({...job,channel:'x',input:{...job.input,xText:'Short reviewed text'}},ctx);const x=calls.filter(x=>x.method==='POST')[1];assert.equal(x.endpoint,'https://api.x.com/2/tweets');assert.deepEqual(x.data,{text:'Short reviewed text\n\n'+url});
  assert.ok(calls.every(x=>!/(photos|videos|upload|\/media)/.test(x.endpoint)));
  let writes=0;const mismatch=new Connectors({env,publishingEnabled:true},{request:async method=>{if(method==='POST')writes++;return {data:{id:'personal-profile'}};}});
  await assert.rejects(mismatch.publish({...job,channel:'facebook'},ctx),e=>e.code==='account_mismatch');assert.equal(writes,0);
});
test('link trash/restore and a service restart retain original bytes, dedup keys and drafts without sending',async t=>{
  const f=await fixture(t),photo=await f.photos.upload(stream(png)),[job]=await f.service.jobs.create({...body(['blog']),mediaIds:[photo.id]});
  const key=f.store.state.jobs[job.id].key;await f.service.catalog.change('jobs',[job.id]);await f.service.catalog.change('media',[photo.id]);
  await assert.rejects(f.service.jobs.create({...body(['blog']),mediaIds:[photo.id]}),e=>e.code==='media_in_trash');
  const restarted=new Service({settings:f.settings,store:new Store(f.settings),media:f.service.media,connectors:f.connectors});
  await restarted.catalog.change('media',[photo.id],true);await assert.rejects(restarted.jobs.create({...body(['blog']),mediaIds:[photo.id]}),e=>e.code==='job_in_trash');
  await restarted.catalog.change('jobs',[job.id],true);const [restored]=await restarted.jobs.create({...body(['blog']),mediaIds:[photo.id]});
  assert.equal(restored.id,job.id);assert.equal(restarted.store.state.jobs[job.id].key,key);assert.deepEqual(await fs.readFile(restarted.store.file(photo.id)),png);
  assert.equal(f.posts(),0);assert.equal(f.toolCalls(),0);
});
test('new import and photo APIs require a session, same origin and CSRF; helper HTML is protected',async t=>{
  const f=await fixture(t);let imports=0;f.service.youtubeSource={fetch:async value=>{imports++;return {id,url:parseYouTubeUrl(value).url,title:'Fixture',description:'Fixture'};}};
  const salt=randomBytes(16),password=randomBytes(20).toString('hex'),handler=createAdminHandler({mode:'authenticated',username:'local',passwordHash:salt.toString('hex')+':'+scryptSync(password,salt,64).toString('hex'),secureCookie:false,service:f.service});
  const server=http.createServer((req,res)=>{handler(req,res).then(done=>{if(!done){res.writeHead(404);res.end();}});});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const base='http://127.0.0.1:'+server.address().port;
  const req=(route,options={})=>fetch(base+route,{redirect:'manual',...options});
  assert.equal((await req('/admin/instagram')).status,303);assert.equal((await req('/api/admin/youtube/import',{method:'POST'})).status,401);
  const login=await req('/api/admin/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({username:'local',password})}),cookie=login.headers.get('set-cookie').split(';')[0];
  const status=await (await req('/api/admin/status',{headers:{Cookie:cookie}})).json();
  assert.equal((await req('/admin/instagram',{headers:{Cookie:cookie}})).status,200);
  const baseHeaders={Cookie:cookie,Origin:base,'Content-Type':'application/json'};
  assert.equal((await req('/api/admin/youtube/import',{method:'POST',headers:baseHeaders,body:JSON.stringify({url})})).status,403);assert.equal(imports,0);
  assert.equal((await req('/api/admin/youtube/import',{method:'POST',headers:{...baseHeaders,'X-CSRF-Token':status.csrfToken},body:JSON.stringify({url})})).status,200);assert.equal(imports,1);
  assert.equal((await req('/api/admin/media',{method:'POST',headers:{Cookie:cookie,Origin:base,'X-CSRF-Token':status.csrfToken,'Content-Type':'image/png','X-Upload-Name':'fixture.png'},body:png})).status,201);
  const longDraft={...body(['facebook']),title:'가'.repeat(200),description:'나'.repeat(5000),tags:Array.from({length:30},(_,i)=>'태그'+i+'다'.repeat(40))};
  assert.equal((await req('/api/admin/jobs',{method:'POST',headers:{...baseHeaders,'X-CSRF-Token':status.csrfToken},body:JSON.stringify(longDraft)})).status,202);
  assert.equal((await req('/api/admin/youtube/import',{method:'POST',headers:{...baseHeaders,'X-CSRF-Token':status.csrfToken},body:JSON.stringify({url,extra:'a'.repeat(65536)})})).status,413);
  const publicStatus=await (await req('/api/admin/status')).json();assert.equal(publicStatus.youtubeImportReady,undefined);assert.equal(publicStatus.csrfToken,undefined);assert.equal(f.toolCalls(),0);
});
