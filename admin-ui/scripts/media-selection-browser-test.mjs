import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../public/',import.meta.url));
const output=fileURLToPath(new URL('../test-results/media-selection/',import.meta.url));
await fs.mkdir(output,{recursive:true});
const checks=[],errors=[],external=[],starts=[],uploads=[],drafts=[];
const ok=message=>{checks.push(message);console.log('PASS '+message);};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPucAAAAASUVORK5CYII=','base64');
const asset=(kind,id)=>({id,kind,type:kind==='video'?'video/webm':'image/png',preview:kind==='video'?'/fixture.webm':'/fixture.png'});
const source=(kind,name)=>({kind,name});
const oldJob={id:'old-photo',channel:'facebook',status:'prepared',title:'이전 사진 작업 · 모의 자료',caption:'Local fixture only',sourceMedia:[source('image','previous-photo.png')],assets:[asset('image','old-photo-asset')]};
let jobs=[structuredClone(oldJob),{...structuredClone(oldJob),id:'legacy-photo',title:'파일명 없는 과거 작업 · 모의 자료',sourceMedia:undefined},
  {...structuredClone(oldJob),id:'unknown-media',title:'종류 기록 없는 과거 작업 · 모의 자료',sourceMedia:[{kind:null,name:null}],assets:[]},
  {...structuredClone(oldJob),id:'failed-photo',title:'실패 작업 · 모의 자료',status:'failed',error:'interrupted',canRetry:true,sourceMedia:[source('image','retry-photo.png')]},
  {...structuredClone(oldJob),id:'two-photos',title:'두 사진 작업 · 모의 자료',sourceMedia:[source('image','first-photo.png'),source('image','second-photo.png')],assets:[asset('image','a'),asset('image','b')]},
  {...structuredClone(oldJob),id:'long-photo',title:'긴 파일명 · 모의 자료',sourceMedia:[source('image','긴_파일명_'+ 'a'.repeat(160)+'.png')]},
  {...structuredClone(oldJob),id:'text-photo',title:'파일명 텍스트 검사 · 모의 자료',sourceMedia:[source('image','<img src=x onerror=alert(1)>.png')]},
  {...structuredClone(oldJob),id:'blog-draft',channel:'blog',title:'블로그 · 모의 자료',manuscript:'local draft',originals:[]}];
let video=Buffer.alloc(0),releaseUpload,releaseRetry,failUpload=false,failStart=false,sequence=0,retries=0;
const pendingUploads=new Map();
const json=(res,value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
const server=http.createServer(async(req,res)=>{
  try {
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(req.method==='GET'&&pathname==='/api/admin/status')return json(res,{mode:'authenticated',authenticated:true,uploadsConnected:true,storageReady:true,publishingEnabled:true,csrfToken:'synthetic-local-fixture',channels:Object.fromEntries(['youtube','instagram','x','facebook','blog'].map(id=>[id,{configured:true,verified:false}]))});
    if(req.method==='GET'&&pathname==='/api/admin/jobs')return json(res,{jobs});
    if(req.method==='GET'&&pathname==='/fixture.png'){res.writeHead(200,{'Content-Type':'image/png'});return res.end(png);}
    if(req.method==='GET'&&pathname==='/fixture.webm'){res.writeHead(200,{'Content-Type':'video/webm'});return res.end(video);}
    if(req.method==='POST') {
      const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);
      if(pathname==='/api/admin/media') {
        uploads.push(req.headers['content-type']);
        if(releaseUpload)await new Promise(resolve=>{releaseUpload.resolve=resolve;});
        if(failUpload){failUpload=false;return json(res,{error:'invalid_media'},422);}
        const id='uploaded-'+(++sequence),kind=req.headers['content-type'].startsWith('video/')?'video':'image';
        const media={id,kind,name:decodeURIComponent(req.headers['x-upload-name'])};pendingUploads.set(id,media);return json(res,{media});
      }
      const data=JSON.parse(body);
      if(pathname==='/api/admin/jobs') {
        drafts.push(data);assert.equal(data.channels.length,1);
        const sourceMedia=data.mediaIds.map(id=>pendingUploads.get(id));
        const existing=jobs.find(job=>job.title===data.title&&job.channel===data.channels[0]);
        if(existing)return json(res,{jobs:[existing]});
        const created={id:'new-'+(++sequence),channel:data.channels[0],title:data.title,caption:data.description,status:'prepared',sourceMedia,assets:sourceMedia.map(item=>asset(item.kind,item.id)),youtubePrivacy:data.channels[0]==='youtube'?data.youtubePrivacy:null};
        jobs=[created,...jobs];return json(res,{jobs:[created]});
      }
      if(pathname==='/api/admin/jobs/start') {
        starts.push(data.ids);if(failStart){failStart=false;return json(res,{error:'channel_auth_or_permission'},409);}
        jobs=jobs.map(job=>data.ids.includes(job.id)?{...job,status:'succeeded',result:{externalId:'mock-result-'+job.id}}:job);return json(res,{jobs});
      }
      if(pathname==='/api/admin/jobs/retry') {
        retries++;if(releaseRetry)await new Promise(resolve=>{releaseRetry.resolve=resolve;});
        jobs=jobs.map(job=>job.id===data.id?{...job,status:'prepared',error:null,canRetry:false}:job);return json(res,{jobs});
      }
      return json(res,{error:'not_found'},404);
    }
    const files=new Map([['/admin','admin.html'],...['styles.css','app.js','domain.js','server-ui.js'].map(name=>['/admin-assets/'+name,name])]);
    const file=files.get(pathname);if(!file){res.writeHead(404);return res.end();}
    res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':'text/javascript; charset=utf-8'});res.end(await fs.readFile(path.join(root,file)));
  }catch(e){errors.push(e.message);if(!res.headersSent)json(res,{error:'mock_failure'},500);else res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1100}});
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',route=>{
  const url=route.request().url();if(url.startsWith(origin+'/')||url.startsWith('blob:'+origin)||url.startsWith('data:'))return route.continue();
  external.push(url);return route.abort();
});
const card=title=>page.locator('.job-card').filter({has:page.locator('h3',{hasText:title})});
const prepare=()=>page.click('#prepare-server');
const waitForGate=async gate=>{
  const deadline=Date.now()+10000;
  while(!gate.resolve){assert.ok(Date.now()<deadline,'Mock request did not reach its gate');await new Promise(resolve=>setTimeout(resolve,10));}
};
try {
  await page.goto(origin+'/admin');await card(oldJob.title).waitFor();
  assert.match(await card(oldJob.title).textContent(),/사진 1장/);assert.match(await card(oldJob.title).textContent(),/previous-photo.png/);
  assert.match(await card('파일명 없는 과거 작업').textContent(),/파일명 기록 없음/);
  assert.match(await card('종류 기록 없는 과거 작업').textContent(),/미디어 종류 확인 필요/);
  assert.match(await card('두 사진 작업').textContent(),/사진 2장/);assert.match(await card('두 사진 작업').textContent(),/second-photo.png/);
  assert.equal(await card('파일명 텍스트 검사').locator('.job-files img').count(),0);
  assert.equal(await card('파일명 텍스트 검사').locator('.job-files').textContent(),'<img src=x onerror=alert(1)>.png');
  assert.equal(await card('블로그').locator('input').isDisabled(),true);ok('Job media counts, filenames, honest legacy fallback and plain-text filenames');
  const channels=page.locator('.channel-card.selected');
  await page.locator('.channel-card[data-channel=instagram]').click();
  assert.equal(await channels.count(),1);assert.equal(await page.getByRole('tab').count(),5);
  await page.getByRole('tab',{name:'유튜브',exact:true}).click();assert.equal(await channels.count(),1);ok('All five preview tabs remain independent of Facebook-only sending');
  const videoBase64=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const ctx=canvas.getContext('2d');ctx.fillStyle='#187e9b';ctx.fillRect(0,0,320,180);
    const stream=canvas.captureStream(10),recorder=new MediaRecorder(stream,{mimeType:'video/webm'}),parts=[];
    recorder.ondataavailable=e=>parts.push(e.data);const stopped=new Promise(resolve=>recorder.onstop=resolve);
    recorder.start();await new Promise(resolve=>setTimeout(resolve,300));recorder.stop();await stopped;stream.getTracks().forEach(track=>track.stop());
    return btoa(String.fromCharCode(...new Uint8Array(await new Blob(parts).arrayBuffer())));
  });video=Buffer.from(videoBase64,'base64');
  await page.locator('#video-input').setInputFiles({name:'mock-drone.webm',mimeType:'video/webm',buffer:video});
  await page.locator('#image-input').setInputFiles({name:'mock-photo.png',mimeType:'image/png',buffer:png});
  await page.getByRole('tab',{name:'페이스북',exact:true}).click();
  assert.equal(await page.locator('#media-choice span').textContent(),'준비할 미디어');
  await page.locator('[data-media=video]').click();
  await page.fill('#title','새 영상 작업 · 모의 자료');await page.fill('#description','실제 계정과 연결하지 않는 로컬 검증');
  await card(oldJob.title).locator('input').check();assert.equal(await page.locator('#start-server').isEnabled(),true);
  releaseUpload={};const beforeUploads=uploads.length;
  await prepare();await page.waitForFunction(()=>document.getElementById('prepare-server').disabled);
  assert.equal(await card(oldJob.title).locator('input').isChecked(),false);
  assert.equal(await card(oldJob.title).locator('input').isDisabled(),true);
  await page.evaluate(()=>{document.getElementById('prepare-server').click();document.getElementById('prepare-server').click();});
  await page.waitForFunction(()=>document.querySelectorAll('#server-jobs input:checked').length===0);
  await waitForGate(releaseUpload);
  const unblock=releaseUpload.resolve;releaseUpload=null;unblock();
  await card('새 영상 작업').waitFor();await page.waitForFunction(()=>!document.getElementById('prepare-server').disabled);
  assert.equal(uploads.length-beforeUploads,1);assert.equal(drafts.length,1);assert.deepEqual(drafts[0].channels,['facebook']);
  assert.match(await card('새 영상 작업').textContent(),/영상 1개/);assert.match(await card('새 영상 작업').textContent(),/mock-drone.webm/);
  assert.equal(await page.locator('#server-jobs input:checked').count(),0);assert.equal(await page.locator('#start-server').isDisabled(),true);assert.equal(starts.length,0);
  ok('Preparing video clears old photo selection, locks controls and ignores repeated clicks without posting');
  await card('새 영상 작업').locator('input').check();let videoConfirmation;
  page.once('dialog',async dialog=>{videoConfirmation=dialog.message();await dialog.dismiss();});await page.click('#start-server');
  assert.match(videoConfirmation,/페이스북 · 영상 1개/);assert.match(videoConfirmation,/mock-drone.webm/);assert.doesNotMatch(videoConfirmation,/previous-photo.png/);assert.equal(starts.length,0);
  ok('Video confirmation identifies the selected video and filename; cancel sends no request');
  await page.fill('#title','실패할 새 준비 · 모의 자료');failUpload=true;const failedUploads=uploads.length;
  await prepare();await page.waitForFunction(()=>!document.getElementById('prepare-server').disabled);
  assert.equal(uploads.length-failedUploads,1);assert.equal(await page.locator('#server-jobs input:checked').count(),0);
  assert.equal(await page.locator('#start-server').isDisabled(),true);assert.equal(await card(oldJob.title).locator('input').isDisabled(),false);ok('Failed preparation preserves jobs and leaves previous selections cleared');
  await page.fill('#title','새 사진 작업 · 모의 자료');await page.locator('[data-media=image]').click();await prepare();await card('새 사진 작업').waitFor();await page.waitForFunction(()=>!document.getElementById('prepare-server').disabled);
  assert.match(await card('새 사진 작업').textContent(),/사진 1장/);assert.match(await card('새 사진 작업').textContent(),/mock-photo.png/);
  assert.equal(uploads.at(-1),'image/png');assert.equal(drafts.at(-1).mediaIds.length,1);assert.equal(await page.getByRole('tab').count(),5);ok('Image choice prepares only the chosen photo without adding a video publication');
  await card('새 사진 작업').locator('input').check();let photoConfirmation;
  page.once('dialog',async dialog=>{photoConfirmation=dialog.message();await dialog.dismiss();});await page.click('#start-server');assert.match(photoConfirmation,/사진 1장/);assert.match(photoConfirmation,/mock-photo.png/);assert.doesNotMatch(photoConfirmation,/mock-drone.webm/);
  await prepare();await page.waitForFunction(()=>!document.getElementById('prepare-server').disabled);assert.equal(await page.locator('#server-jobs input:checked').count(),0);
  assert.equal(await card('새 사진 작업').count(),1);assert.equal(starts.length,0);ok('Photo confirmation and repeated preparation do not retain stale selection or duplicate jobs');
  await card('새 영상 작업').locator('input').check();failStart=true;
  page.once('dialog',dialog=>dialog.accept());await page.click('#start-server');await page.waitForFunction(()=>!document.getElementById('prepare-server').disabled);
  assert.equal(starts.length,1);assert.equal(await card('새 영상 작업').locator('input').isChecked(),true);assert.equal(await card('새 영상 작업').locator('input').isDisabled(),false);
  ok('Mock send failure unlocks controls and keeps its explicitly selected job available');
  await card('새 영상 작업').locator('input').uncheck();releaseRetry={};
  await card('실패 작업').getByRole('button',{name:'실패 작업 다시 준비'}).click();
  await page.evaluate(()=>{const button=[...document.querySelectorAll('.job-card button')].find(b=>b.textContent==='실패 작업 다시 준비');button.click();});
  await waitForGate(releaseRetry);const retryUnblock=releaseRetry.resolve;releaseRetry=null;retryUnblock();
  await page.waitForFunction(()=>!document.getElementById('prepare-server').disabled);assert.equal(retries,1);assert.equal(await page.locator('#server-jobs input:checked').count(),0);assert.equal(starts.length,1);ok('Repeated mock retry prepares once without selecting or sending automatically');
  await page.screenshot({path:path.join(output,'jobs-desktop.png'),fullPage:true});
  for(const width of [390,360]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.getByRole('tab').count(),5);}
  await page.screenshot({path:path.join(output,'jobs-mobile.png'),fullPage:true});ok('360px and 390px layouts wrap long filenames without horizontal overflow');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);ok('Synthetic authentication and files only; no browser errors or external requests');
  await fs.writeFile(path.join(output,'verification.json'),JSON.stringify({checks,errors,external,confirmation:{video:videoConfirmation,photo:photoConfirmation},mockOnly:true,realPublications:0,mockStartRequests:starts.length,mockRetries:retries},null,2));
}finally{
  if(releaseUpload?.resolve)releaseUpload.resolve();if(releaseRetry?.resolve)releaseRetry.resolve();
  await browser.close();await new Promise(resolve=>server.close(resolve));
}
