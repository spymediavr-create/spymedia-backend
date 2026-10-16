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
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'spymedia-follow-ui-'));
const output=fileURLToPath(new URL('../test-results/follow-tools/',import.meta.url));await fs.mkdir(output,{recursive:true});
const settings=config({SNS_DATA_DIR:dir,SNS_STORAGE_PERSISTENCE:'confirmed',SNS_SINGLE_INSTANCE:'confirmed'}),store=new Store(settings);await store.init();
let prepareCalls=0,executeCalls=0,searchCalls=0,failX=false,searchNamespace='',exclusionFailure=0;const errors=[],external=[],mutations=[],exclusionBodies=[];
const xFollows={status:()=>({ready:true,enabled:true}),prepare:async body=>{prepareCalls++;if(failX)throw Object.assign(Error('x_follow_auth_required'),{status:401,code:'x_follow_auth_required'});return {preparationId:'synthetic-preparation',confirmationToken:'synthetic-review-token',source:{userId:'111',username:'spymedia_kor'},target:{userId:'222',username:body.username,name:'합성 대상'},expiresAt:Date.now()+300000};},execute:async body=>{executeCalls++;assert.equal(body.confirmUsername,'synthetic_0');assert.equal(body.confirmTargetUserId,'222');assert.equal(body.confirmed,true);return {status:'pending',operationId:'00000000-0000-4000-8000-000000000001'};}};
const temporarySearch={describe:()=>({ready:true}),search:async({platform,page})=>{searchCalls++;return {page,hasMore:false,items:Array.from({length:12},(_,i)=>({url:platform==='instagram'?(i===11?'https://www.instagram.com/p/Synthetic/':`https://www.instagram.com/${searchNamespace}synthetic_${i}/`):platform==='x'?`https://x.com/synthetic_${i}`:`https://blog.naver.com/synthetic_${i}`,kind:platform==='instagram'&&i===11?'post':'profile',title:`합성 계정 ${i}`,snippet:'실제 계정이나 검색 결과가 아닙니다.'}))};}};
const service=new Service({settings,store,xFollows,temporarySearch,connectors:{availability:()=>({blog:true})}});
await service.candidates.create({platform:'instagram',accountName:'합성 저장 후보',profileUrl:'https://www.instagram.com/saved_fixture/'});
const journalBefore=await fs.readFile(path.join(dir,'journal.json'),'utf8');
const salt=randomBytes(16),password=randomBytes(24).toString('hex');
const handler=createAdminHandler({mode:'authenticated',username:'fixture',passwordHash:salt.toString('hex')+':'+scryptSync(password,salt,64).toString('hex'),secureCookie:false,service});
const server=http.createServer((req,res)=>{if(req.method==='POST')mutations.push(req.url);handler(req,res).then(done=>{if(!done){res.writeHead(404);res.end();}}).catch(error=>{errors.push(error.message);res.writeHead(500);res.end();});});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;let browser;
try{
  assert.equal((await fetch(origin+'/api/admin/tools/instagram-follow.zip')).status,401);
  assert.equal((await fetch(origin+'/api/admin/x/follows/prepare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'synthetic_0'})})).status,401);
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium'});
  const context=await browser.newContext({viewport:{width:1440,height:1100}});
  await context.addInitScript(()=>{
    window.__bridge=[];window.__bridgeMode='normal';window.__storageWrites=0;Storage.prototype.setItem=function(){window.__storageWrites++;throw Error('No persistent search storage');};
    const timeout=window.setTimeout;window.setTimeout=(fn,ms,...rest)=>{if(ms===900000)window.__expireSearch=fn;if(ms===45000)window.__expireStep=fn;if(ms>=600000&&ms<=900000)window.__lastLongTimer=fn;return timeout(fn,ms,...rest);};
    const jobs=new Map();
    window.addEventListener('message',event=>{
      const m=event.data;if(m?.source!=='spymedia-admin-follow')return;window.__bridge.push(m);
      const reply=(type,detail={})=>window.postMessage({source:'spymedia-follow-extension',type,action:m.type,requestId:m.requestId,version:'0.2.2',...detail},location.origin);
      if(m.type==='PING'){if(window.__bridgeMode==='old-legacy'){window.postMessage({source:'spymedia-follow-extension',type:'READY',requestId:m.requestId},location.origin);return;}reply('READY',{version:window.__bridgeMode==='old'?'0.1.0':window.__bridgeMode==='old-patch'?'0.2.1':'0.2.2'});return;}
      if(m.type==='CANCEL'){jobs.delete(m.requestId);return;}
      if(m.type==='PREPARE'){assertMock(m.control==='admin');const job={expectedAccount:m.expectedAccount,profiles:[...m.profiles],expiresAt:m.expiresAt,index:0,started:false,running:false,terminalError:null,results:[]};jobs.set(m.requestId,job);reply('STATE',{job});return;}
      const job=jobs.get(m.requestId);if(!job)return;
      if(m.type==='START'){job.started=true;job.running=true;const output=structuredClone(job);if(window.__bridgeMode==='wrong-account')output.expectedAccount='other_actor';if(window.__bridgeMode==='wrong-profile')output.profiles=['https://www.instagram.com/wrong_fixture/'];if(window.__bridgeMode==='wrong-expiry')output.expiresAt++;reply('STATE',{job:output});return;}
      if(m.type==='STEP'){
        assertMock(m.index===job.index);const done=()=>{job.results.push({index:job.index,state:['followed','request_sent','following','requested'][job.index%4]});job.index++;job.running=job.index<job.profiles.length;reply('STATE',{job:structuredClone(job)});};
        if(window.__bridgeMode==='hold'){window.__releaseStep=done;return;}
        if(window.__bridgeMode==='error'){reply('ERROR',{code:'account_unverified'});return;}
        if(window.__bridgeMode==='uncertain'){reply('ERROR',{code:'uncertain'});return;}
        done();return;
      }
      if(m.type==='STATUS')reply('STATE',{job});
    });
    function assertMock(condition){if(!condition)throw Error('Mock extension protocol mismatch');}
  });
  await context.route('**/*',route=>{const request=route.request(),url=new URL(request.url());if(url.origin===origin){if(url.pathname==='/api/admin/instagram/follow-exclusions'&&request.method()==='POST'){exclusionBodies.push(request.postDataJSON());if(exclusionFailure)return route.fulfill(exclusionFailure===401?{status:401,contentType:'text/html',body:'<p>Session expired</p>'}:{status:exclusionFailure,contentType:'application/json',body:JSON.stringify({error:'storage_unavailable'})});}return route.continue();}external.push(request.url());return route.abort();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/admin/login');await page.locator('#login-id').fill('fixture');await page.locator('#login-password').fill(password);await page.locator('#login-submit').click();await page.waitForURL(origin+'/admin');
  const idle=()=>page.waitForFunction(()=>!document.getElementById('temporary-search-fields').disabled);
  const search=async(platform,keyword='합성 검색')=>{await idle();await page.locator('#temporary-search-platform').selectOption(platform);await page.locator('#temporary-search-keyword').fill(keyword);await page.locator('#temporary-search-submit').click();await idle();};
  await idle();assert.equal(prepareCalls+executeCalls+searchCalls,0);
  assert.equal(await page.locator('#temporary-search-follow-prepare').isDisabled(),true);
  await search('instagram');await page.locator('#temporary-search-all').check();assert.equal(await page.locator('#temporary-search-follow-prepare').isDisabled(),false);
  await page.locator('#temporary-search-follow-prepare').click();await page.locator('#temporary-search-instagram-follow-start').waitFor();assert.equal(await page.evaluate(()=>window.__bridge.length),0);assert.equal(await page.locator('#temporary-search-follow-review li').count(),10);
  await page.locator('#temporary-search-instagram-follow-start').click();await page.waitForFunction(()=>document.getElementById('temporary-search-follow-feedback').textContent.includes('처리가 끝났습니다'));
  const bridge=await page.evaluate(()=>window.__bridge);const sent=bridge.find(m=>m.type==='PREPARE');assert.equal(sent.profiles.length,10);assert.equal(sent.expectedAccount,'spymedia_kr');assert.equal(sent.platform,'instagram');assert.ok(sent.expiresAt>Date.now());assert.ok(!JSON.stringify(sent).includes('합성 검색'));assert.equal(await page.locator('#temporary-search-follow-prepare').isDisabled(),true);
  assert.equal(sent.control,'admin');assert.deepEqual(bridge.filter(m=>m.type==='STEP').map(m=>m.index),Array.from({length:10},(_,i)=>i));assert.match(await page.locator('#temporary-search-follow-review').textContent(),/팔로우 완료/);assert.match(await page.locator('#temporary-search-follow-review').textContent(),/상대 승인 대기/);assert.match(await page.locator('#temporary-search-follow-review').textContent(),/이미 팔로잉/);assert.match(await page.locator('#temporary-search-follow-review').textContent(),/이미 요청 중/);
  assert.equal(exclusionBodies.length,10);assert.ok(exclusionBodies.every(body=>body.account==='spymedia_kr'&&body.items.length===1&&Object.keys(body).sort().join(',')==='account,items'&&Object.keys(body.items[0]).sort().join(',')==='state,username'));
  assert.deepEqual(exclusionBodies.map(body=>body.items[0].state),Array.from({length:10},(_,i)=>['followed','request_sent','following','requested'][i%4]));
  assert.equal(await page.locator('.search-result').count(),10);assert.equal(searchCalls,1);
  await page.locator('#temporary-search-clear').click();await page.waitForFunction(id=>window.__bridge.some(m=>m.type==='CANCEL'&&m.requestId===id),sent.requestId);
  console.log('PASS inline exact-account/target review before any extension action; sequential once-only STEP and per-target result states; clear cancels');
  for(const keyword of ['합성 검색','새 키워드 검색']){const before=searchCalls;await search('instagram',keyword);assert.equal(searchCalls,before+1);assert.equal(await page.locator('.search-result').count(),2);assert.match(await page.locator('#temporary-search-range').textContent(),/10개.*제외|제외.*10개/);assert.ok(!(await page.locator('#temporary-search-results').textContent()).includes('/synthetic_0/'));}
  console.log('PASS confirmed results persist minimal account/username/state only; current rows remain, subsequent same or different keyword excludes following/requested without extra searches');
  searchNamespace='later_';
  await search('instagram');await page.locator('#temporary-search-next').click();await page.locator('#temporary-search-all').check();assert.equal(await page.locator('#temporary-search-follow-prepare').isDisabled(),true);assert.match(await page.locator('#temporary-search-follow').textContent(),/게시물 주소/);
  await page.locator('#account-tab-saved').click();await page.waitForFunction(()=>!document.getElementById('candidates-refresh').disabled);await page.locator('#candidates-all').check();await page.waitForFunction(()=>!document.getElementById('candidates-refresh').disabled);
  await page.locator('#candidates-follow-prepare').click();await page.locator('#candidates-instagram-follow-start').click();await page.waitForFunction(()=>document.getElementById('candidates-follow-feedback').textContent.includes('처리가 끝났습니다'));assert.ok(await page.evaluate(()=>window.__bridge.some(m=>m.profiles?.[0]==='https://www.instagram.com/saved_fixture/')));
  await page.locator('#candidates-follow').getByRole('button',{name:'Instagram 작업 중지'}).click();
  assert.equal(await page.locator('#candidates-follow-review li').count(),1);await page.evaluate(()=>window.__lastLongTimer());assert.equal(await page.locator('#candidates-follow-review li').count(),0);assert.match(await page.locator('#candidates-follow-feedback').textContent(),/유효 시간이 끝났습니다/);
  console.log('PASS post URLs cannot be followed; saved current-page selections use same inline review path');
  await page.locator('#account-tab-search').click();await search('x');await page.locator('#temporary-search-all').check();assert.equal(await page.locator('#temporary-search-follow-prepare').isDisabled(),true);await page.locator('#temporary-search-all').uncheck();await page.locator('[data-search-select]').first().check();
  await page.locator('#temporary-search-follow-prepare').click();await page.getByRole('button',{name:'이 X 계정 팔로우 실행'}).waitFor();assert.equal(prepareCalls,1);assert.equal(executeCalls,0);
  page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'이 X 계정 팔로우 실행'}).click();assert.equal(executeCalls,0);
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'이 X 계정 팔로우 실행'}).click();await page.waitForFunction(()=>document.getElementById('temporary-search-follow-feedback').textContent.includes('승인 대기'));assert.equal(executeCalls,1);
  assert.equal(await page.locator('#temporary-search-follow-review button').count(),0);
  failX=true;await page.locator('#temporary-search-follow-prepare').click();await page.waitForFunction(()=>document.getElementById('temporary-search-follow-feedback').textContent.includes('기존 인증'));assert.equal(await page.locator('.search-result').count(),10);assert.equal(await page.locator('#temporary-search-fields').isDisabled(),false);failX=false;
  console.log('PASS X only one reviewed account; cancel sends no mutation; confirmed mock POST pending is not marked completed');
  await search('blog');assert.equal(await page.locator('#temporary-search-follow-prepare').isVisible(),false);assert.match(await page.locator('#temporary-search-follow').textContent(),/서로이웃은 상대/);
  const beginInstagram=async mode=>{await page.evaluate(mode=>{window.__bridgeMode=mode;window.__releaseStep=null;},mode);await search('instagram');await page.locator('[data-search-select]').first().check();await page.locator('#temporary-search-follow-prepare').click();await page.locator('#temporary-search-instagram-follow-start').click();};
  let marker,recent;for(const mode of ['old','old-patch','old-legacy']){marker=await page.evaluate(()=>window.__bridge.length);await beginInstagram(mode);await page.waitForFunction(()=>document.getElementById('temporary-search-follow-feedback').textContent.includes('0.2.2 이상'));recent=await page.evaluate(i=>window.__bridge.slice(i),marker);assert.equal(recent.filter(m=>m.type==='PREPARE'||m.type==='START'||m.type==='STEP').length,0);assert.equal(await page.locator('#temporary-search-follow details').getAttribute('open'),'');}
  for(const mode of ['wrong-account','wrong-profile','wrong-expiry']){marker=await page.evaluate(()=>window.__bridge.length);await beginInstagram(mode);await page.waitForFunction(()=>document.getElementById('temporary-search-follow-feedback').textContent.includes('응답을 검증하지 못'));recent=await page.evaluate(i=>window.__bridge.slice(i),marker);assert.equal(recent.filter(m=>m.type==='STEP').length,0);assert.ok(recent.some(m=>m.type==='CANCEL'));}
  const beforeUnconfirmed=exclusionBodies.length;await beginInstagram('error');await page.waitForFunction(()=>document.getElementById('temporary-search-follow-feedback').textContent.includes('로그아웃을 뜻하지 않습니다'));assert.equal(await page.locator('#temporary-search-follow-review .follow-result').first().textContent(),'중지 · 결과 확인 필요');assert.equal(exclusionBodies.length,beforeUnconfirmed);
  await beginInstagram('uncertain');await page.waitForFunction(()=>document.getElementById('temporary-search-follow-feedback').textContent.includes('확정하지 못'));assert.equal(exclusionBodies.length,beforeUnconfirmed);
  exclusionFailure=503;const beforeSaveFailure=exclusionBodies.length;await beginInstagram('normal');await page.waitForFunction(()=>document.getElementById('temporary-search-follow-feedback').textContent.includes('처리가 끝났습니다'));assert.equal(exclusionBodies.length,beforeSaveFailure+1);assert.match(await page.locator('#temporary-search-follow-review').textContent(),/팔로우 완료/);assert.match(await page.locator('#temporary-search-follow-exclusions').textContent(),/실패|저장하지 못/);assert.equal(await page.locator('.search-result').count(),10);assert.equal(await page.locator('#temporary-search-fields').isDisabled(),false);exclusionFailure=0;
  console.log('PASS failed/uncertain follow results never save; storage failure during exclusion saving leaves confirmed follow success and current search intact, without retries');
  console.log('PASS old extension never prepares; wrong account/profile/expiry responses stop before STEP; identity failure distinct from logout');
  await beginInstagram('hold');await page.waitForFunction(()=>!!window.__releaseStep);const held=await page.evaluate(()=>window.__bridge.findLast(m=>m.type==='STEP'));await page.locator('#temporary-search-follow').getByRole('button',{name:'Instagram 작업 중지'}).click();await page.waitForFunction(id=>window.__bridge.some(m=>m.type==='CANCEL'&&m.requestId===id),held.requestId);assert.match(await page.locator('#temporary-search-follow-review').textContent(),/결과 확인 필요/);await page.evaluate(()=>window.__releaseStep());assert.doesNotMatch(await page.locator('#temporary-search-follow-feedback').textContent(),/처리가 끝났습니다/);assert.equal(await page.evaluate(id=>window.__bridge.filter(m=>m.requestId===id&&m.type==='STEP').length,held.requestId),1);
  await beginInstagram('hold');await page.waitForFunction(()=>!!window.__releaseStep);const changed=await page.evaluate(()=>window.__bridge.findLast(m=>m.type==='STEP'));await page.locator('[data-search-select]').first().uncheck();await page.waitForFunction(id=>window.__bridge.some(m=>m.type==='CANCEL'&&m.requestId===id),changed.requestId);assert.equal(await page.locator('#temporary-search-follow-review li').count(),0);await page.evaluate(()=>window.__releaseStep());assert.equal(await page.locator('#temporary-search-follow-review li').count(),0);
  await beginInstagram('hold');await page.waitForFunction(()=>!!window.__releaseStep);const timed=await page.evaluate(()=>window.__bridge.findLast(m=>m.type==='STEP'));await page.evaluate(()=>window.__expireStep());await page.waitForFunction(()=>document.getElementById('temporary-search-follow-feedback').textContent.includes('응답 시간이 초과'));await page.evaluate(()=>window.__releaseStep());assert.equal(await page.evaluate(id=>window.__bridge.filter(m=>m.requestId===id&&m.type==='STEP').length,timed.requestId),1);
  console.log('PASS stop/selection change ignore late replies; 45-second STEP timeout cancels without retransmission');
  await beginInstagram('hold');await page.waitForFunction(()=>!!window.__releaseStep);
  await page.evaluate(()=>window.__expireSearch());assert.equal(await page.locator('.search-result').count(),0);assert.equal(await page.locator('#temporary-search-follow-prepare').isDisabled(),true);
  await page.evaluate(()=>{window.__bridgeMode='normal';});await search('instagram');await page.locator('[data-search-select]').first().check();await page.locator('#temporary-search-follow-prepare').click();await page.locator('#temporary-search-instagram-follow-start').waitFor();
  await page.locator('#sns-accounts').screenshot({path:path.join(output,'follow-desktop.png')});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.locator('#sns-accounts').screenshot({path:path.join(output,'follow-mobile.png')});
  await search('instagram');await page.locator('#temporary-search-all').check();await page.locator('#temporary-search-follow-prepare').click();exclusionFailure=401;const beforeAuthFailure=await page.evaluate(()=>window.__bridge.length);await page.locator('#temporary-search-instagram-follow-start').click();await page.waitForFunction(()=>document.getElementById('temporary-search-login').hidden===false);assert.equal(await page.locator('#temporary-search-follow-prepare').isDisabled(),true);assert.equal(await page.locator('.search-result').count(),0);const authBridge=await page.evaluate(i=>window.__bridge.slice(i),beforeAuthFailure);assert.equal(authBridge.filter(m=>m.type==='STEP').length,1);assert.ok(authBridge.some(m=>m.type==='CANCEL'));assert.doesNotMatch(await page.locator('#temporary-search-follow-feedback').textContent(),/팔로우 실패/);exclusionFailure=0;
  console.log('PASS authentication expiry while saving confirmed result cancels remaining steps, clears private page state, and never retries or labels a confirmed follow failed');
  const saved=JSON.parse(await fs.readFile(path.join(dir,'journal.json'),'utf8'));const {instagramFollowExclusions,...unchanged}=saved;const expectedJournal=JSON.parse(journalBefore);for(const [id,candidate]of Object.entries(expectedJournal.candidates)){candidate.selected=true;candidate.revision=2;candidate.updatedAt=unchanged.candidates[id].updatedAt;}assert.deepEqual(unchanged,expectedJournal);assert.deepEqual(Object.keys(instagramFollowExclusions),['spymedia_kr']);for(const entry of Object.values(instagramFollowExclusions.spymedia_kr)){assert.deepEqual(Object.keys(entry).sort(),['confirmedAt','state','username']);assert.ok(['following','requested'].includes(entry.state));assert.ok(Number.isFinite(Date.parse(entry.confirmedAt)));}assert.equal(Object.keys(instagramFollowExclusions.spymedia_kr).length,11);assert.ok(!JSON.stringify(unchanged).includes('synthetic_'));assert.equal(Object.keys(saved.candidates).length,1);assert.equal(await page.evaluate(()=>window.__storageWrites),0);
  assert.equal(external.length,0);assert.deepEqual(errors,[]);assert.equal(prepareCalls,2);assert.equal(executeCalls,1);
  const status=await context.request.get(origin+'/api/admin/status');const session=await status.json();
  const rejected=await context.request.post(origin+'/api/admin/x/follows/execute',{data:{confirmed:true}});assert.equal(rejected.status(),403);
  const download=await context.request.get(origin+'/api/admin/tools/instagram-follow.zip');assert.equal(download.status(),200);assert.equal((await download.body()).readUInt32LE(0),0x04034b50);assert.match(download.headers()['content-type'],/zip/);
  assert.ok(session.csrfToken);assert.ok(journalBefore);console.log('PASS auth/CSRF/download protection, expiry/logout cancellation, no search persistence, mobile layout and zero external requests');
  console.log('All follow UI checks passed. Actual SNS follows: 0.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await fs.rm(dir,{recursive:true,force:true});}
