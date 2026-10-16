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
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'spymedia-facebook-follow-'));
const output=fileURLToPath(new URL('../test-results/follow-tools/',import.meta.url));await fs.mkdir(output,{recursive:true});
const settings=config({SNS_DATA_DIR:dir,SNS_STORAGE_PERSISTENCE:'confirmed',SNS_SINGLE_INSTANCE:'confirmed'}),store=new Store(settings);await store.init();
const errors=[],external=[],mutations=[];let searchCalls=0;
const temporarySearch={describe:()=>({ready:true}),search:async({platform,page})=>{searchCalls++;return {page,hasMore:false,items:Array.from({length:12},(_,i)=>({url:platform==='facebook'?(i===11?'https://www.facebook.com/fixture.page/posts/999':i===10?'https://www.facebook.com/profile.php?id=123456789':`https://www.facebook.com/fixture.page${i}`):platform==='instagram'?`https://www.instagram.com/fixture_${i}/`:`https://x.com/fixture_${i}`,kind:platform==='facebook'&&i===11?'post':'profile',title:`합성 Facebook 대상 ${i}`,snippet:'테스트 전용 프로필입니다.'}))};}};
const service=new Service({settings,store,temporarySearch,connectors:{availability:()=>({blog:true})}});
await service.candidates.create({platform:'facebook',accountName:'합성 저장 대상',profileUrl:'https://www.facebook.com/saved.fixture'});
const initialJournal=await fs.readFile(path.join(dir,'journal.json'),'utf8');
const salt=randomBytes(16),password=randomBytes(24).toString('hex');
const handler=createAdminHandler({mode:'authenticated',username:'fixture',passwordHash:salt.toString('hex')+':'+scryptSync(password,salt,64).toString('hex'),secureCookie:false,service});
const server=http.createServer((req,res)=>{if(req.method==='POST')mutations.push(req.url);handler(req,res).then(done=>{if(!done){res.writeHead(404);res.end();}}).catch(error=>{errors.push(error.message);res.writeHead(500);res.end();});});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;let browser;
try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium'});
  const context=await browser.newContext({viewport:{width:1440,height:1100}});
  await context.addInitScript(()=>{
    window.__fbMessages=[];window.__fbMode='normal';window.__storageWrites=0;Storage.prototype.setItem=function(){window.__storageWrites++;throw Error('No persistent search storage');};
    const timeout=window.setTimeout;window.setTimeout=(fn,ms,...rest)=>{if(ms===90000)window.__expireFbStep=fn;if(ms>=600000&&ms<=900000)window.__expireFbSelection=fn;return timeout(fn,ms,...rest);};
    const jobs=new Map();
    window.addEventListener('message',event=>{
      const m=event.data;if(m?.source!=='spymedia-admin-facebook-follow')return;window.__fbMessages.push(m);
      const reply=(type,detail={})=>window.postMessage({source:'spymedia-facebook-follow-extension',type,action:m.type,requestId:m.requestId,version:'0.1.0',...detail},location.origin);
      if(m.type==='PING'){reply('READY',{version:window.__fbMode==='old'?'0.0.9':'0.1.0'});return;}
      if(m.type==='CANCEL'){jobs.delete(m.requestId);return;}
      if(m.type==='PREPARE'){if(m.control!=='admin'||m.platform!=='facebook')throw Error('Invalid Facebook control protocol');const job={expectedAccount:m.expectedAccount,expectedName:'스파이미디어',profiles:[...m.profiles],expiresAt:m.expiresAt,index:0,started:false,running:false,terminalError:null,results:[]};jobs.set(m.requestId,job);reply('STATE',{job});return;}
      const job=jobs.get(m.requestId);if(!job)return;
      if(m.type==='START'){job.started=true;job.running=true;const value=structuredClone(job);if(window.__fbMode==='wrong-account')value.expectedAccount='other';if(window.__fbMode==='wrong-name')value.expectedName='개인 프로필';if(window.__fbMode==='wrong-profiles')value.profiles=['https://www.facebook.com/another.fixture'];if(window.__fbMode==='wrong-expiry')value.expiresAt++;reply('STATE',{job:value});return;}
      if(m.type==='STEP'){
        if(m.index!==job.index)throw Error('Duplicate or skipped Facebook STEP');
        const done=()=>{job.results.push({index:job.index,state:job.index%2?'following':'followed'});job.index++;job.running=job.index<job.profiles.length;reply('STATE',{job:structuredClone(job)});};
        if(window.__fbMode==='hold'){window.__releaseFbStep=done;return;}
        if(['account_mismatch','account_unverified','login_required','challenge','uncertain'].includes(window.__fbMode)){reply('ERROR',{code:window.__fbMode});return;}
        if(window.__fbMode==='bad-result'){job.results.push({index:job.index,state:'liked'});job.index++;job.running=job.index<job.profiles.length;reply('STATE',{job});return;}
        if(window.__fbMode==='foreign-message'){window.postMessage({source:'spymedia-follow-extension',type:'STATE',action:'STEP',requestId:m.requestId,job:{...job,index:1,running:false,results:[{index:0,state:'followed'}]}},location.origin);window.__releaseFbStep=done;return;}
        done();
      }
    });
  });
  await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external.push(route.request().url());return route.abort();});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/admin/login');await page.locator('#login-id').fill('fixture');await page.locator('#login-password').fill(password);await page.locator('#login-submit').click();await page.waitForURL(origin+'/admin');
  const idle=()=>page.waitForFunction(()=>!document.getElementById('temporary-search-fields').disabled);
  const search=async(platform='facebook')=>{await idle();await page.locator('#temporary-search-platform').selectOption(platform);await page.locator('#temporary-search-keyword').fill('합성 페이스북 검색');await page.locator('#temporary-search-submit').click();await idle();};
  const button=page.locator('#temporary-search-facebook-follow-prepare'),review=page.locator('#temporary-search-facebook-follow-review'),feedback=page.locator('#temporary-search-facebook-follow-feedback');
  const begin=async(mode='normal',all=false)=>{await page.evaluate(mode=>{window.__fbMode=mode;window.__releaseFbStep=null;},mode);await search();if(all)await page.locator('#temporary-search-all').check();else await page.locator('[data-search-select]').first().check();await button.click();await page.locator('#temporary-search-facebook-follow-start').click();};
  await idle();assert.equal(await page.locator('#temporary-search-facebook-follow').isVisible(),false);assert.equal(searchCalls,0);
  await search();assert.equal(await page.locator('#temporary-search-follow').isVisible(),false);assert.equal(await page.locator('#temporary-search-facebook-follow').isVisible(),true);assert.equal(await button.isDisabled(),true);
  await page.locator('#temporary-search-all').check();await button.click();assert.equal(await review.locator('li').count(),10);assert.match(await review.textContent(),/스파이미디어.*61594869881531/);assert.equal(await page.evaluate(()=>window.__fbMessages.length),0);
  await page.locator('#temporary-search-facebook-follow-start').click();await page.waitForFunction(()=>document.getElementById('temporary-search-facebook-follow-feedback').textContent.includes('처리가 끝났습니다'));
  let messages=await page.evaluate(()=>window.__fbMessages),prepared=messages.find(m=>m.type==='PREPARE');assert.equal(prepared.expectedAccount,'61594869881531');assert.equal(prepared.profiles.length,10);assert.deepEqual(messages.filter(m=>m.type==='STEP').map(m=>m.index),Array.from({length:10},(_,i)=>i));assert.match(await review.textContent(),/팔로우 완료/);assert.match(await review.textContent(),/이미 팔로잉/);assert.equal(await button.isDisabled(),true);assert.ok(!JSON.stringify(prepared).includes('합성 페이스북 검색'));
  assert.equal(await fs.readFile(path.join(dir,'journal.json'),'utf8'),initialJournal);assert.equal(mutations.filter(url=>url.includes('follow-exclusions')).length,0);
  console.log('PASS Facebook inline exact Page/targets review, explicit start, sequential once-only STEP and separate followed/following states; no exclusion/history writes');
  await search();await page.locator('#temporary-search-all').check();await page.locator('#temporary-search-next').click();await page.locator('[data-search-select]').first().check();assert.equal(await button.isDisabled(),true);await page.locator('[data-search-select]').first().uncheck();await page.locator('[data-search-select]').last().check();assert.equal(await button.isDisabled(),true);assert.match(await page.locator('#temporary-search-facebook-follow').textContent(),/게시물 주소/);
  for(const mode of ['old','wrong-account','wrong-name','wrong-profiles','wrong-expiry']){const count=await page.evaluate(()=>window.__fbMessages.length);await begin(mode);await page.waitForFunction(()=>/이상이 필요|응답을 검증하지 못/.test(document.getElementById('temporary-search-facebook-follow-feedback').textContent));messages=await page.evaluate(count=>window.__fbMessages.slice(count),count);assert.equal(messages.filter(m=>m.type==='STEP').length,0);assert.ok(messages.some(m=>m.type==='CANCEL'));}
  for(const mode of ['account_mismatch','account_unverified','login_required','challenge','uncertain','bad-result']){const count=await page.evaluate(()=>window.__fbMessages.length);await begin(mode,true);await page.waitForFunction(()=>document.getElementById('temporary-search-facebook-follow-feedback').textContent.includes('자동 재시도하지 않습니다'));messages=await page.evaluate(count=>window.__fbMessages.slice(count),count);assert.equal(messages.filter(m=>m.type==='STEP').length,1);assert.match(await review.textContent(),/중지 · 결과 확인 필요/);assert.ok(messages.some(m=>m.type==='CANCEL'));assert.equal(await button.isDisabled(),true);}
  console.log('PASS profile-only 1–10 bound, minimum extension version, strict Page ID/name/profile/expiry results, and terminal login/identity/restriction/uncertainty errors');
  await begin('foreign-message');await page.waitForFunction(()=>!!window.__releaseFbStep);assert.doesNotMatch(await feedback.textContent(),/처리가 끝났습니다/);await page.evaluate(()=>window.__releaseFbStep());await page.waitForFunction(()=>document.getElementById('temporary-search-facebook-follow-feedback').textContent.includes('처리가 끝났습니다'));
  await begin('hold',true);await page.waitForFunction(()=>!!window.__releaseFbStep);let held=await page.evaluate(()=>window.__fbMessages.findLast(m=>m.type==='STEP'));
  await page.locator('#temporary-search-facebook-follow').getByRole('button',{name:'Facebook 작업 중지'}).click();await page.evaluate(()=>window.__releaseFbStep());assert.match(await feedback.textContent(),/작업 중지를 요청/);assert.equal(await page.evaluate(id=>window.__fbMessages.filter(m=>m.requestId===id&&m.type==='STEP').length,held.requestId),1);assert.match(await review.textContent(),/중지 요청/);
  await begin('hold',true);await page.waitForFunction(()=>!!window.__releaseFbStep);held=await page.evaluate(()=>window.__fbMessages.findLast(m=>m.type==='STEP'));await page.locator('[data-search-select]').first().uncheck();await page.evaluate(()=>window.__releaseFbStep());assert.equal(await review.locator('li').count(),0);assert.equal(await page.evaluate(id=>window.__fbMessages.filter(m=>m.requestId===id&&m.type==='STEP').length,held.requestId),1);
  await begin('hold',true);await page.waitForFunction(()=>!!window.__releaseFbStep);await page.evaluate(()=>window.__expireFbStep());await page.waitForFunction(()=>document.getElementById('temporary-search-facebook-follow-feedback').textContent.includes('응답 시간이 초과'));await page.evaluate(()=>window.__releaseFbStep());assert.doesNotMatch(await feedback.textContent(),/처리가 끝났습니다/);
  await begin('hold');await page.waitForFunction(()=>!!window.__releaseFbStep);await page.evaluate(()=>window.__expireFbSelection());await page.evaluate(()=>window.__releaseFbStep());assert.equal(await review.locator('li').count(),0);
  console.log('PASS foreign extension replies ignored; stop, selection change, timeout and selection expiry cancel without retry or accepting late results');
  await page.evaluate(()=>{window.__fbMode='normal';});await search();await page.locator('[data-search-select]').first().check();await button.click();await page.locator('#sns-accounts').screenshot({path:path.join(output,'facebook-follow-desktop.png')});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.locator('#sns-accounts').screenshot({path:path.join(output,'facebook-follow-mobile.png')});
  await search('instagram');assert.equal(await page.locator('#temporary-search-facebook-follow').isVisible(),false);assert.equal(await page.locator('#temporary-search-follow').isVisible(),true);await search('x');assert.equal(await page.locator('#temporary-search-facebook-follow').isVisible(),false);
  await begin('hold',true);await page.waitForFunction(()=>!!window.__releaseFbStep);held=await page.evaluate(()=>window.__fbMessages.findLast(m=>m.type==='STEP'));await page.evaluate(()=>window.dispatchEvent(new Event('sns-auth-expired')));await page.evaluate(()=>window.__releaseFbStep());assert.equal(await button.isDisabled(),true);assert.equal(await review.locator('li').count(),0);assert.equal(await page.evaluate(id=>window.__fbMessages.filter(m=>m.requestId===id&&m.type==='STEP').length,held.requestId),1);assert.ok(await page.evaluate(id=>window.__fbMessages.some(m=>m.requestId===id&&m.type==='CANCEL'),held.requestId));
  assert.equal(await fs.readFile(path.join(dir,'journal.json'),'utf8'),initialJournal);assert.equal(await page.evaluate(()=>window.__storageWrites),0);assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  console.log('PASS Facebook only UI, responsive desktop/mobile, auth expiry cancellation, zero persistent search data, zero external requests, zero actual follows');
}finally{await browser?.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await fs.rm(dir,{recursive:true,force:true});}
