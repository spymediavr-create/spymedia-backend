import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {Readable} from 'node:stream';
import {randomBytes,randomUUID,scryptSync,createHash} from 'node:crypto';
import {config} from '../backend/config.cjs';
import {Store} from '../backend/store.cjs';
import {Service} from '../backend/service.cjs';
import {createAdminHandler} from '../server-core.cjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPucAAAAASUVORK5CYII=','base64');
const videoId='AbCdEf123_-',youtubeUrl='https://www.youtube.com/watch?v='+videoId;
const draft=(patch={})=>({type:'blog-draft',channels:['blog'],title:'서울 드론촬영 사례',description:'직접 검토한 촬영 소개 원고입니다.\n두 번째 문단입니다.',tags:['서울','드론촬영'],mediaIds:[],...patch});
const stream=()=>{const req=Readable.from([png]);req.headers={'content-type':'image/png','content-length':String(png.length),'x-upload-name':encodeURIComponent('촬영 원본.png')};return req;};
async function fixture(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'spymedia-blog-test-'));
  t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));return fs.rm(dir,{recursive:true,force:true});});
  const settings=config({SNS_DATA_DIR:dir,SNS_STORAGE_PERSISTENCE:'confirmed',SNS_SINGLE_INSTANCE:'confirmed',SNS_PUBLISH_ENABLED:'true'});
  const store=new Store(settings);await store.init();let posts=0,tools=0;
  const media={tools:async()=>{tools++;throw Error('No media probe expected');},convert:async()=>{tools++;throw Error('No conversion expected');}};
  const connectors={availability:()=>({facebook:true,x:true,blog:true,instagram:true}),publish:async()=>{posts++;throw Error('No publication expected');}};
  const service=new Service({settings,store,media,connectors});
  return {settings,store,service,posts:()=>posts,tools:()=>tools};
}

test('a text-only blog draft needs no YouTube URL and stays editable without a publishing capability',async t=>{
  const f=await fixture(t),body=draft(),[job]=await f.service.jobs.create(body);
  assert.equal(job.type,'blog-draft');assert.equal(job.channel,'blog');assert.equal(job.status,'prepared');
  assert.equal(job.legacyReadOnly,false);assert.equal(job.canSend,false);assert.equal(job.canRetry,false);
  assert.deepEqual(job.blogDraft,{title:body.title,description:body.description,tags:body.tags,youtubeUrl:''});
  assert.equal(job.youtubeUrl,null);assert.deepEqual(job.assets,[]);assert.deepEqual(job.originals,[]);
  assert.equal(job.manuscript,[body.title,body.description,'#서울 #드론촬영'].join('\n\n'));
  const withWhitespace=await f.service.jobs.create(draft({youtubeUrl:'  '}));assert.equal(withWhitespace[0].id,job.id);
  await assert.rejects(f.service.jobs.start([job.id]),e=>e.code==='job_not_ready');
  assert.equal(f.store.state.jobs[job.id].publicationAttempted,false);assert.equal(f.posts(),0);assert.equal(f.tools(),0);
});

test('optional YouTube source is canonicalized once and editing creates a new immutable draft',async t=>{
  const f=await fixture(t),body=draft({youtubeUrl:'https://youtu.be/'+videoId+'?si=tracking'}),[first]=await f.service.jobs.create(body);
  const [same]=await f.service.jobs.create({...body,youtubeUrl});assert.equal(same.id,first.id);
  assert.equal(first.blogDraft.youtubeUrl,youtubeUrl);assert.equal(first.youtubeUrl,youtubeUrl);
  assert.equal(first.manuscript.split(youtubeUrl).length-1,1);
  const [edited]=await f.service.jobs.create({...body,description:'별도로 검토한 변경 원고'});
  assert.notEqual(edited.id,first.id);assert.equal((await f.service.jobs.list()).find(j=>j.id===first.id).blogDraft.description,body.description);
  assert.equal(f.posts(),0);assert.equal(f.tools(),0);
});

test('blog photo drafts keep original bytes and ordered references across concurrent preparation and restart',async t=>{
  const f=await fixture(t),photo=await f.service.photos.upload(stream()),body=draft({mediaIds:[photo.id]});
  const prepared=await Promise.all(Array.from({length:3},()=>f.service.jobs.create(body)));
  assert.ok(prepared.every(j=>j[0].id===prepared[0][0].id));const job=prepared[0][0];
  assert.equal(job.assets[0].id,photo.id);assert.match(job.assets[0].preview,/\?preview=1$/);
  assert.equal(f.store.state.jobs[job.id].assets[0].original,true);
  assert.deepEqual(job.originals,[{id:photo.id,download:'/api/admin/media/'+photo.id}]);
  assert.equal(job.sourceMedia[0].name,'촬영 원본.png');
  const bytes=await fs.readFile(f.store.file(photo.id));assert.deepEqual(bytes,png);assert.equal(photo.sha256,createHash('sha256').update(bytes).digest('hex'));
  const restarted=new Service({settings:f.settings,store:new Store(f.settings),media:f.service.media,connectors:f.service.connectors});
  const [same]=await restarted.jobs.create(body);assert.equal(same.id,job.id);assert.deepEqual(same.blogDraft,job.blogDraft);
  assert.deepEqual(await fs.readdir(path.join(f.settings.dataDir,'converted')),[]);assert.equal(f.posts(),0);assert.equal(f.tools(),0);
});

test('draft and photo trash are respected, including a photo trashed between read and transaction',async t=>{
  const f=await fixture(t),photo=await f.service.photos.upload(stream()),body=draft({mediaIds:[photo.id]}),[job]=await f.service.jobs.create(body);
  await f.service.catalog.change('jobs',[job.id]);await assert.rejects(f.service.jobs.create(body),e=>e.code==='job_in_trash');
  await f.service.catalog.change('jobs',[job.id],true);await f.service.catalog.change('media',[photo.id]);
  await assert.rejects(f.service.jobs.create(body),e=>e.code==='media_in_trash');
  await f.service.catalog.change('media',[photo.id],true);assert.equal((await f.service.jobs.create(body))[0].id,job.id);
  const originalTransaction=f.store.transaction.bind(f.store);let inject=true;
  f.store.transaction=async fn=>{if(inject){inject=false;await originalTransaction(state=>{state.media[photo.id].trashedAt=new Date().toISOString();});}return originalTransaction(fn);};
  await assert.rejects(f.service.jobs.create({...body,title:'Changed before transaction'}),e=>e.code==='media_in_trash');
  assert.equal(Object.values(f.store.state.jobs).length,1);assert.equal(f.posts(),0);assert.equal(f.tools(),0);
});

test('blog drafts reject other channels, malformed inputs and unsafe optional source URLs',async t=>{
  const f=await fixture(t);
  for(const channels of [[],['facebook'],['blog','facebook'],['blog','blog'],'blog'])await assert.rejects(f.service.jobs.create(draft({channels})),e=>e.code==='invalid_channel');
  for(const patch of [{title:''},{title:'x'.repeat(201)},{description:''},{description:'x'.repeat(5001)},{tags:['unsafe<tag']},{tags:Array(31).fill('tag')},{tags:['contains space']}])await assert.rejects(f.service.jobs.create(draft(patch)),e=>e.code==='invalid_draft');
  for(const mediaIds of [undefined,'photo',[1],Array.from({length:11},(_,i)=>String(i)),['same','same']])await assert.rejects(f.service.jobs.create(draft({mediaIds})),e=>e.code==='invalid_media_selection');
  for(const source of [null,5,'javascript:alert(1)','http://youtu.be/'+videoId,'https://youtube.com.evil.invalid/watch?v='+videoId])await assert.rejects(f.service.jobs.create(draft({youtubeUrl:source})),e=>e.code==='invalid_youtube_url');
  await assert.rejects(f.service.jobs.create(draft({type:'link'})),e=>e.code==='invalid_youtube_url');
  await assert.rejects(f.service.jobs.create(draft({type:'instagram-photo'})),e=>e.code==='invalid_channel');
  assert.equal(Object.values(f.store.state.jobs).length,0);assert.equal(f.posts(),0);assert.equal(f.tools(),0);
});

test('only validated, bounded original photos can be attached to a new blog draft',async t=>{
  const f=await fixture(t),photo=await f.service.photos.upload(stream());
  for(const patch of [{kind:'video',type:'video/mp4'},{profile:'legacy'},{type:'image/svg+xml'},{size:0},{size:8*1024**2+1},{size:NaN},{width:4097},{height:4097},{width:4096,height:4096},{width:0},{height:1.5}]){
    const id=randomUUID();await f.store.transaction(state=>{state.media[id]={...photo,...patch,id};});
    await assert.rejects(f.service.jobs.create(draft({mediaIds:[id]})),e=>e.code==='blog_photos_only');
  }
  const ten=Array.from({length:10},()=>randomUUID());await f.store.transaction(state=>ten.forEach((id,i)=>{state.media[id]={...photo,id,sha256:'synthetic-'+i};}));
  const [job]=await f.service.jobs.create(draft({mediaIds:ten}));assert.deepEqual(job.assets.map(a=>a.id),ten);
  assert.equal(f.posts(),0);assert.equal(f.tools(),0);
});

test('blog draft persistence uses existing session and CSRF guards and cannot start a public post',async t=>{
  const f=await fixture(t),salt=randomBytes(16),password=randomBytes(20).toString('hex');
  const handler=createAdminHandler({mode:'authenticated',username:'local',passwordHash:salt.toString('hex')+':'+scryptSync(password,salt,64).toString('hex'),secureCookie:false,service:f.service});
  const server=http.createServer((req,res)=>{handler(req,res).then(done=>{if(!done){res.writeHead(404);res.end();}});});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const base='http://127.0.0.1:'+server.address().port,req=(route,options={})=>fetch(base+route,{redirect:'manual',...options});
  assert.equal((await req('/api/admin/jobs',{method:'POST'})).status,401);
  const login=await req('/api/admin/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({username:'local',password})}),cookie=login.headers.get('set-cookie').split(';')[0];
  const status=await (await req('/api/admin/status',{headers:{Cookie:cookie}})).json(),headers={Cookie:cookie,Origin:base,'Content-Type':'application/json'},body=JSON.stringify(draft());
  assert.equal((await req('/api/admin/jobs',{method:'POST',headers,body})).status,403);
  headers['X-CSRF-Token']=status.csrfToken;
  assert.equal((await req('/api/admin/jobs',{method:'POST',headers:{...headers,Origin:'https://untrusted.invalid'},body})).status,403);
  const response=await req('/api/admin/jobs',{method:'POST',headers,body});assert.equal(response.status,202);
  const {jobs}=await response.json();assert.equal(jobs[0].type,'blog-draft');assert.equal(jobs[0].canSend,false);
  const listed=await (await req('/api/admin/jobs',{headers})).json();assert.deepEqual(listed.jobs[0].blogDraft,{title:draft().title,description:draft().description,tags:draft().tags,youtubeUrl:''});
  const start=await req('/api/admin/jobs/start',{method:'POST',headers,body:JSON.stringify({ids:[jobs[0].id]})});assert.equal(start.status,409);assert.equal((await start.json()).error,'job_not_ready');
  assert.equal(f.posts(),0);assert.equal(f.tools(),0);
});
