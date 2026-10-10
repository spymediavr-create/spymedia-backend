import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID,scryptSync} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {config} from '../backend/config.cjs';
import {Store} from '../backend/store.cjs';
import {Service} from '../backend/service.cjs';
import {Connectors} from '../backend/connectors.cjs';
import {createAdminHandler} from '../server-core.cjs';

const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'spymedia-reels-browser-'));
const output=fileURLToPath(new URL('../test-results/instagram-reels/',import.meta.url));await fs.mkdir(output,{recursive:true});
const calls=[],checks=[],errors=[],external=[],dialogs=[];const pass=text=>{checks.push(text);console.log('PASS '+text);};
let service,diagnosticNow=1000,uploadCalls=0,uploadError=null,holdUpload=null,releaseUpload,uncertain=false,accept=false;
const settings=config({SNS_DATA_DIR:dir,SNS_STORAGE_PERSISTENCE:'confirmed',SNS_SINGLE_INSTANCE:'confirmed',SNS_PUBLISH_ENABLED:'true',IG_PUBLISH_ENABLED:'true',META_GRAPH_VERSION:'v25.0',IG_USER_ID:'178414000000001',IG_ACCESS_TOKEN:randomBytes(24).toString('hex'),PUBLIC_ORIGIN:'http://127.0.0.1',MEDIA_SIGNING_KEY:randomBytes(32).toString('hex')});
const store=new Store(settings);await store.init();
const connectors=new Connectors(settings,{mediaUrl:asset=>service.signedUrl(asset),sleep:async()=>{},request:async(method,url,token,body)=>{
  const phase=url.includes('fields=id,user_id,username')?'identity':url.endsWith('/media_publish')?'publish':url.endsWith('/media')?'container':url.includes('fields=status_code')?'processing':'verify';calls.push({method,phase});
  if(phase==='identity')return {data:{id:'900000000001',user_id:settings.env.IG_USER_ID,username:'spymedia_kr'}};
  if(phase==='container'){assert.equal(body.media_type,'REELS');assert.match(body.video_url,new RegExp('^'+settings.origin));assert.equal(body.image_url,undefined);return {data:{id:'reel_container_1'}};}
  if(phase==='processing')return {data:{status_code:'FINISHED'}};
  if(phase==='publish'){if(uncertain)throw Object.assign(Error('synthetic-secret-provider-message'),{status:502,code:'channel_network_failure',uncertain:true});return {data:{id:'reel_media_1'}};}
  if(phase==='verify')return {data:{id:'reel_media_1',permalink:'https://www.instagram.com/reel/synthetic_1/',media_product_type:'REELS'}};
  throw Error('Unexpected mock provider call');
}});
// This suite tests UI and authenticated HTTP integration. The dedicated backend
// suites exercise ffprobe/container validation; this upload double never converts.
const reels={upload:async req=>{
  uploadCalls++;assert.equal(req.headers['content-type'],'video/mp4');assert.ok(req.headers['x-csrf-token']);
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks);
  if(holdUpload)await holdUpload;if(uploadError)throw Object.assign(Error(uploadError.code),uploadError);
  const sha256=createHash('sha256').update(bytes).digest('hex'),duplicate=Object.values(store.state.media).find(m=>m.sha256===sha256);
  if(duplicate)return duplicate;
  const item={id:randomUUID(),name:decodeURIComponent(req.headers['x-upload-name']),kind:'video',type:'video/mp4',profile:'instagram-reel-original',size:bytes.length,sha256,width:360,height:640,duration:4,videoCodec:'h264',audioCodec:null,frameRate:30,videoBitrate:1000000,audioSampleRate:0,audioChannels:0,audioBitrate:0,pixelFormat:'yuv420p',fieldOrder:'progressive',rotation:0,fastStart:true,hasEditList:false,createdAt:new Date().toISOString()};
  await fs.writeFile(store.file(item.id),bytes);await store.transaction(s=>{s.media[item.id]=item;});return item;
}};
service=new Service({settings,store,connectors,reels,diagnosticNow:()=>diagnosticNow,media:{tools:async()=>{throw Error('No conversion allowed');},convert:async()=>{throw Error('No conversion allowed');}}});service.jobs.failureLogger=()=>{};
const salt=randomBytes(16),password=randomBytes(24).toString('hex');
const handler=createAdminHandler({mode:'authenticated',username:'synthetic',passwordHash:salt.toString('hex')+':'+scryptSync(password,salt,64).toString('hex'),secureCookie:false,service});
const server=http.createServer((req,res)=>handler(req,res).then(done=>{if(!done){res.writeHead(404);res.end();}}).catch(e=>{errors.push(e.message);res.end();}));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;settings.origin=origin;
let browser;
try{
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.route('**/*',route=>{const url=route.request().url();if(url.startsWith(origin+'/')||url.startsWith('blob:')||url.startsWith('data:'))return route.continue();external.push(url);return route.abort();});
  await context.addInitScript(()=>{const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);window.__objects={created:[],revoked:[]};URL.createObjectURL=value=>{const url=create(value);window.__objects.created.push(url);return url;};URL.revokeObjectURL=url=>{window.__objects.revoked.push(url);revoke(url);};});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{dialogs.push(d.message());await(accept?d.accept():d.dismiss());});
  assert.equal((await context.request.post(origin+'/api/admin/reels',{data:Buffer.from('no auth'),headers:{'Content-Type':'video/mp4','X-Upload-Name':'unauthorized.mp4'}})).status(),401);
  await page.goto(origin+'/admin/login');await page.locator('#login-id').fill('synthetic');await page.locator('#login-password').fill(password);await page.locator('#login-submit').click();await page.waitForURL(origin+'/admin');await page.waitForFunction(()=>!document.getElementById('reels-check').disabled);
  assert.equal(calls.length,0);assert.equal(uploadCalls,0);assert.equal(await page.locator('#reels-send').isDisabled(),true);assert.equal(await page.locator('#image-input').count(),1);assert.equal(await page.locator('#youtube-url').count(),1);assert.equal(await page.locator('.ig-helper-link').getAttribute('href'),'/admin/instagram');
  assert.equal(await page.getByRole('tab').count(),5);assert.equal(await page.locator('.channel-card[data-channel=instagram]').isDisabled(),true);pass('main admin retains YouTube/photo/link workflows and separate Instagram helper; load calls no provider and upload needs login');
  await page.locator('#title').fill('서울 강변 릴스');await page.locator('#description').fill('저장할 설명 <script>literal</script>');await page.locator('#tag-input').fill('#SpyMedia #서울');await page.locator('#add-tags').click();
  assert.match(await page.locator('#reels-caption').textContent(),/#SpyMedia #서울/);assert.equal(await page.evaluate(()=>window.literal),undefined);assert.equal(await page.inputValue('#youtube-url'),'');pass('reel caption reuses shared title, description and tags safely without needing a YouTube URL');
  await page.locator('#reels-file').setInputFiles({name:'empty.mp4',mimeType:'video/mp4',buffer:Buffer.alloc(0)});assert.match(await page.locator('#reels-feedback').textContent(),/내용이 없는/);
  await page.locator('#reels-file').setInputFiles({name:'wrong.webm',mimeType:'video/webm',buffer:Buffer.from('wrong')});assert.match(await page.locator('#reels-feedback').textContent(),/MP4 또는 MOV/);assert.equal(uploadCalls,0);
  await page.evaluate(()=>{const input=document.getElementById('reels-file'),file=new File(['x'],'oversize.mp4',{type:'video/mp4'});Object.defineProperty(file,'size',{value:300000001});Object.defineProperty(input,'files',{configurable:true,value:[file]});input.dispatchEvent(new Event('change'));delete input.files;});
  assert.match(await page.locator('#reels-feedback').textContent(),/300MB/);assert.equal(uploadCalls,0);pass('empty, unsupported and over-300MB inputs are rejected before any upload');
  const video=Buffer.from(await page.evaluate(async()=>{
    if(!MediaRecorder.isTypeSupported('video/mp4;codecs=avc1'))throw Error('This test requires an H.264 MP4-capable local Chromium');
    const c=document.createElement('canvas');c.width=360;c.height=640;const g=c.getContext('2d'),stream=c.captureStream(30),parts=[];
    const recorder=new MediaRecorder(stream,{mimeType:'video/mp4;codecs=avc1',videoBitsPerSecond:1000000});recorder.ondataavailable=e=>parts.push(e.data);
    const draw=()=>{g.fillStyle='#071b35';g.fillRect(0,0,360,640);g.fillStyle='#11b5cd';g.fillRect(24,300,312,230);g.fillStyle='white';g.font='bold 26px sans-serif';g.fillText('SPYMEDIA',28,100);g.font='17px sans-serif';g.fillText('LOCAL REEL TEST',28,135);};draw();const timer=setInterval(draw,33);
    const finished=new Promise(resolve=>recorder.onstop=resolve);recorder.start();await new Promise(resolve=>setTimeout(resolve,4200));recorder.stop();await finished;clearInterval(timer);stream.getTracks().forEach(t=>t.stop());return [...new Uint8Array(await new Blob(parts,{type:'video/mp4'}).arrayBuffer())];
  }));
  const file={name:'서울 강변 원본.mp4',mimeType:'video/mp4',buffer:video};
  await page.locator('#reels-file').setInputFiles(file);await page.waitForFunction(()=>document.getElementById('reels-preview').videoWidth===360&&!document.getElementById('reels-upload').disabled);
  assert.match(await page.locator('#reels-file-info').textContent(),/360 × 640px/);assert.equal(uploadCalls,0);assert.match(await page.locator('#reels-local-check').textContent(),/최종 검사는 서버/);pass('real 9:16 MP4 previews locally and accurately distinguishes browser metadata from final server checks');
  assert.equal(await page.locator('#reels-file').evaluate(input=>input.files[0]?.name),file.name);
  const oldUrl=await page.locator('#reels-preview').getAttribute('src');await page.locator('#reels-clear').click();assert.equal(await page.locator('#reels-preview').isHidden(),true);assert.equal(await page.locator('#reels-preview').getAttribute('src'),null);assert.equal(await page.evaluate(url=>window.__objects.revoked.includes(url),oldUrl),true);pass('selection retains its visible filename; clearing releases the object URL and detaches the video');
  await page.locator('#reels-file').setInputFiles(file);await page.waitForFunction(()=>!document.getElementById('reels-upload').disabled);
  const assertUploadFinished=async()=>{
    assert.equal(await page.locator('#reels-progress-wrap').isHidden(),true);assert.equal(await page.locator('#reels-progress-label').textContent(),'');assert.equal(await page.locator('#reels-progress').evaluate(progress=>progress.value),0);
    assert.equal(await page.locator('#reels-cancel').isHidden(),true);assert.equal(await page.locator('#reels-file').isEnabled(),true);assert.equal(await page.locator('#reels-upload').isEnabled(),true);assert.equal(await page.locator('#reels-prepare').isDisabled(),true);
  };
  for(const failure of [{status:422,code:'reel_video_codec',message:'H.264 또는 HEVC'},{status:503,code:'reel_probe_unavailable',message:'서버의 영상 검사 도구'}]){
    uploadError={status:failure.status,code:failure.code};holdUpload=new Promise(resolve=>releaseUpload=resolve);
    await page.locator('#reels-upload').click();await page.waitForFunction(()=>document.getElementById('reels-progress').value===100&&document.getElementById('reels-progress-label').textContent==='파일 전송 완료 · 검사 결과 대기');
    assert.equal(await page.locator('#reels-upload').isDisabled(),true);assert.equal(await page.locator('#reels-media-status').textContent(),'');assert.equal(await page.locator('#reels-media-status').evaluate(status=>status.classList.contains('reels-error')),false);
    if(failure.status===503){
      const pendingUploads=uploadCalls;await page.waitForFunction(()=>document.getElementById('reels-media-status').textContent.includes('서버 응답이 지연'),null,{timeout:75000});
      assert.match(await page.locator('#reels-media-status').textContent(),/취소해도 서버 저장 여부는 보관 콘텐츠에서 별도 확인/);assert.equal(uploadCalls,pendingUploads);assert.equal(await page.locator('#reels-cancel').isVisible(),true);assert.equal(await page.locator('#reels-upload').isDisabled(),true);assert.equal(Object.keys(store.state.media).length,0);
      pass('a response pending for 60 seconds shows a file-level delay notice without aborting or submitting again');
    }
    const response=page.waitForResponse(response=>response.url()===origin+'/api/admin/reels');releaseUpload();holdUpload=null;assert.equal((await response).status(),failure.status);
    await page.waitForFunction(message=>document.getElementById('reels-media-status').textContent.includes(message)&&!document.getElementById('reels-upload').disabled,failure.message);
    assert.equal(await page.locator('#reels-media-status').isVisible(),true);assert.equal(await page.locator('#reels-media-status').evaluate(status=>status.classList.contains('reels-error')),true);
    assert.equal(await page.locator('#reels-media-status').textContent(),await page.locator('#reels-feedback').textContent());assert.equal(await page.locator('#reels-drop #reels-media-status').count(),1);await assertUploadFinished();
    assert.equal(calls.length,0);assert.equal(Object.keys(store.state.media).length,0);uploadError=null;
    pass('HTTP '+failure.status+' after 100% upload replaces processing with a visible file-level error and allows retry without preparing or publishing');
  }
  await page.locator('#reels-drop').screenshot({path:path.join(output,'reels-upload-error.png')});
  holdUpload=new Promise(resolve=>releaseUpload=resolve);await page.locator('#reels-upload').click();await page.locator('#reels-cancel').waitFor({state:'visible'});assert.equal(await page.locator('#reels-upload').isDisabled(),true);await page.locator('#reels-cancel').click();await page.waitForFunction(()=>document.getElementById('reels-feedback').textContent.includes('업로드를 취소'));
  assert.match(await page.locator('#reels-media-status').textContent(),/업로드를 취소/);assert.equal(await page.locator('#reels-media-status').evaluate(status=>status.classList.contains('reels-error')),true);await assertUploadFinished();releaseUpload();holdUpload=null;pass('cancelled upload clears processing, shows cancellation beside the file and allows retry without preparing a job');
  await page.locator('#reels-upload').click();await page.waitForFunction(()=>document.getElementById('reels-media-status').textContent.includes('서버 검사 완료'));
  assert.equal(calls.length,0);const savedMedia=Object.values(store.state.media)[0];assert.deepEqual(await fs.readFile(store.file(savedMedia.id)),video);assert.equal(await page.locator('#reels-prepare').isEnabled(),true);assert.equal(await page.locator('#reels-upload').isDisabled(),true);assert.equal(await page.locator('#reels-progress-wrap').isHidden(),true);assert.equal(await page.locator('#reels-progress-label').textContent(),'');assert.equal(await page.locator('#reels-media-status').evaluate(status=>status.classList.contains('reels-error')),false);pass('successful retry clears the error style and processing status, preserves every original byte and enables preparation without provider requests');
  await page.locator('#reels-prepare').click();await page.waitForFunction(()=>document.querySelector('#reels-jobs .record-item[data-status=prepared]'));
  assert.equal(calls.length,0);assert.equal(await page.locator('#reels-send').isDisabled(),true);await page.locator('#reels-check').click();await page.waitForFunction(()=>document.getElementById('reels-connection-status').textContent.includes('계정 확인됨'));
  assert.deepEqual(calls,[{method:'GET',phase:'identity'}]);assert.match(await page.locator('#reels-connection-status').textContent(),/글쓰기 권한은 아직 검증하지/);assert.equal(await page.locator('#reels-send').isEnabled(),true);pass('preparation saves an immutable job; explicit identity check alone cannot claim publish permissions');
  await page.locator('#description').fill('아직 저장하지 않은 편집 문구');assert.match(await page.locator('#reels-saved-note').textContent(),/문구가 다릅니다/);
  await page.locator('#reels-send').click();assert.equal(calls.length,1);assert.match(dialogs.at(-1),/spymedia_kr/);assert.match(dialogs.at(-1),/서울 강변 원본.mp4/);assert.match(dialogs.at(-1),/360 × 640px/);assert.match(dialogs.at(-1),/저장할 설명/);assert.equal(dialogs.at(-1).includes('아직 저장하지 않은 편집 문구'),false);pass('cancelled final confirmation lists saved account, original, dimensions and caption; unsaved input is excluded');
  await page.locator('#instagram-reels').screenshot({path:path.join(output,'reels-desktop.png')});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.locator('#instagram-reels').screenshot({path:path.join(output,'reels-mobile.png')});await page.setViewportSize({width:1440,height:1000});pass('integrated reel workflow fits desktop and 390px mobile');
  accept=true;await page.locator('#reels-send').click();await page.waitForFunction(()=>document.querySelector('#reels-jobs .record-item[data-status=succeeded]'));
  assert.equal(calls.filter(c=>c.phase==='publish').length,1);assert.equal(await page.locator('#reels-send').isDisabled(),true);assert.equal(await page.locator('#reels-jobs a').getAttribute('href'),'https://www.instagram.com/reel/synthetic_1/');assert.equal(await page.evaluate(()=>window.literal),undefined);pass('confirmed mock submission publishes exactly once and displays the verified Instagram result');
  await page.locator('#reels-prepare').click();await page.waitForFunction(()=>document.querySelector('#reels-jobs .record-item[data-status=prepared]'));uncertain=true;await page.locator('#reels-send').click();await page.waitForFunction(()=>document.querySelector('#reels-jobs .record-item[data-status=unknown]'));
  assert.equal(await page.locator('#reels-send').isDisabled(),true);assert.equal(await page.locator('#reels-jobs').getByRole('button',{name:'실패 작업 다시 준비',exact:true}).count(),0);assert.equal((await page.locator('body').textContent()).includes('synthetic-secret-provider-message'),false);const attempts=calls.filter(c=>c.phase==='publish').length;
  await page.locator('#reels-prepare').click();await page.waitForFunction(()=>!document.getElementById('reels-prepare').disabled);assert.equal(await page.locator('#reels-send').isDisabled(),true);assert.equal(calls.filter(c=>c.phase==='publish').length,attempts);pass('uncertain publication stops re-sending; duplicate preparation reuses the protected job without exposing provider secrets');
  await page.reload();await page.waitForFunction(()=>document.querySelector('#reels-jobs .record-item[data-status=unknown]'));assert.equal(await page.locator('#reels-file').inputValue(),'');assert.equal(await page.locator('#reels-upload').isDisabled(),true);assert.equal(await page.locator('#reels-jobs .record-item').count(),2);assert.equal(calls.filter(c=>c.phase==='publish').length,attempts);pass('reload restores saved reel results without retaining local files or publishing again');
  await page.goto(origin+'/admin/instagram');await page.locator('#ig-photo').waitFor();assert.equal(await page.locator('#ig-open').getAttribute('href'),'https://business.facebook.com/');assert.equal(await page.locator('#ig-copy').count(),1);pass('existing Instagram photo publication and Business Suite helper remain available');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await fs.writeFile(path.join(output,'summary.json'),JSON.stringify({checks,errors,external,mockedProviderCalls:calls,uploadCalls,actualInstagramRequests:0,actualPosts:0},null,2));
}finally{
  releaseUpload?.();await browser?.close();await new Promise(resolve=>server.close(resolve));assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));await fs.rm(dir,{recursive:true,force:true});
}
