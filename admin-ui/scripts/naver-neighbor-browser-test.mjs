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
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'spymedia-naver-neighbor-'));
const output=fileURLToPath(new URL('../test-results/follow-tools/',import.meta.url));await fs.mkdir(output,{recursive:true});
const settings=config({SNS_DATA_DIR:dir,SNS_STORAGE_PERSISTENCE:'confirmed',SNS_SINGLE_INSTANCE:'confirmed'}),store=new Store(settings);await store.init();
const errors=[],external=[],mutations=[];let searchCalls=0,statusChecks=0;
const longId='fixture_'+'a'.repeat(42);
const mixed=[
  {url:'https://blog.naver.com/fixture_one/100',kind:'post'},
  {url:'https://m.blog.naver.com/fixture_one/101',kind:'post'},
  {url:'https://blog.naver.com/fixture_two',kind:'profile'},
  {url:'https://blog.naver.com/spymedia/200',kind:'post'},
  {url:'https://blog.naver.com/search',kind:'profile'},
  {url:'https://blog.naver.com/'+longId,kind:'profile'}
];
const temporarySearch={describe:()=>({ready:true}),search:async({platform,page,keyword})=>{
  searchCalls++;
  const targets=platform==='blog'&&keyword==='mixed'?mixed:Array.from({length:12},(_,i)=>({url:platform==='blog'?`https://blog.naver.com/fixture_${i}`:platform==='facebook'?`https://www.facebook.com/fixture.page${i}`:platform==='instagram'?`https://www.instagram.com/fixture_${i}/`:`https://x.com/fixture_${i}`,kind:'profile'}));
  return {page,hasMore:false,items:targets.map((item,i)=>({...item,title:`합성 이웃 대상 ${i}`,snippet:'네이버 도구 로컬 테스트용 결과입니다.'}))};
}};
const service=new Service({settings,store,temporarySearch,connectors:{availability:()=>({blog:true})}});
await service.candidates.create({platform:'blog',accountName:'합성 저장 블로그',profileUrl:'https://blog.naver.com/saved_fixture'});
const initialJournal=await fs.readFile(path.join(dir,'journal.json'),'utf8');
const salt=randomBytes(16),password=randomBytes(24).toString('hex');
const handler=createAdminHandler({mode:'authenticated',username:'fixture',passwordHash:salt.toString('hex')+':'+scryptSync(password,salt,64).toString('hex'),secureCookie:false,service});
const server=http.createServer((req,res)=>{if(req.method==='POST')mutations.push(req.url);if(req.method==='GET'&&req.url==='/api/admin/status')statusChecks++;handler(req,res).then(done=>{if(!done){res.writeHead(404);res.end();}}).catch(error=>{errors.push(error.message);res.writeHead(500);res.end();});});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;let browser;
try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium'});
  const context=await browser.newContext({viewport:{width:1440,height:1100}});
  await context.addInitScript(()=>{
    window.__neighborMessages=[];window.__neighborMode='normal';window.__storageWrites=0;
    Storage.prototype.setItem=function(){window.__storageWrites++;throw Error('No persistent search storage');};
    const timeout=window.setTimeout;window.setTimeout=(fn,ms,...rest)=>{if(ms===120000)window.__expireNeighborStep=fn;if(ms>=600000&&ms<=900000)window.__expireNeighborSelection=fn;return timeout(fn,ms,...rest);};
    const jobs=new Map();
    window.addEventListener('message',event=>{
      const message=event.data;if(message?.source!=='spymedia-admin-naver-neighbor')return;window.__neighborMessages.push(message);
      const reply=(type,detail={})=>window.postMessage({source:'spymedia-naver-neighbor-extension',type,action:message.type,requestId:message.requestId,version:'0.1.0',...detail},location.origin);
      if(message.type==='PING'){reply('READY',{version:window.__neighborMode==='old'?'0.0.9':'0.1.0'});return;}
      if(message.type==='CANCEL'){jobs.delete(message.requestId);return;}
      if(message.type==='PREPARE'){
        if(message.control!=='admin'||message.platform!=='blog')throw Error('Invalid Naver control protocol');
        const job={expectedAccount:message.expectedAccount,expectedName:'spymedia',profiles:[...message.profiles],expiresAt:message.expiresAt,index:0,started:false,running:false,terminalError:null,results:[]};jobs.set(message.requestId,job);reply('STATE',{job});return;
      }
      const job=jobs.get(message.requestId);if(!job)return;
      if(message.type==='START'){
        job.started=true;job.running=true;const value=structuredClone(job);
        if(window.__neighborMode==='wrong-account')value.expectedAccount='different_user';
        if(window.__neighborMode==='wrong-name')value.expectedName='different_user';
        if(window.__neighborMode==='wrong-profiles')value.profiles=['https://blog.naver.com/other_fixture'];
        if(window.__neighborMode==='wrong-expiry')value.expiresAt++;
        if(window.__neighborMode==='extra-field')value.unexpected=true;
        reply('STATE',{job:value});return;
      }
      if(message.type==='STEP'){
        if(message.index!==job.index)throw Error('Duplicate or skipped Naver STEP');
        const done=()=>{job.results.push({index:job.index,state:window.__neighborMode==='existing'||job.index%2?'existing':'added'});job.index++;job.running=job.index<job.profiles.length;reply('STATE',{job:structuredClone(job)});};
        if(window.__neighborMode==='hold'){window.__releaseNeighborStep=done;return;}
        if(['account_mismatch','account_unverified','login_required','challenge','security_limit','rate_limited','uncertain','mutual_only'].includes(window.__neighborMode)){reply('ERROR',{code:window.__neighborMode});return;}
        if(window.__neighborMode==='bad-result'){job.results.push({index:job.index,state:'mutual_requested'});job.index++;job.running=job.index<job.profiles.length;reply('STATE',{job});return;}
        if(window.__neighborMode==='rewritten-history'&&job.index===1){job.results[0].state='existing';done();return;}
        if(window.__neighborMode==='foreign-message'){
          window.postMessage({source:'spymedia-facebook-follow-extension',type:'STATE',action:'STEP',requestId:message.requestId,job:{...job,index:1,running:false,results:[{index:0,state:'added'}]}},location.origin);
          window.__releaseNeighborStep=done;return;
        }
        done();
      }
    });
  });
  await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external.push(route.request().url());return route.abort();});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/admin/login');await page.locator('#login-id').fill('fixture');await page.locator('#login-password').fill(password);await page.locator('#login-submit').click();await page.waitForURL(origin+'/admin');
  const idle=()=>page.waitForFunction(()=>!document.getElementById('temporary-search-fields').disabled);
  const search=async(platform='blog',keyword='normal')=>{await idle();const before=searchCalls;await page.locator('#temporary-search-platform').selectOption(platform);await page.locator('#temporary-search-keyword').fill(keyword);await page.locator('#temporary-search-submit').click();await idle();assert.equal(searchCalls,before+1,'Only each explicit search calls the local provider');};
  const card=page.locator('#temporary-search-naver-neighbor'),button=page.locator('#temporary-search-naver-neighbor-prepare'),review=page.locator('#temporary-search-naver-neighbor-review'),feedback=page.locator('#temporary-search-naver-neighbor-feedback');
  const finished=()=>page.waitForFunction(()=>document.getElementById('temporary-search-naver-neighbor-feedback').textContent.includes('처리가 끝났습니다'));
  const begin=async(mode='normal',all=false)=>{await page.evaluate(mode=>{window.__neighborMode=mode;window.__releaseNeighborStep=null;},mode);await search();if(all)await page.locator('#temporary-search-all').check();else await page.locator('[data-search-select]').first().check();await button.click();await page.locator('#temporary-search-naver-neighbor-start').click();};
  await idle();assert.equal(await card.isVisible(),false);assert.equal(searchCalls,0);
  await search();assert.equal(await card.isVisible(),true);assert.equal(await page.locator('#temporary-search-facebook-follow').isVisible(),false);assert.equal(await button.isDisabled(),true);
  await page.locator('#temporary-search-all').check();await button.click();assert.equal(await review.locator('li').count(),10);assert.match(await review.textContent(),/spymedia · 일반 이웃추가/);assert.equal(await page.evaluate(()=>window.__neighborMessages.length),0);
  const initialStatusChecks=statusChecks;await page.locator('#temporary-search-naver-neighbor-start').click();await finished();assert.equal(statusChecks,initialStatusChecks+11,'Session is checked before connecting and before every one of the ten STEP actions');
  let messages=await page.evaluate(()=>window.__neighborMessages),prepared=messages.find(message=>message.type==='PREPARE');
  assert.deepEqual(Object.keys(prepared).sort(),['control','expectedAccount','expiresAt','platform','profiles','requestId','source','type']);
  assert.equal(prepared.expectedAccount,'spymedia');assert.equal(prepared.platform,'blog');assert.deepEqual(prepared.profiles,Array.from({length:10},(_,i)=>`https://blog.naver.com/fixture_${i}`));assert.deepEqual(messages.filter(message=>message.type==='STEP').map(message=>message.index),Array.from({length:10},(_,i)=>i));assert.match(await review.textContent(),/이웃추가 완료/);assert.match(await review.textContent(),/이미 이웃 · 건너뜀/);assert.equal(await button.isDisabled(),true);assert.ok(!JSON.stringify(prepared).includes('네이버 도구 로컬 테스트용'));
  assert.equal(await fs.readFile(path.join(dir,'journal.json'),'utf8'),initialJournal);
  console.log('PASS Naver explicit review/start, fixed spymedia actor, 1–10 sequential once-only STEP and distinct added/existing states');
  await search();await page.locator('#temporary-search-all').check();await page.locator('#temporary-search-next').click();await page.locator('[data-search-select]').first().check();assert.equal(await button.isDisabled(),true,'Eleven distinct targets cannot start');
  await search('blog','mixed');await page.locator('[data-search-select]').nth(3).check();assert.equal(await button.isDisabled(),true);assert.match(await card.textContent(),/자기 블로그 1개는 제외/);
  await page.locator('[data-search-select]').nth(4).check();assert.equal(await button.isDisabled(),true);assert.match(await card.textContent(),/블로그를 확인할 수 없는 주소/);await page.locator('[data-search-select]').nth(4).uncheck();
  for(const index of [0,1,2])await page.locator('[data-search-select]').nth(index).check();
  assert.equal(await button.isDisabled(),false);assert.match(await card.textContent(),/같은 블로그 중복 1개를 합쳤/);await button.click();assert.equal(await review.locator('li').count(),2);assert.deepEqual(await review.locator('li a').evaluateAll(links=>links.map(link=>link.href)),['https://blog.naver.com/fixture_one','https://blog.naver.com/fixture_two']);assert.match(await review.textContent(),/선택한 글 주소 2개/);
  const beforeDerived=await page.evaluate(()=>window.__neighborMessages.length);await page.locator('#temporary-search-naver-neighbor-start').click();await finished();messages=await page.evaluate(start=>window.__neighborMessages.slice(start),beforeDerived);prepared=messages.find(message=>message.type==='PREPARE');assert.deepEqual(prepared.profiles,['https://blog.naver.com/fixture_one','https://blog.naver.com/fixture_two']);assert.equal(messages.filter(message=>message.type==='STEP').length,2);
  await begin('existing');await finished();assert.match(await review.textContent(),/이미 이웃 · 건너뜀/);assert.doesNotMatch(await review.textContent(),/이웃추가 완료/);
  console.log('PASS post-to-profile review, duplicate blog merge, self exclusion, reserved service URL rejection, already-neighbor result and maximum target bound');
  for(const mode of ['old','wrong-account','wrong-name','wrong-profiles','wrong-expiry','extra-field']){
    const before=await page.evaluate(()=>window.__neighborMessages.length);await begin(mode);await page.waitForFunction(()=>/이상이 필요|응답을 검증하지 못/.test(document.getElementById('temporary-search-naver-neighbor-feedback').textContent));messages=await page.evaluate(start=>window.__neighborMessages.slice(start),before);assert.equal(messages.filter(message=>message.type==='STEP').length,0);assert.ok(messages.some(message=>message.type==='CANCEL'));
  }
  for(const mode of ['account_mismatch','account_unverified','login_required','challenge','security_limit','rate_limited','uncertain','mutual_only','bad-result','rewritten-history']){
    const before=await page.evaluate(()=>window.__neighborMessages.length);await begin(mode,true);await page.waitForFunction(()=>document.getElementById('temporary-search-naver-neighbor-feedback').textContent.includes('자동 재시도하지 않습니다'));messages=await page.evaluate(start=>window.__neighborMessages.slice(start),before);assert.equal(messages.filter(message=>message.type==='STEP').length,mode==='rewritten-history'?2:1);assert.ok(messages.some(message=>message.type==='CANCEL'));assert.match(await review.textContent(),/중지 · 결과 확인 필요/);assert.equal(await button.isDisabled(),true);
  }
  console.log('PASS version, actor/name, exact profile/expiry/schema/history validation and terminal login/security/uncertain errors without retry');
  await begin('foreign-message');await page.waitForFunction(()=>!!window.__releaseNeighborStep);assert.doesNotMatch(await feedback.textContent(),/처리가 끝났습니다/);await page.evaluate(()=>window.__releaseNeighborStep());await finished();
  await begin('hold',true);await page.waitForFunction(()=>!!window.__releaseNeighborStep);let held=await page.evaluate(()=>window.__neighborMessages.findLast(message=>message.type==='STEP'));
  await card.getByRole('button',{name:'네이버 이웃추가 중지',exact:true}).click();await page.evaluate(()=>window.__releaseNeighborStep());assert.match(await feedback.textContent(),/중지를 요청/);assert.match(await review.textContent(),/중지 요청/);assert.equal(await page.evaluate(id=>window.__neighborMessages.filter(message=>message.requestId===id&&message.type==='STEP').length,held.requestId),1);
  await begin('hold',true);await page.waitForFunction(()=>!!window.__releaseNeighborStep);held=await page.evaluate(()=>window.__neighborMessages.findLast(message=>message.type==='STEP'));await page.locator('[data-search-select]').first().uncheck();await page.evaluate(()=>window.__releaseNeighborStep());assert.equal(await review.locator('li').count(),0);assert.equal(await page.evaluate(id=>window.__neighborMessages.filter(message=>message.requestId===id&&message.type==='STEP').length,held.requestId),1);
  await begin('hold');await page.waitForFunction(()=>!!window.__releaseNeighborStep);await page.evaluate(()=>window.__expireNeighborStep());await page.waitForFunction(()=>document.getElementById('temporary-search-naver-neighbor-feedback').textContent.includes('응답 시간이 초과'));await page.evaluate(()=>window.__releaseNeighborStep());assert.doesNotMatch(await feedback.textContent(),/처리가 끝났습니다/);
  await begin('hold');await page.waitForFunction(()=>!!window.__releaseNeighborStep);await page.evaluate(()=>window.__expireNeighborSelection());await page.evaluate(()=>window.__releaseNeighborStep());assert.equal(await review.locator('li').count(),0);
  console.log('PASS separate bridge namespace, stop, selection change, response timeout and selection expiry reject late completion without replay');
  await page.evaluate(()=>{window.__neighborMode='normal';});await search('blog','mixed');await page.locator('[data-search-select]').last().check();await button.click();await card.screenshot({path:path.join(output,'naver-neighbor-desktop.png')});await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Long reviewed blog URL must wrap on mobile');await card.screenshot({path:path.join(output,'naver-neighbor-mobile.png')});
  await search('instagram');assert.equal(await card.isVisible(),false);assert.equal(await page.locator('#temporary-search-follow').isVisible(),true);await search('facebook');assert.equal(await card.isVisible(),false);assert.equal(await page.locator('#temporary-search-facebook-follow').isVisible(),true);await search('x');assert.equal(await card.isVisible(),false);assert.equal(await page.locator('#temporary-search-follow').isVisible(),true);
  for(const condition of ['401','signed-out','missing-csrf','changed-csrf','500','invalid-json','network']){
    const expired=['401','signed-out','missing-csrf','changed-csrf'].includes(condition);
    await page.route('**/api/admin/status',route=>{
      if(condition==='network')return route.abort('failed');
      const status=condition==='401'?401:condition==='500'?500:200;
      const body=condition==='invalid-json'?'{':JSON.stringify(condition==='signed-out'?{authenticated:false}:condition==='missing-csrf'?{authenticated:true}:condition==='changed-csrf'?{authenticated:true,csrfToken:'changed-fixture-token'}:{error:'fixture-status-unavailable'});
      return route.fulfill({status,contentType:'application/json',body});
    });
    const before=await page.evaluate(()=>window.__neighborMessages.length);await begin('normal',true);
    if(expired)await page.waitForFunction(()=>!document.getElementById('temporary-search-login').hidden);else await page.waitForFunction(()=>document.getElementById('temporary-search-naver-neighbor-feedback').textContent.includes('관리자 로그인 상태를 확인하지 못'));
    messages=await page.evaluate(start=>window.__neighborMessages.slice(start),before);assert.equal(messages.filter(message=>message.type==='PING'||message.type==='STEP').length,0,condition);assert.ok(messages.some(message=>message.type==='CANCEL'),condition);assert.equal(await button.isDisabled(),true);if(expired)assert.equal(await review.locator('li').count(),0);
    await page.unroute('**/api/admin/status');await page.reload();await idle();
  }
  for(const condition of ['401','changed-csrf','500']){
    let checks=0;
    await page.route('**/api/admin/status',route=>{checks++;if(checks<3)return route.continue();return route.fulfill({status:condition==='401'?401:condition==='500'?500:200,contentType:'application/json',body:JSON.stringify(condition==='changed-csrf'?{authenticated:true,csrfToken:'changed-after-first-neighbor'}:{error:'fixture-session-changed'})});});
    const before=await page.evaluate(()=>window.__neighborMessages.length);await begin('normal',true);
    if(condition==='500')await page.waitForFunction(()=>document.getElementById('temporary-search-naver-neighbor-feedback').textContent.includes('관리자 로그인 상태를 확인하지 못'));else await page.waitForFunction(()=>!document.getElementById('temporary-search-login').hidden);
    messages=await page.evaluate(start=>window.__neighborMessages.slice(start),before);assert.equal(checks,3);assert.equal(messages.filter(message=>message.type==='STEP').length,1,'Changed authentication before the second target prevents that STEP');assert.ok(messages.some(message=>message.type==='CANCEL'));if(condition==='500')assert.match(await review.textContent(),/이웃추가 완료/);else assert.equal(await review.locator('li').count(),0);
    await page.unroute('**/api/admin/status');await page.reload();await idle();
  }
  console.log('PASS fresh admin session/CSRF check before connecting and every STEP; expired, changed or unavailable status stops before any further action');
  await begin('hold',true);await page.waitForFunction(()=>!!window.__releaseNeighborStep);held=await page.evaluate(()=>window.__neighborMessages.findLast(message=>message.type==='STEP'));await page.evaluate(()=>window.dispatchEvent(new Event('sns-auth-expired')));await page.evaluate(()=>window.__releaseNeighborStep());assert.equal(await button.isDisabled(),true);assert.equal(await review.locator('li').count(),0);assert.equal(await page.evaluate(id=>window.__neighborMessages.filter(message=>message.requestId===id&&message.type==='STEP').length,held.requestId),1);assert.ok(await page.evaluate(id=>window.__neighborMessages.some(message=>message.requestId===id&&message.type==='CANCEL'),held.requestId));
  assert.equal(await fs.readFile(path.join(dir,'journal.json'),'utf8'),initialJournal);assert.equal(await page.evaluate(()=>window.__storageWrites),0);assert.ok(mutations.every(url=>url==='/api/admin/login'||url==='/api/admin/temporary-search'),'Only login and explicit local searches may mutate HTTP state');assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  console.log('PASS responsive review, IG/Facebook/X controls preserved, auth-expiry cancellation, unchanged journal, zero external requests and zero real neighbors');
}finally{await browser?.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await fs.rm(dir,{recursive:true,force:true});}
