import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import {randomBytes,scryptSync} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {config} from '../backend/config.cjs';
import {Store} from '../backend/store.cjs';
import {Service} from '../backend/service.cjs';
import {createAdminHandler} from '../server-core.cjs';

const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const output=fileURLToPath(new URL('../test-results/blog/',import.meta.url));
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'spymedia-blog-browser-'));
await fs.mkdir(output,{recursive:true});
const checks=[],errors=[],external=[],naverRequests=[],localRequests=[],postBodies=[];
const pass=message=>{checks.push(message);console.log('PASS '+message);};
let providerCalls=0,mediaToolCalls=0,blogFailure=null,delayedJobsGet=null,releaseJobsGet=null,browser,server;
const settings=config({SNS_DATA_DIR:dir,SNS_STORAGE_PERSISTENCE:'confirmed',SNS_SINGLE_INSTANCE:'confirmed',SNS_PUBLISH_ENABLED:'false'});
const store=new Store(settings);
const forbiddenProvider=async()=>{providerCalls++;throw Error('Provider requests are prohibited in this local browser test');};
const service=new Service({settings,store,connectors:{availability:()=>({youtube:false,instagram:false,x:false,facebook:false,blog:true}),publish:forbiddenProvider,checkFacebookConnection:forbiddenProvider,checkInstagramConnection:forbiddenProvider,checkXConnection:forbiddenProvider},media:{tools:async()=>{mediaToolCalls++;throw Error('Media probing is prohibited');},convert:async()=>{mediaToolCalls++;throw Error('Media conversion is prohibited');}}});
service.youtubeSource={fetch:forbiddenProvider};
const salt=randomBytes(16),password=randomBytes(24).toString('hex');
const handler=createAdminHandler({mode:'authenticated',username:'synthetic',passwordHash:salt.toString('hex')+':'+scryptSync(password,salt,64).toString('hex'),secureCookie:false,service});
server=http.createServer((req,res)=>{
  localRequests.push({method:req.method,path:new URL(req.url,'http://localhost').pathname});
  handler(req,res).then(done=>{if(!done){res.writeHead(404);res.end();}}).catch(error=>{errors.push(error.message);if(!res.headersSent)res.writeHead(500);res.end();});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const NAVER='https://blog.naver.com/spymedia';

try{
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1100},acceptDownloads:true});
  await context.addInitScript(()=>{
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{if(window.__clipboardFails)throw Error('Synthetic clipboard denial');if(window.__clipboardDelay)await new Promise(resolve=>{window.__resolveClipboard=resolve;});window.__copied=text;}}});
    const exec=document.execCommand.bind(document);
    document.execCommand=(command,...args)=>window.__clipboardFails&&command==='copy'?false:exec(command,...args);
  });
  await context.route('**/*',async route=>{
    const request=route.request(),url=request.url();
    if(url===NAVER){naverRequests.push({url,headers:await request.allHeaders()});return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Local Naver placeholder</title><p>Network blocked: local test only.</p>'});}
    if(url.startsWith(origin+'/')||url.startsWith('blob:'+origin)||url.startsWith('data:')){
      if(url===origin+'/api/admin/jobs'&&request.method()==='GET'&&delayedJobsGet){
        const delayed=delayedJobsGet;delayed.entered();await delayed.gate;
        return route.fulfill({status:200,contentType:'application/json',body:delayed.body});
      }
      if(url===origin+'/api/admin/jobs'&&request.method()==='POST'){
        const body=request.postDataJSON();postBodies.push(body);
        if(body.type==='blog-draft'&&blogFailure)return route.fulfill({status:blogFailure.status,contentType:'application/json',body:JSON.stringify({error:blogFailure.error})});
      }
      return route.continue();
    }
    external.push(url);return route.abort();
  });
  context.on('page',p=>p.on('pageerror',error=>errors.push(error.message)));
  const page=await context.newPage();
  let acceptDialog=true;
  page.on('dialog',dialog=>acceptDialog?dialog.accept():dialog.dismiss());
  const enter=async()=>{
    await page.goto(origin+'/admin');
    if(new URL(page.url()).pathname==='/admin/login'){
      await page.locator('#login-id').fill('synthetic');await page.locator('#login-password').fill(password);await page.locator('#login-submit').click();await page.waitForURL(origin+'/admin');
    }
    await page.locator('#blogWorkspace').waitFor();await page.waitForFunction(()=>document.getElementById('blog-save')&&!document.getElementById('blog-save').disabled);
  };
  const save=async()=>{
    const responsePromise=page.waitForResponse(response=>response.url()===origin+'/api/admin/jobs'&&response.request().method()==='POST');
    await page.locator('#blog-save').click();const response=await responsePromise;const data=await response.json();
    assert.equal(response.status(),202,JSON.stringify(data));assert.equal(data.jobs.length,1);assert.equal(data.jobs[0].type,'blog-draft');
    await page.waitForFunction(()=>!document.getElementById('blog-save').disabled);
    return data.jobs[0];
  };
  const generate=async()=>{await page.locator('#blog-generate').click();};
  const row=name=>page.locator('#blog-photos [data-photo-key]').filter({hasText:name});
  const jobRow=title=>page.locator('#blog-jobs article').filter({hasText:title});
  const reopen=async title=>{await jobRow(title).getByRole('button',{name:'원고 불러오기',exact:true}).click();};
  const download=async locator=>{const pending=page.waitForEvent('download');await locator.click();const item=await pending;assert.equal(await item.failure(),null);return {name:item.suggestedFilename(),bytes:await fs.readFile(await item.path())};};
  const selectedText=()=>page.evaluate(()=>{const el=document.activeElement;return el&&typeof el.selectionStart==='number'?el.value.slice(el.selectionStart,el.selectionEnd):String(getSelection());});

  assert.equal((await context.request.get(origin+'/admin',{maxRedirects:0})).status(),303);
  await enter();
  await page.locator('#title').fill('사진 없는 블로그 원고');await page.locator('#description').fill('유튜브 주소 없이 작성한 원고입니다.');await generate();
  assert.equal(await page.locator('#blog-title').inputValue(),'사진 없는 블로그 원고');
  assert.match(await page.locator('#blog-body').inputValue(),/유튜브 주소 없이 작성한 원고입니다/);
  const textJob=await save();
  assert.equal(textJob.youtubeUrl,null);assert.deepEqual(textJob.assets,[]);assert.equal(textJob.canSend,false);assert.equal(textJob.canRetry,false);
  assert.equal(store.state.jobs[textJob.id].publicationAttempted,false);
  pass('Authenticated administrator saves a text-only blog draft without YouTube, photos, or a publish action');

  const photos=[];
  for(const [index,color] of ['#113457','#c55731','#379754'].entries()){
    const bytes=Buffer.from(await page.evaluate(({index,color})=>{const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;const g=canvas.getContext('2d');g.fillStyle=color;g.fillRect(0,0,640,480);g.fillStyle='#fff';g.font='32px sans-serif';g.fillText('LOCAL ORIGINAL '+(index+1),30,80);return canvas.toDataURL('image/jpeg',0.86).split(',')[1];},{index,color}),'base64');
    photos.push({name:`synthetic-blog-${index+1}.jpg`,mimeType:'image/jpeg',buffer:bytes});
  }
  await page.locator('#image-input').setInputFiles(photos);
  assert.equal(await page.locator('#blog-photos [data-photo-key]').count(),0);
  assert.equal(await page.locator('#blog-source-notice').isVisible(),true);
  await page.locator('#title').fill('강변 촬영 이야기');await page.locator('#description').fill('첫 번째 문단입니다.\n\n두 번째 문단입니다.');
  await page.locator('#region').fill('서울');await page.locator('#shoot-type').selectOption('드론촬영');
  await page.locator('#tag-input').fill('#SpyMedia #강변');await page.locator('#add-tags').click();
  await page.locator('#youtube-url').fill('https://youtu.be/AbCdEf123_-?si=synthetic');
  await page.locator('#blog-add-context').check();await generate();
  assert.equal(await page.locator('#blog-title').inputValue(),'강변 촬영 이야기');
  assert.match(await page.locator('#blog-body').inputValue(),/첫 번째 문단입니다\.\n\n두 번째 문단입니다\./);
  assert.match(await page.locator('#blog-body').inputValue(),/서울/);assert.match(await page.locator('#blog-body').inputValue(),/드론촬영/);
  const editedTitle='독립 수정 제목 <img src=x onerror="window.blogUnsafe=true">';
  const editedBody='직접 수정한 본문입니다.\n\n<script>window.blogUnsafe=true</script>\n마지막 문단입니다.';
  await page.locator('#blog-title').fill(editedTitle);await page.locator('#blog-body').fill(editedBody);await page.locator('#blog-tags').fill('#블로그전용 #SpyMedia');
  await page.locator('#title').fill('공통 제목이 나중에 바뀌었습니다');await page.locator('#description').fill('공통 설명 변경');await page.locator('#region').fill('부산');
  assert.equal(await page.locator('#blog-title').inputValue(),editedTitle);assert.equal(await page.locator('#blog-body').inputValue(),editedBody);
  assert.equal(await page.locator('#blog-source-notice').isVisible(),true);
  acceptDialog=false;await page.locator('#blog-generate').click();acceptDialog=true;assert.equal(await page.locator('#blog-body').inputValue(),editedBody);
  pass('Explicit generation preserves paragraphs and optional context; independent edits survive shared-source changes and cancelled regeneration');

  await page.locator('#blog-copy-title').click();assert.equal(await page.evaluate(()=>window.__copied),editedTitle);
  await page.locator('#blog-copy-body').click();const composedBody=await page.evaluate(()=>window.__copied);
  assert.match(composedBody,/직접 수정한 본문입니다/);assert.match(composedBody,/#블로그전용 #SpyMedia/);assert.match(composedBody,/https:\/\/www.youtube.com\/watch\?v=AbCdEf123_-/);
  assert.equal(composedBody.includes(editedTitle),false);assert.equal(composedBody.includes('?si='),false);
  assert.equal(await page.locator('#blog-body').inputValue(),editedBody);assert.equal(await page.locator('#blog-preview').inputValue(),composedBody);
  const txt=await download(page.locator('#blog-download-txt'));const txtText=txt.bytes.toString('utf8').replace(/^\uFEFF/,'');
  assert.match(txt.name,/\.txt$/);assert.equal(txtText.includes(editedTitle),true);assert.equal(txtText.includes(composedBody),true);
  await page.evaluate(()=>window.__clipboardFails=true);await page.locator('#blog-copy-body').click();
  assert.equal(await selectedText(),composedBody);assert.match(await page.locator('#blog-feedback').textContent(),/복사|선택|Ctrl/);
  await page.evaluate(()=>window.__clipboardFails=false);
  assert.equal(await page.evaluate(()=>window.blogUnsafe),undefined);assert.equal(await page.locator('#blogWorkspace script, #blogWorkspace img[onerror]').count(),0);
  pass('Title and body copy separately; body and UTF-8 text contain reviewed tags and normalized optional YouTube URL, with manual copy fallback and safe literal markup');

  await page.evaluate(()=>window.__clipboardDelay=true);await page.locator('#blog-copy-body').click();
  await page.waitForFunction(()=>typeof window.__resolveClipboard==='function');
  const duringCopy=editedBody+'\n\n복사를 기다리는 동안 추가한 문단';await page.locator('#blog-body').fill(duringCopy);
  await page.evaluate(()=>{window.__clipboardDelay=false;window.__resolveClipboard();delete window.__resolveClipboard;});
  await page.waitForFunction(()=>document.getElementById('blog-feedback').textContent.includes('다시 복사'));
  assert.equal(await page.evaluate(()=>window.__copied),composedBody);assert.equal(await page.locator('#blog-body').inputValue(),duringCopy);
  await page.locator('#blog-body').fill(editedBody);
  pass('Editing during a delayed clipboard write preserves the current draft and identifies the copied text as the earlier snapshot requiring another copy');

  const beforeInvalid=postBodies.length;
  await page.locator('#blog-youtube').fill('https://youtube.com.evil.invalid/watch?v=AbCdEf123_-');await page.locator('#blog-save').click();
  assert.match(await page.locator('#blog-feedback').textContent(),/유튜브|YouTube|주소/);assert.equal(postBodies.length,beforeInvalid);
  assert.equal(await page.locator('#blog-youtube-error').isVisible(),true);assert.equal(await page.locator('#blog-youtube').getAttribute('aria-invalid'),'true');
  assert.equal(await page.locator('#blog-copy-body').isDisabled(),true);assert.equal(await page.locator('#blog-download-txt').isDisabled(),true);
  assert.equal(await page.locator('#blog-copy-title').isEnabled(),true);await page.locator('#blog-copy-title').click();assert.equal(await page.evaluate(()=>window.__copied),editedTitle);
  assert.equal(await page.locator('#blog-title').inputValue(),editedTitle);assert.equal(await page.locator('#blog-body').inputValue(),editedBody);
  await page.locator('#blog-youtube').fill('https://youtu.be/AbCdEf123_-?feature=shared');
  assert.equal(await page.locator('#blog-youtube-error').isHidden(),true);assert.equal(await page.locator('#blog-copy-body').isEnabled(),true);assert.equal(await page.locator('#blog-download-txt').isEnabled(),true);
  pass('An invalid optional YouTube address visibly blocks save, body copy, and TXT export while allowing independent title copy; correcting it restores body actions');

  await page.waitForFunction(()=>document.querySelectorAll('#blog-photos [data-photo-key]').length===3);
  assert.equal(await page.locator('#blog-body').inputValue(),editedBody);
  await row(photos[2].name).getByRole('button',{name:/ 위로$/}).click();
  await row(photos[0].name).getByRole('button',{name:/ 제외$/}).click();
  const localPhoto=await download(row(photos[2].name).getByRole('link',{name:/원본/}));assert.deepEqual(localPhoto.bytes,photos[2].buffer);
  let jobsGetEntered;
  const jobsGetPending=new Promise(resolve=>{jobsGetEntered=resolve;});
  delayedJobsGet={body:JSON.stringify({jobs:await service.jobs.list()}),entered:jobsGetEntered,gate:new Promise(resolve=>{releaseJobsGet=resolve;})};
  await page.locator('#blog-refresh').click();await jobsGetPending;
  const photoJob=await save();
  assert.equal(await jobRow(editedTitle).count(),1);
  delayedJobsGet=null;releaseJobsGet();releaseJobsGet=null;
  await page.waitForFunction(()=>!document.getElementById('blog-refresh').disabled);
  assert.equal(await jobRow(editedTitle).count(),1);assert.equal(await jobRow(editedTitle).getAttribute('data-job-id'),photoJob.id);
  pass('A stale jobs-list response arriving after a successful save cannot hide the newly saved manuscript');
  assert.equal(photoJob.assets.length,2);assert.equal(photoJob.youtubeUrl,'https://www.youtube.com/watch?v=AbCdEf123_-');
  assert.deepEqual(store.state.jobs[photoJob.id].mediaIds.map(id=>store.state.media[id].name),[photos[2].name,photos[1].name]);
  for(const [index,photo] of [photos[2],photos[1]].entries())assert.deepEqual(await fs.readFile(store.file(store.state.jobs[photoJob.id].mediaIds[index])),photo.buffer);
  assert.equal(Object.values(store.state.media).some(item=>item.name===photos[0].name),false);
  assert.equal(postBodies.at(-1).type,'blog-draft');assert.deepEqual(postBodies.at(-1).channels,['blog']);assert.equal(postBodies.at(-1).description,editedBody);
  pass('Reordered and excluded photo selection saves only included originals in visible order, preserving exact source bytes');

  await page.screenshot({path:path.join(output,'blog-desktop.png'),fullPage:true});
  await page.locator('#blogWorkspace').screenshot({path:path.join(output,'blog-workspace-desktop.png')});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:path.join(output,'blog-mobile.png'),fullPage:true});
  await page.locator('#blogWorkspace').screenshot({path:path.join(output,'blog-workspace-mobile.png')});
  await page.setViewportSize({width:1440,height:1100});
  await page.reload();await page.locator('#blogWorkspace').waitFor();await jobRow(editedTitle).waitFor();await reopen(editedTitle);
  assert.equal(await page.locator('#blog-title').inputValue(),editedTitle);assert.equal(await page.locator('#blog-body').inputValue(),editedBody);
  await page.locator('#blog-copy-body').click();assert.equal(await page.evaluate(()=>window.__copied),composedBody);
  assert.equal(await page.locator('#blog-photos [data-photo-key]').count(),2);
  const savedPhoto=await download(row(photos[2].name).getByRole('link',{name:/원본/}));assert.deepEqual(savedPhoto.bytes,photos[2].buffer);
  assert.equal(await page.evaluate(()=>window.blogUnsafe),undefined);
  pass('Desktop and 390px layouts fit; a server-saved draft reopens after reload with distinct title/body, tags, normalized URL, and ordered original photos intact');

  const open=page.locator('#blog-open');assert.equal(await open.getAttribute('href'),NAVER);assert.equal(await open.getAttribute('target'),'_blank');
  const rel=(await open.getAttribute('rel')).split(/\s+/);assert.equal(rel.includes('noopener'),true);assert.equal(rel.includes('noreferrer'),true);
  const popupPromise=context.waitForEvent('page');await open.click();const popup=await popupPromise;await popup.waitForLoadState('domcontentloaded');
  assert.equal(popup.url(),NAVER);assert.equal(await popup.evaluate(()=>window.opener),null);assert.equal(naverRequests.length,1);assert.equal(naverRequests[0].headers.referer,undefined);await popup.close();
  assert.equal(await page.locator('#blog-title').inputValue(),editedTitle);assert.equal(await page.locator('#blog-body').inputValue(),editedBody);
  pass('Open-blog uses only the supplied spymedia URL in an isolated tab; a locally fulfilled placeholder prevents every real Naver request and no manuscript enters the URL');

  for(const failure of [{status:403,error:'csrf_rejected'},{status:401,error:'authentication_required'}]){
    // Reload clears the deliberate expired-session UI state, without ending the synthetic server session.
    if(failure.status===401){await page.reload();await jobRow(editedTitle).waitFor();await reopen(editedTitle);}
    const title=`저장 오류 ${failure.status}에서도 유지할 제목`,body=`저장 오류 ${failure.status}에서도 유지할 본문`;
    await page.locator('#blog-title').fill(title);await page.locator('#blog-body').fill(body);blogFailure=failure;
    const pending=page.waitForResponse(response=>response.url()===origin+'/api/admin/jobs'&&response.request().method()==='POST');await page.locator('#blog-save').click();assert.equal((await pending).status(),failure.status);
    await page.waitForFunction(()=>/로그인|인증|다시/.test(document.getElementById('blog-feedback').textContent));
    assert.equal(await page.locator('#blog-title').inputValue(),title);assert.equal(await page.locator('#blog-body').inputValue(),body);assert.equal(await page.locator('#blog-photos [data-photo-key]').count(),2);
    blogFailure=null;
  }
  pass('CSRF rejection and expired authentication preserve unsaved blog title, body, and selected photos');

  assert.equal(localRequests.filter(request=>request.path==='/api/admin/jobs/start').length,0);
  assert.equal(localRequests.filter(request=>request.path==='/api/admin/youtube/import').length,0);
  assert.equal(providerCalls,0);assert.equal(mediaToolCalls,0);assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  pass('Entire workflow uses no provider APIs, import requests, start jobs, video tools, external network, or existing browser session');
  await fs.writeFile(path.join(output,'verification.json'),JSON.stringify({checks,errors,external,mockOnly:true,realNaverRequests:0,interceptedNaverOpens:naverRequests.length,realSnsRequests:0,providerCalls,mediaToolCalls,startJobRequests:0,userBrowserSessionUsed:false,screenshots:['blog-desktop.png','blog-mobile.png']},null,2));
}finally{
  delayedJobsGet=null;releaseJobsGet?.();
  await browser?.close();await new Promise(resolve=>server.close(resolve));
  assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));await fs.rm(dir,{recursive:true,force:true});
}
