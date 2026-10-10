// Real local media/ffprobe/browser smoke test. No credentials or provider calls.
// REAL_REEL_FILE must point to an already generated compliant synthetic MP4/MOV.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createHash,randomBytes,scryptSync} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {config} from '../backend/config.cjs';
import {Service} from '../backend/service.cjs';
import {createAdminHandler} from '../server-core.cjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
if(!process.env.REAL_REEL_FILE||!process.env.FFPROBE_PATH)throw Error('Set REAL_REEL_FILE and FFPROBE_PATH for this real-media test.');
const input=path.resolve(process.env.REAL_REEL_FILE),bytes=await fs.readFile(input),digest=createHash('sha256').update(bytes).digest('hex');
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'spymedia-reel-real-'));
const settings=config({SNS_DATA_DIR:dir,SNS_STORAGE_PERSISTENCE:'confirmed',SNS_SINGLE_INSTANCE:'confirmed',FFPROBE_PATH:process.env.FFPROBE_PATH,FFMPEG_PATH:'must-never-run-ffmpeg',PUBLIC_ORIGIN:'http://127.0.0.1',SNS_PUBLISH_ENABLED:'false'});
let conversions=0,providerCalls=0;
const service=new Service({settings,media:{tools:()=>{conversions++;throw Error('No transcoder allowed');},convert:()=>{conversions++;throw Error('No transcoder allowed');}},connectors:{availability:()=>({instagram:false,facebook:false,x:false}),publish:()=>{providerCalls++;throw Error('No provider calls allowed');}}});
const password=randomBytes(24).toString('hex'),salt=randomBytes(16),handler=createAdminHandler({mode:'authenticated',username:'synthetic',passwordHash:salt.toString('hex')+':'+scryptSync(password,salt,64).toString('hex'),secureCookie:false,service});
const server=http.createServer((req,res)=>handler(req,res).then(done=>{if(!done){res.writeHead(404);res.end();}}));
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;settings.origin=origin;
let browser;const errors=[];
try{
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1100}});
  await context.route('**/*',route=>{const u=route.request().url();return u.startsWith('blob:')||u.startsWith('data:')||new URL(u).origin===origin?route.continue():route.abort();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/admin/login');await page.locator('#login-id').fill('synthetic');await page.locator('#login-password').fill(password);await page.locator('#login-submit').click();await page.waitForURL(origin+'/admin');
  await page.locator('#reels-file').setInputFiles(input);
  await page.waitForFunction(()=>!document.querySelector('#reels-upload').disabled);
  await page.locator('#reels-preview').evaluate(async video=>{video.muted=true;await video.play();});
  await page.waitForFunction(()=>document.querySelector('#reels-preview').currentTime>.1);
  await page.locator('#reels-preview').evaluate(video=>video.pause());
  await page.locator('#reels-upload').click();
  await page.waitForFunction(()=>document.querySelector('#reels-media-status').textContent.includes('서버 검사 완료'));
  const stored=Object.values(service.store.state.media)[0];assert.equal(stored.sha256,digest);assert.equal(stored.size,bytes.length);assert.deepEqual(await fs.readFile(service.store.file(stored.id)),bytes);
  const downloaded=await context.request.get(origin+'/api/admin/media/'+stored.id+'?preview=1');assert.deepEqual(await downloaded.body(),bytes);
  const partial=await context.request.get(origin+'/api/admin/media/'+stored.id+'?preview=1',{headers:{Range:'bytes=0-63'}});assert.equal(partial.status(),206);assert.deepEqual(await partial.body(),bytes.subarray(0,64));
  await page.locator('#title').fill('원본 릴스 검사 테스트');await page.locator('#description').fill('실제 게시하지 않는 합성 테스트 영상입니다.');await page.locator('#reels-prepare').click();
  await page.waitForFunction(()=>document.querySelector('#reels-feedback').textContent.includes('릴스 작업을 저장했습니다'));
  const jobs=Object.values(service.store.state.jobs);assert.equal(jobs.length,1);assert.equal(jobs[0].status,'prepared');assert.equal(jobs[0].assets[0].original,true);
  const savedPreview=page.locator('#reels-jobs video').first();await savedPreview.evaluate(async video=>{video.muted=true;await video.play();});
  await page.waitForFunction(()=>document.querySelector('#reels-jobs video').currentTime>.1);await savedPreview.evaluate(video=>video.pause());
  assert.equal(await page.locator('#reels-send').isDisabled(),true);assert.equal(conversions,0);assert.equal(providerCalls,0);assert.deepEqual(errors,[]);assert.deepEqual(await fs.readdir(path.join(dir,'converted')),[]);
  const output=new URL('../test-results/reels-original/',import.meta.url);await fs.mkdir(output,{recursive:true});
  await page.locator('#reels-heading').scrollIntoViewIfNeeded();await page.screenshot({path:fileURLToPath(new URL('real-media-desktop.png',output))});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.screenshot({path:fileURLToPath(new URL('real-media-mobile.png',output))});
  console.log(JSON.stringify({result:'PASS',bytes:stored.size,sha256:digest,width:stored.width,height:stored.height,duration:stored.duration,videoCodec:stored.videoCodec,audioCodec:stored.audioCodec,frameRate:stored.frameRate,localPlayback:true,savedPlayback:true,exactOriginalDownload:true,range:true,conversions,providerCalls}));
}finally{
  await browser?.close();await new Promise(r=>server.close(r));assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));await fs.rm(dir,{recursive:true,force:true});
}
