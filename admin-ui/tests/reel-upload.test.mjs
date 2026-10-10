import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {Readable} from 'node:stream';
import {createHash,randomBytes,scryptSync} from 'node:crypto';
import {config} from '../backend/config.cjs';
import {Store} from '../backend/store.cjs';
import {Photos} from '../backend/photos.cjs';
import {Service} from '../backend/service.cjs';
import {Reels,validateReelMetadata,containerInfo,LIMIT} from '../backend/reels.cjs';
import {createAdminHandler} from '../server-core.cjs';
import {logReelUploadFailure,safeFailureCode} from '../backend/diagnostics.cjs';

// These are real bounded ISO-BMFF boxes, not a playable encoded video. Only
// ffprobe's executable response is mocked; the production box reader runs.
function box(type,payload=Buffer.alloc(0),extended=false){
  const head=Buffer.alloc(extended?16:8);head.writeUInt32BE(extended?1:head.length+payload.length,0);head.write(type,4,'ascii');
  if(extended)head.writeBigUInt64BE(BigInt(head.length+payload.length),8);
  return Buffer.concat([head,payload]);
}
const ftyp=()=>box('ftyp',Buffer.from('isom\0\0\0\0isommp42','binary'));
function videoBytes({fastStart=true,editList=false,extended=false}={}){
  const moov=box('moov',box('trak',editList?box('edts',box('elst',Buffer.alloc(8))):Buffer.alloc(0)),extended),mdat=box('mdat',Buffer.from('synthetic original payload'));
  return Buffer.concat([ftyp(),...(fastStart?[moov,mdat]:[mdat,moov])]);
}
const photoBytes=()=>Buffer.from('ffd8ffc00011080010002003011100021100031100ffd9','hex');
function input(bytes=videoBytes(),headers={}){const req=Readable.from([bytes.subarray(0,11),bytes.subarray(11)]);req.headers={'content-type':'video/mp4','content-length':String(bytes.length),'x-upload-name':'original.mp4',...headers};return req;}
function probeData(){return {streams:[{codec_type:'video',codec_name:'h264',width:1080,height:1920,avg_frame_rate:'30/1',bit_rate:'8000000',pix_fmt:'yuv420p',field_order:'progressive'},{codec_type:'audio',codec_name:'aac',bit_rate:'128000',sample_rate:'48000',channels:2}],format:{duration:'4',format_name:'mov,mp4,m4a,3gp,3g2,mj2'}};}
const metadata=()=>({kind:'video',type:'video/mp4',size:100,width:1080,height:1920,duration:4,videoCodec:'h264',frameRate:30,videoBitrate:8000000,pixelFormat:'yuv420p',fieldOrder:'progressive',rotation:0,fastStart:true,hasEditList:false,audioCodec:'aac',audioBitrate:128000,audioSampleRate:48000,audioChannels:2});
const matches=(code,status)=>(e)=>{assert.equal(e.code,code);if(status)assert.equal(e.status,status);return true;};
async function fixture(t,{response,execute,env={}}={}){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'spymedia-reel-upload-'));
  t.after(async()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));await fs.rm(dir,{recursive:true,force:true});});
  const settings=config({SNS_DATA_DIR:dir,SNS_STORAGE_PERSISTENCE:'confirmed',SNS_SINGLE_INSTANCE:'confirmed',PUBLIC_ORIGIN:'https://synthetic.invalid',MEDIA_SIGNING_KEY:randomBytes(32).toString('hex'),FFPROBE_PATH:'synthetic-ffprobe-only',FFMPEG_PATH:'must-never-run-ffmpeg',...env});
  const store=new Store(settings);await store.init();const calls=[];
  const reels=new Reels(settings,store,{execute:async(command,args,timeout)=>{calls.push({command,args,timeout});assert.equal(command,'synthetic-ffprobe-only');return execute?execute(command,args,timeout):JSON.stringify(response===undefined?probeData():response);}});
  const service=new Service({settings,store,reels,connectors:{availability:()=>({instagram:false,facebook:false,x:false})},media:{tools:async()=>{throw Error('Legacy tools must not run');},convert:async()=>{throw Error('No encoding allowed');}}});
  return {dir,settings,store,reels,service,calls};
}
async function clean(f){assert.equal(f.store.uploadBusy,false);assert.deepEqual(await fs.readdir(path.join(f.dir,'originals')),[]);assert.deepEqual(await fs.readdir(path.join(f.dir,'converted')),[]);assert.deepEqual(f.store.state.media,{});}
async function apiFixture(t,f){
  const salt=randomBytes(16),password=randomBytes(20).toString('hex'),handler=createAdminHandler({mode:'authenticated',username:'synthetic',passwordHash:salt.toString('hex')+':'+scryptSync(password,salt,64).toString('hex'),secureCookie:false,service:f.service});
  const server=http.createServer((req,res)=>handler(req,res).then(done=>{if(!done){res.writeHead(404);res.end();}}));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const origin='http://127.0.0.1:'+server.address().port;f.settings.origin=origin;
  const req=(route,options={})=>fetch(origin+route,{redirect:'manual',...options});
  const login=await req('/api/admin/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'synthetic',password})});assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0],status=await(await req('/api/admin/status',{headers:{Cookie:cookie}})).json();
  const headers={Cookie:cookie,Origin:origin,'Content-Type':'video/mp4','X-CSRF-Token':status.csrfToken,'X-Upload-Name':'original.mp4'};
  return {req,headers,cookie,origin};
}

test('reel upload preserves original MP4/MOV bytes and SHA-256, invokes only bounded ffprobe, and never creates converted output',async t=>{
  for(const type of ['video/mp4','video/quicktime']){
    const f=await fixture(t),bytes=videoBytes({extended:true}),item=await f.reels.upload(input(bytes,{'content-type':type}));
    assert.deepEqual(await fs.readFile(f.store.file(item.id)),bytes);assert.equal(item.sha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(item.size,bytes.length);assert.equal(item.profile,'instagram-reel-original');assert.equal(item.type,type);assert.deepEqual(item.warnings,[]);
    assert.equal(f.calls.length,1);const call=f.calls[0];assert.equal(call.timeout,30000);assert.equal(call.args.at(-1),f.store.file(item.id));assert.ok(call.args.includes('-show_streams'));assert.ok(call.args.includes('-show_format'));assert.equal(call.args[call.args.indexOf('-protocol_whitelist')+1],'file');assert.equal(call.args[call.args.indexOf('-enable_drefs')+1],'0');assert.equal(call.args[call.args.indexOf('-max_alloc')+1],'67108864');
    assert.deepEqual(await fs.readdir(path.join(f.dir,'converted')),[]);assert.equal(f.store.uploadBusy,false);
  }
});

test('silent HEVC and nonvertical originals retain exact bytes and expose only a framing recommendation',async t=>{
  const response=probeData();response.streams=response.streams.slice(0,1);Object.assign(response.streams[0],{codec_name:'hevc',width:1920,height:1080,avg_frame_rate:'24000/1001'});
  const f=await fixture(t,{response}),item=await f.reels.upload(input());assert.equal(item.audioCodec,null);assert.equal(item.audioBitrate,0);assert.equal(item.videoCodec,'hevc');assert.ok(item.frameRate>23&&item.frameRate<24);assert.deepEqual(item.warnings,['reel_vertical_recommended']);
  assert.deepEqual(await fs.readFile(f.store.file(item.id)),videoBytes());
});

test('type, declared size and filename fail before writing or probing',async t=>{
  const f=await fixture(t);
  for(const [headers,code,status] of [
    [{'content-type':'video/webm'},'reel_type_required',415],[{'content-type':'image/jpeg'},'reel_type_required',415],
    [{'content-length':'0'},'reel_too_large',413],[{'content-length':'-1'},'reel_too_large',413],[{'content-length':'1.5'},'reel_too_large',413],[{'content-length':String(LIMIT+1)},'reel_too_large',413],[{'content-length':undefined},'reel_too_large',413],
    [{'x-upload-name':''},'invalid_filename',400],[{'x-upload-name':'%xx'},'invalid_filename',400],[{'x-upload-name':'bad%00.mp4'},'invalid_filename',400],[{'x-upload-name':'x'.repeat(201)},'invalid_filename',400]
  ]){await assert.rejects(f.reels.upload(input(videoBytes(),headers)),matches(code,status));assert.equal(f.calls.length,0);assert.deepEqual(await fs.readdir(path.join(f.dir,'originals')),[]);}
});

test('truncated, excess and interrupted streams release their lock and remove temporary originals',async t=>{
  for(const [req,code] of [
    [input(videoBytes(),{'content-length':String(videoBytes().length+1)}),'invalid_reel'],
    [input(videoBytes(),{'content-length':String(videoBytes().length-1)}),'reel_too_large']
  ]){const f=await fixture(t);await assert.rejects(f.reels.upload(req),matches(code));await clean(f);assert.equal(f.calls.length,0);}
  const f=await fixture(t),req=Readable.from((async function*(){yield videoBytes().subarray(0,12);throw Error('synthetic stream interruption');})());req.headers=input().headers;
  await assert.rejects(f.reels.upload(req),/synthetic stream interruption/);await clean(f);
  assert.ok((await f.reels.upload(input())).id,'subsequent upload works after failure');
});

test('real container inspection rejects malformed boxes before ffprobe',async t=>{
  const truncated=box('moov');truncated.writeUInt32BE(100,0);
  const extended=Buffer.alloc(16);extended.writeUInt32BE(1,0);extended.write('free',4);extended.writeBigUInt64BE(BigInt(Number.MAX_SAFE_INTEGER)+1n,8);
  let deep=box('trak');for(let n=0;n<10;n++)deep=box('trak',deep);
  const many=Buffer.concat([ftyp(),box('moov'),box('mdat'),...Array.from({length:10001},()=>box('free'))]);
  for(const [name,bytes] of [
    ['arbitrary',Buffer.from('not an mp4')],['missing ftyp',Buffer.concat([box('moov'),box('mdat')])],['missing moov',Buffer.concat([ftyp(),box('mdat')])],['missing mdat',Buffer.concat([ftyp(),box('moov')])],
    ['duplicate moov',Buffer.concat([ftyp(),box('moov'),box('moov'),box('mdat')])],['truncated box',Buffer.concat([ftyp(),truncated])],['unsafe extended size',Buffer.concat([ftyp(),extended])],['too deep',Buffer.concat([ftyp(),box('moov',deep),box('mdat')])],['too many boxes',many],['trailing byte',Buffer.concat([videoBytes(),Buffer.from([0])])]
  ]){const f=await fixture(t);await assert.rejects(f.reels.upload(input(bytes)),matches('invalid_reel'),name);await clean(f);assert.equal(f.calls.length,0,name);}
});

test('faststart and nested edit lists are enforced without changing original ISO boxes',async t=>{
  for(const [options,code] of [[{fastStart:false},'reel_fast_start'],[{editList:true},'reel_edit_list']]){
    const f=await fixture(t),bytes=videoBytes(options);await assert.rejects(f.reels.upload(input(bytes)),matches(code));await clean(f);assert.equal(f.calls.length,1);
  }
  const f=await fixture(t),file=path.join(f.dir,'layout-only.mp4');await fs.writeFile(file,videoBytes());assert.deepEqual(await containerInfo(file),{fastStart:true,hasEditList:false});
});

test('probe errors and malformed responses fail closed and clean all temporary state',async t=>{
  for(const [execute,code,status] of [
    [async()=>{throw Object.assign(Error('private command error'),{code:'media_tools_unavailable'});},'reel_probe_unavailable',503],
    [async()=>{throw Object.assign(Error('timeout'),{code:'media_processing_timeout'});},'reel_probe_timeout',503],
    [async()=>'{not JSON','invalid_reel',422],
    [async()=>JSON.stringify({streams:[],format:{duration:'4'}}),'invalid_reel',422],
    [async()=>JSON.stringify({streams:[...probeData().streams,probeData().streams[0]],format:{duration:'4'}}),'invalid_reel',422],
    [async()=>JSON.stringify({streams:[...probeData().streams,probeData().streams[1]],format:{duration:'4'}}),'invalid_reel',422],
    [async()=>JSON.stringify({streams:[...probeData().streams,{codec_type:'subtitle'}],format:{duration:'4'}}),'invalid_reel',422]
  ]){const f=await fixture(t,{execute});await assert.rejects(f.reels.upload(input()),matches(code,status));await clean(f);}
});

test('file upload rejects out-of-range duration, dimensions, codecs, rates, bitrate and audio metadata',async t=>{
  const cases=[
    ['format','duration','2.99','reel_duration'],['format','duration','900.01','reel_duration'],['video','width',1921,'reel_dimensions'],['video','height',0,'reel_dimensions'],['video','codec_name','vp9','reel_video_codec'],
    ['video','avg_frame_rate','22/1','reel_frame_rate'],['video','avg_frame_rate','61/1','reel_frame_rate'],['video','avg_frame_rate','30/0','reel_frame_rate'],['video','bit_rate','25000001','reel_video_bitrate'],['video','pix_fmt','yuv422p','reel_pixel_format'],['video','field_order','tt','reel_interlaced'],['video','tags',{rotate:'90'},'reel_rotation'],
    ['audio','codec_name','mp3','reel_audio_codec'],['audio','sample_rate','96000','reel_audio_sample_rate'],['audio','channels',6,'reel_audio_channels'],['audio','bit_rate','128001','reel_audio_bitrate']
  ];
  for(const [kind,key,value,code] of cases){const response=probeData();(kind==='format'?response.format:response.streams[kind==='video'?0:1])[key]=value;const f=await fixture(t,{response});await assert.rejects(f.reels.upload(input()),matches(code),kind+'.'+key);await clean(f);}
});

test('stored metadata rejects missing required fields and accepts documented application boundaries',()=>{
  for(const field of ['kind','type','size','width','height','duration','videoCodec','frameRate','videoBitrate','pixelFormat','fieldOrder','rotation','fastStart','hasEditList','audioCodec','audioBitrate','audioSampleRate','audioChannels']){
    const m=metadata();delete m[field];assert.throws(()=>validateReelMetadata(m),field);
  }
  for(const patch of [{size:LIMIT,duration:900,width:1920,height:8192,frameRate:60,videoBitrate:25000000},{duration:3,frameRate:23},{audioCodec:null,audioBitrate:0,audioChannels:0,audioSampleRate:0}])assert.equal(validateReelMetadata({...metadata(),...patch}).duration,patch.duration||4);
});

test('ffprobe metadata cannot silently replace missing audio codec or video field order with a passing value',async t=>{
  for(const [kind,key] of [['audio','codec_name'],['video','field_order'],['video','width'],['video','height'],['video','avg_frame_rate'],['video','bit_rate'],['audio','sample_rate'],['audio','channels'],['audio','bit_rate'],['format','duration']]){
    await t.test(kind+'.'+key,async st=>{const response=probeData();delete (kind==='format'?response.format:response.streams[kind==='video'?0:1])[key];const f=await fixture(st,{response});await assert.rejects(f.reels.upload(input()),'missing '+kind+'.'+key+' must not be accepted');await clean(f);});
  }
});

test('identical original uploads deduplicate without adding disk bytes and remain stable after restart',async t=>{
  const f=await fixture(t),first=await f.reels.upload(input()),second=await f.reels.upload(input(videoBytes(),{'x-upload-name':'renamed.mp4'}));assert.equal(second.id,first.id);assert.equal(second.name,'original.mp4');
  assert.deepEqual(await fs.readdir(path.join(f.dir,'originals')),[first.id]);assert.equal(await f.store.usedBytes(),videoBytes().length);
  const store=new Store(f.settings),again=new Reels(f.settings,store,{execute:async()=>JSON.stringify(probeData())});assert.equal((await again.upload(input())).id,first.id);assert.equal(await store.usedBytes(),videoBytes().length);
});

test('disk quota denial happens before probe and does not strand the shared upload lock',async t=>{
  const f=await fixture(t);f.settings.maxStorageBytes=videoBytes().length-1;await assert.rejects(f.reels.upload(input()),matches('storage_full',507));await clean(f);assert.equal(f.calls.length,0);
  f.settings.maxStorageBytes=videoBytes().length;const saved=await f.reels.upload(input());assert.ok(saved.id);assert.equal(await f.store.usedBytes(),videoBytes().length);
});

test('shared lock excludes photo and reel uploads in both directions and always unlocks',async t=>{
  const f=await fixture(t),photos=new Photos(f.store);let release,entered;const enteredProbe=new Promise(r=>entered=r);
  f.reels.execute=async()=>{entered();await new Promise(r=>release=r);return JSON.stringify(probeData());};
  const pending=f.reels.upload(input());await enteredProbe;
  await assert.rejects(photos.upload(input(photoBytes(),{'content-type':'image/jpeg','x-upload-name':'photo.jpg'})),matches('upload_busy',429));await assert.rejects(f.reels.upload(input()),matches('upload_busy',429));release();await pending;assert.equal(f.store.uploadBusy,false);
  let startPhoto,finishPhoto;const photoStarted=new Promise(r=>startPhoto=r);const req=Readable.from((async function*(){startPhoto();await new Promise(r=>finishPhoto=r);yield photoBytes();})());req.headers={'content-type':'image/jpeg','content-length':String(photoBytes().length),'x-upload-name':'photo.jpg'};
  const photoPending=photos.upload(req);await photoStarted;await assert.rejects(f.reels.upload(input()),matches('upload_busy',429));finishPhoto();await photoPending;assert.equal(f.store.uploadBusy,false);assert.equal(Object.keys(f.store.state.media).length,2);
});

test('protected reel upload and status require authentication, Origin and CSRF and expose no provider credentials',async t=>{
  const f=await fixture(t),{req,headers}=await apiFixture(t,f),route='/api/admin/reels',bytes=videoBytes();
  const publicStatus=await(await req('/api/admin/status')).json();assert.equal(publicStatus.reelsUploadReady,undefined);assert.equal(publicStatus.reelMaxBytes,undefined);
  assert.equal((await req(route,{method:'POST',body:bytes})).status,401);
  for(const bad of [{...headers,'X-CSRF-Token':''},{...headers,Origin:'https://evil.invalid'},{...headers,Origin:''}])assert.equal((await req(route,{method:'POST',headers:bad,body:bytes})).status,403);
  assert.equal(f.calls.length,0);const status=await(await req('/api/admin/status',{headers})).json();assert.equal(status.reelsUploadReady,true);assert.equal(status.reelMaxBytes,LIMIT);assert.equal(status.conversionReady,false);assert.equal(f.calls.length,0);
  assert.equal((await req(route,{headers})).status,404);assert.equal((await req(route,{method:'POST',headers:{...headers,'Content-Type':'video/webm'},body:bytes})).status,415);
  const response=await req(route,{method:'POST',headers,body:bytes});assert.equal(response.status,201);const result=await response.json();assert.equal(result.media.sha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(f.calls.length,1);assert.deepEqual(await fs.readFile(f.store.file(result.media.id)),bytes);
});

test('API probe unavailability and timeout report distinct 503 errors and remove the failed upload',async t=>{
  const marker='private-probe-command-output',logs=[],saved=console.error;
  try{
    console.error=value=>logs.push(value);
    for(const [cause,code] of [['media_tools_unavailable','reel_probe_unavailable'],['media_processing_timeout','reel_probe_timeout']]){
      const f=await fixture(t,{execute:async()=>{throw Object.assign(Error(marker),{code:cause,stack:marker,path:marker});}}),{req,headers}=await apiFixture(t,f);
      const response=await req('/api/admin/reels',{method:'POST',headers,body:videoBytes()});assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:code});await clean(f);
      assert.equal(safeFailureCode(code),code);
    }
  }finally{console.error=saved;}
  assert.deepEqual(logs.map(JSON.parse),['reel_probe_unavailable','reel_probe_timeout'].map(error=>({event:'sns_reel_upload_failed',error,httpStatus:503})));
  assert.equal(logs.join('').includes(marker),false);
});

test('upload diagnostics accept only reel upload codes and valid failure HTTP statuses',()=>{
  const marker='private-filename-path-url-body-stack-token',logs=[],saved=console.error;
  const secretFields={message:marker,stack:marker,filename:marker,path:marker,url:marker,body:marker,headers:{Authorization:marker},providerDetails:{httpStatus:422,providerType:marker}};
  try{
    console.error=value=>logs.push(value);
    logReelUploadFailure({...secretFields,code:'reel_audio_bitrate'},422);
    logReelUploadFailure({...secretFields,code:'storage_full'},507);
    logReelUploadFailure({...secretFields,code:marker},422);
    logReelUploadFailure({...secretFields,code:'channel_auth_or_permission'},502);
    for(const status of [200,600,'422',NaN,undefined])logReelUploadFailure({...secretFields,code:'invalid_reel'},status);
  }finally{console.error=saved;}
  assert.deepEqual(logs.map(JSON.parse),[
    {event:'sns_reel_upload_failed',error:'reel_audio_bitrate',httpStatus:422},
    {event:'sns_reel_upload_failed',error:'storage_full',httpStatus:507},
    {event:'sns_reel_upload_failed',error:'request_failed',httpStatus:422},
    {event:'sns_reel_upload_failed',error:'request_failed',httpStatus:502},
    ...Array.from({length:5},()=>({event:'sns_reel_upload_failed',error:'invalid_reel',httpStatus:500}))
  ]);
  assert.equal(logs.join('').includes(marker),false);
});

test('only failed authenticated reel POST requests log sanitized upload diagnostics',async t=>{
  const f=await fixture(t),{req,headers}=await apiFixture(t,f),marker='private-upload-filename-path-url-body-token',logs=[],saved=console.error;
  const upload=f.reels.upload.bind(f.reels),bytes=videoBytes();
  try{
    console.error=value=>logs.push(value);
    assert.equal((await req('/api/admin/reels',{method:'POST',body:bytes})).status,401);
    assert.equal((await req('/api/admin/reels',{method:'POST',headers:{...headers,'X-CSRF-Token':''},body:bytes})).status,403);
    assert.equal((await req('/api/admin/reels',{headers})).status,404);
    assert.equal((await req('/api/admin/reels',{method:'POST',headers,body:bytes})).status,201);
    assert.deepEqual(logs,[]);
    const common={stack:marker,filename:marker,path:marker,url:marker,request:{body:marker,headers:{Authorization:marker}}};
    for(const [failure,status,code] of [
      [Object.assign(Error(marker),common,{code:'reel_fast_start',status:422}),422,'reel_fast_start'],
      [Object.assign(Error(marker),common,{code:marker}),500,'request_failed']
    ]){
      f.reels.upload=async request=>{for await(const chunk of request){}throw failure;};
      const response=await req('/api/admin/reels?'+marker,{method:'POST',headers:{...headers,'X-Upload-Name':marker},body:bytes});
      assert.equal(response.status,status);assert.deepEqual(await response.json(),{error:code});
    }
  }finally{console.error=saved;f.reels.upload=upload;}
  assert.deepEqual(logs.map(JSON.parse),[
    {event:'sns_reel_upload_failed',error:'reel_fast_start',httpStatus:422},
    {event:'sns_reel_upload_failed',error:'request_failed',httpStatus:500}
  ]);
  assert.equal(logs.join('').includes(marker),false);
});

test('signed original reel delivery returns exact bytes, Content-Type and bounded Range without exposing private upload routes',async t=>{
  const f=await fixture(t),saved=await f.reels.upload(input()),[job]=await f.service.jobs.create({type:'instagram-reel',title:'Synthetic original',description:'Local test only',tags:['SpyMedia'],channels:['instagram'],mediaIds:[saved.id]}),{req}=await apiFixture(t,f);
  const url=new URL(f.service.signedUrl(f.store.state.jobs[job.id].assets[0])),route=url.pathname+url.search,bytes=videoBytes();
  const response=await req(route);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'video/mp4');assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
  const range=await req(route,{headers:{Range:'bytes=8-19'}});assert.equal(range.status,206);assert.equal(range.headers.get('content-range'),`bytes 8-19/${bytes.length}`);assert.deepEqual(Buffer.from(await range.arrayBuffer()),bytes.subarray(8,20));
  const head=await req(route,{method:'HEAD'});assert.equal(head.headers.get('content-length'),String(bytes.length));assert.equal((await head.arrayBuffer()).byteLength,0);
  const beyondEnd=await req(route,{headers:{Range:`bytes=0-${bytes.length}`}});assert.equal(beyondEnd.status,206);assert.deepEqual(Buffer.from(await beyondEnd.arrayBuffer()),bytes);assert.equal((await req(route.replace('signature=','signature=0'))).status,403);assert.equal((await req('/api/admin/media/'+saved.id)).status,401);assert.equal(f.calls.length,1);
});
