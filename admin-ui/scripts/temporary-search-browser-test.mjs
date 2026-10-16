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
import {TemporarySearch} from '../backend/temporary-search.cjs';
import {createAdminHandler} from '../server-core.cjs';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const output=fileURLToPath(new URL('../test-results/temporary-search/',import.meta.url)),dir=await fs.mkdtemp(path.join(os.tmpdir(),'spymedia-transient-browser-'));await fs.mkdir(output,{recursive:true});
const checks=[],errors=[],external=[],opened=[],requests=[],providerRequests=[];const pass=value=>{checks.push(value);console.log('PASS '+value);};
const key=randomBytes(24).toString('hex'),rawPrivate='synthetic-private-provider-error';let mode='normal',gate,release,failResponse=null,clock=100000,providerCalls=0,snsCalls=0,browser,server;
const settings=config({SNS_DATA_DIR:dir,SNS_STORAGE_PERSISTENCE:'confirmed',SNS_SINGLE_INSTANCE:'confirmed',BRAVE_SEARCH_ENABLED:'false',BRAVE_SEARCH_API_KEY:''});
const links={instagram:i=>'https://www.instagram.com/transient_'+i+'/',facebook:i=>'https://facebook.com/transient'+i,x:i=>'https://x.com/transient_'+i,blog:i=>'https://blog.naver.com/transient_'+i};
const posts={instagram:'https://instagram.com/p/SyntheticPost/',facebook:'https://facebook.com/transient0/posts/12345',x:'https://twitter.com/transient_0/status/12345',blog:'https://m.blog.naver.com/transient_0/12345'};
const provider=new TemporarySearch(settings,{now:()=>clock+=100000,get:async(url,options)=>{
  providerCalls++;providerRequests.push({url,query:options.params.q,offset:options.params.offset,count:options.params.count});
  if(gate)await gate;
  if(mode==='error')return {status:503,data:{message:rawPrivate,key}};
  if(mode==='empty')return {status:200,data:{query:{more_results_available:false},web:{results:[]}}};
  if(mode==='filtered-pages')return {status:200,data:{query:{more_results_available:true},web:{results:[{url:'https://evil.invalid/fixture',title:'unsafe synthetic'}]}}};
  const q=options.params.q,platform=q.includes('site:instagram.com')?'instagram':q.includes('site:facebook.com')?'facebook':q.includes('site:blog.naver.com')?'blog':'x',offset=options.params.offset;
  const results=Array.from({length:20},(_,i)=>({url:offset===1&&i===0?links[platform](0):i===19?posts[platform]:links[platform](offset*20+i),title:i===0&&offset===0?'<script>window.searchInjected=true</script> 합성 프로필':'합성 '+platform+' 결과 '+(offset*20+i),description:'합성 검색 설명 <img src=x onerror=alert(1)> · 실제 결과 아님'}));
  return {status:200,data:{query:{more_results_available:offset===0},web:{results}}};
}});
const store=new Store(settings);await store.init();const service=new Service({settings,store,temporarySearch:provider,connectors:{availability:()=>({blog:true}),publish:async()=>{snsCalls++;throw Error('No SNS calls');}},media:{tools:async()=>{snsCalls++;throw Error('No media calls');},convert:async()=>{snsCalls++;throw Error('No media calls');}}});
let manual=await service.candidates.create({platform:'instagram',accountName:'기존 수동 후보 fixture',profileUrl:'https://instagram.com/manual_fixture/',industry:'여행사',region:'인천',note:'기존 메모 보존'});manual=await service.candidates.update(manual.id,{revision:1,selected:true,status:'done'});
const journalBefore=await fs.readFile(path.join(dir,'journal.json'),'utf8');
const salt=randomBytes(16),password=randomBytes(24).toString('hex'),handler=createAdminHandler({mode:'authenticated',username:'fixture',passwordHash:salt.toString('hex')+':'+scryptSync(password,salt,64).toString('hex'),secureCookie:false,service});
server=http.createServer((req,res)=>{requests.push({method:req.method,path:req.url});handler(req,res).then(done=>{if(!done){res.writeHead(404);res.end();}}).catch(error=>{errors.push(error.message);res.writeHead(500);res.end();});});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium'});const context=await browser.newContext({viewport:{width:1440,height:1100}});
  await context.addInitScript(()=>{
    window.__persistentWrites=0;Storage.prototype.setItem=function(){window.__persistentWrites++;throw Error('Persistent storage write prohibited');};
    const timer=window.setTimeout;window.setTimeout=(fn,delay,...rest)=>{if(delay===15*60*1000)window.__expireTemporary=fn;return timer(fn,delay,...rest);};
  });
  await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.origin===origin){if(url.pathname==='/api/admin/temporary-search'&&failResponse)return route.fulfill({status:failResponse.status,headers:{'Content-Type':'application/json','Retry-After':'3'},body:JSON.stringify({error:failResponse.error})});return route.continue();}
    if(url.origin==='https://www.instagram.com'){opened.push({url:url.href,headers:await req.allHeaders()});return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Synthetic source placeholder</title>'});}
    if(req.url().startsWith('blob:')||req.url().startsWith('data:'))return route.continue();external.push(req.url());return route.abort();
  });
  context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));const page=await context.newPage();
  await page.goto(origin+'/admin/login');await page.locator('#login-id').fill('fixture');await page.locator('#login-password').fill(password);await page.locator('#login-submit').click();await page.waitForURL(origin+'/admin');await page.waitForFunction(()=>document.getElementById('temporary-search-feedback').textContent.includes('설정'));
  assert.match(await page.locator('#temporary-search-feedback').textContent(),/설정되지/);assert.equal(await page.locator('#temporary-search-submit').isDisabled(),true);assert.equal(await page.locator('.search-result').count(),0);assert.equal(providerCalls,0);
  pass('Unconfigured API is explicit, makes zero provider requests and shows no fake results while the saved manual candidate remains');
  const searchTab=page.getByRole('tab',{name:'새 계정 검색',exact:true}),savedTab=page.getByRole('tab',{name:'저장 후보',exact:true});
  const active=async saved=>{
    assert.equal(await page.locator('#sns-candidates').isVisible(),saved);assert.equal(await page.locator('#sns-temporary-search').isVisible(),!saved);
    for(const [tab,selected,panel]of [[searchTab,!saved,'sns-temporary-search'],[savedTab,saved,'sns-candidates']]){
      assert.equal(await tab.getAttribute('aria-selected'),String(selected));assert.equal(await tab.getAttribute('tabindex'),selected?'0':'-1');assert.equal(await tab.getAttribute('aria-controls'),panel);
      assert.equal(await page.locator('#'+panel).getAttribute('aria-labelledby'),await tab.getAttribute('id'));
    }
    assert.equal(await page.locator('#sns-accounts').getByRole('tabpanel').count(),1);
  };
  assert.equal(await page.locator('#sns-accounts.panel').count(),1);assert.equal(await page.locator('#sns-accounts .panel').count(),0);assert.equal(await page.locator('#sns-accounts h2').count(),1);await active(false);
  await searchTab.focus();await page.keyboard.press('End');await active(true);assert.equal(await savedTab.evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('Tab');assert.equal(await page.locator('#sns-candidates').evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('Tab');assert.equal(await page.locator('#candidates-refresh').evaluate(el=>el===document.activeElement),true);
  await savedTab.focus();await page.keyboard.press('Home');await active(false);assert.equal(await searchTab.evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('ArrowLeft');await active(true);await page.keyboard.press('ArrowRight');await active(false);
  await page.evaluate(()=>location.hash='sns-candidates');await page.waitForFunction(()=>!document.getElementById('sns-candidates').hidden);await active(true);
  await page.evaluate(()=>location.hash='sns-temporary-search');await page.waitForFunction(()=>!document.getElementById('sns-temporary-search').hidden);await active(false);await page.evaluate(()=>history.replaceState(null,'','/admin'));
  assert.equal(providerCalls,0);assert.ok(requests.filter(r=>r.method!=='GET').every(r=>r.path==='/api/admin/login'));
  pass('One outer card and one heading contain two correctly labelled tabs; keyboard wrap/Home/End, focus order and legacy fragment links work without a search or candidate write');
  settings.env.BRAVE_SEARCH_ENABLED='true';settings.env.BRAVE_SEARCH_API_KEY=key;await page.reload();
  const idle=()=>page.waitForFunction(()=>!document.getElementById('temporary-search-fields').disabled);
  await idle();assert.equal(providerCalls,0);assert.equal(await page.locator('#candidate-accountName').inputValue(),'');
  const search=async(platform='instagram',keyword='합성 여행사',region='전국')=>{await idle();await page.locator('#temporary-search-platform').selectOption(platform);await page.locator('#temporary-search-keyword').fill(keyword);await page.locator('#temporary-search-region').fill(region);await page.locator('#temporary-search-submit').click();await idle();};
  await search();assert.equal(providerCalls,1);assert.equal(await page.locator('.search-result').count(),10);assert.equal(providerRequests[0].count,20);assert.equal(providerRequests[0].offset,0);assert.equal(providerRequests[0].query,'합성 여행사 site:instagram.com');
  assert.equal(await page.locator('#temporary-search-results script').count(),0);assert.equal(await page.locator('#temporary-search-results img').count(),0);assert.equal(await page.evaluate(()=>window.searchInjected),undefined);
  await page.locator('#temporary-search-all').check();assert.match(await page.locator('#temporary-search-selected').textContent(),/10개/);
  await page.waitForFunction(()=>!document.getElementById('candidates-refresh').disabled);const beforeSwitch=providerCalls,candidateReadsBefore=requests.filter(r=>r.path.startsWith('/api/admin/candidates')).length;await savedTab.click();await active(true);
  assert.equal(await page.locator('.candidate-card').count(),1);assert.equal(await page.locator('.candidate-card input[type=checkbox]').isChecked(),true);assert.equal(await page.locator('.candidate-card').getAttribute('data-status'),'done');
  await page.locator('.candidate-card').getByRole('button',{name:'정보·메모 수정'}).click();await page.locator('#candidate-note').fill('합성 저장 후보 편집 초안');await page.locator('#candidates-query').fill('기존 수동');
  await searchTab.click();await active(false);assert.equal(await page.locator('#temporary-search-all').isChecked(),true);assert.match(await page.locator('#temporary-search-selected').textContent(),/10개/);assert.equal(await page.locator('#temporary-search-keyword').inputValue(),'합성 여행사');
  await savedTab.click();assert.equal(await page.locator('#candidate-note').inputValue(),'합성 저장 후보 편집 초안');assert.equal(await page.locator('#candidate-editor').evaluate(el=>el.open),true);assert.equal(await page.locator('#candidates-query').inputValue(),'기존 수동');
  await searchTab.click();assert.equal(providerCalls,beforeSwitch);assert.equal(requests.filter(r=>r.path.startsWith('/api/admin/candidates')).length,candidateReadsBefore);assert.equal(await fs.readFile(path.join(dir,'journal.json'),'utf8'),journalBefore);
  pass('Tab switches preserve temporary checks/query and the separate saved candidate checks/status/filter/editor draft; they never search, save, copy or mix the two collections');
  await page.locator('#temporary-search-next').click();assert.equal(await page.locator('.search-result').count(),10);assert.equal(providerCalls,1);assert.equal(await page.locator('#temporary-search-results [data-kind=post]').count(),1);assert.match(await page.locator('#temporary-search-results').textContent(),/지역 미검증/);
  await page.getByRole('button',{name:'임시 1페이지',exact:true}).click();assert.equal(await page.locator('#temporary-search-all').isChecked(),true);assert.equal(providerCalls,1);
  pass('One synthetic 20-result request yields two ten-row pages, preserving temporary checks with profile/post and unverified-region labels and literal text');
  const open=page.waitForEvent('popup');await page.locator('.search-result').first().getByRole('link').click();const popup=await open;await popup.waitForLoadState();assert.equal(await popup.evaluate(()=>window.opener),null);await popup.close();assert.equal(opened.length,1);assert.equal(opened[0].headers.referer,undefined);assert.equal(opened[0].headers.cookie,undefined);
  await page.locator('#temporary-search-next').click();await page.locator('#temporary-search-next').click();await idle();assert.equal(providerCalls,2);assert.equal(await page.locator('.search-result').count(),10);await page.locator('#temporary-search-next').click();assert.equal(providerCalls,2);assert.equal(await page.locator('.search-result').count(),8);assert.equal(await page.locator('#temporary-search-next').isDisabled(),true);
  pass('Source link opens with no opener/referrer/cookie; cross-batch duplicate profile and post URLs are removed and a short last page disables further calls');
  for(const sns of ['facebook','x','blog']){const before=providerCalls;await search(sns,'합성 건설','충청도');assert.equal(providerCalls,before+1);assert.equal(await page.locator('.search-result').count(),10);assert.ok(providerRequests.at(-1).query.includes('충북 OR 충남 OR 대전 OR 세종'));await page.locator('#temporary-search-next').click();assert.equal(providerCalls,before+1);assert.equal(await page.locator('#temporary-search-results [data-kind=post]').count(),1);}
  pass('Facebook, X/Twitter and Naver Blog use only their selected domain queries; viewing the second ten-row page makes no extra API request');
  await page.locator('#sns-accounts').screenshot({path:path.join(output,'unified-search-desktop.png')});await savedTab.click();await page.locator('#sns-accounts').screenshot({path:path.join(output,'unified-saved-desktop.png')});await searchTab.click();
  for(const width of [390,360]){
    await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    for(const tab of [searchTab,savedTab]){const box=await tab.boundingBox();assert.ok(box.height>=44&&box.width>=44);}
    await page.locator('#sns-accounts').screenshot({path:path.join(output,'mock-mobile-'+width+'.png')});
    await savedTab.click();await active(true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.locator('#sns-accounts').screenshot({path:path.join(output,'unified-saved-mobile-'+width+'.png')});
    await searchTab.click();await active(false);
  }
  assert.equal(await page.locator('#sns-temporary-search button').filter({hasText:'저장'}).count(),0);assert.equal(await page.locator('#sns-temporary-search button').filter({hasText:'추가'}).count(),0);
  await page.locator('#temporary-search-clear').click();assert.equal(await page.locator('.search-result').count(),0);assert.match(await page.locator('#temporary-search-selected').textContent(),/0개/);
  await search();await savedTab.click();await page.evaluate(()=>window.__expireTemporary());assert.equal(await page.locator('.search-result').count(),0);assert.equal(await page.locator('#candidate-note').inputValue(),'합성 저장 후보 편집 초안');await searchTab.click();assert.match(await page.locator('#temporary-search-feedback').textContent(),/열람 시간/);
  await search();await page.locator('#temporary-search-all').check();await page.reload();await idle();assert.equal(await page.locator('.search-result').count(),0);assert.match(await page.locator('#temporary-search-selected').textContent(),/0개/);
  await search();await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));assert.equal(await page.locator('.search-result').count(),0);assert.equal(await page.locator('#temporary-search-keyword').inputValue(),'');assert.equal(await page.evaluate(()=>window.__persistentWrites),0);
  pass('Both views fit 360/390px with 44px tabs; no permanent search add/save exists; expiry also clears a hidden search view while saved drafts survive; reload and pagehide remove temporary data');
  mode='empty';await search();assert.equal(await page.locator('.search-result').count(),0);assert.equal(await page.locator('#temporary-search-next').isDisabled(),true);assert.match(await page.locator('#temporary-search-feedback').textContent(),/0개/);
  mode='filtered-pages';const beforeLimit=providerCalls;await search();for(let i=0;i<9;i++){await page.locator('#temporary-search-next').click();await idle();}assert.equal(providerCalls,beforeLimit+10);assert.equal(providerRequests.at(-1).offset,9);assert.equal(await page.locator('#temporary-search-next').isDisabled(),true);assert.match(await page.locator('#temporary-search-feedback').textContent(),/마지막 결과 묶음/);
  pass('True zero results, unsafe-only results and the provider offset-9 boundary stay honest and never automatically fetch another page');
  mode='error';await search();assert.match(await page.locator('#temporary-search-feedback').textContent(),/완료하지 못/);assert.ok(!(await page.locator('#sns-temporary-search').textContent()).includes(rawPrivate));assert.ok(!(await page.locator('body').textContent()).includes(key));
  failResponse={status:429,error:'temporary_search_rate_limited'};await page.locator('#temporary-search-submit').click();await page.waitForFunction(()=>document.getElementById('temporary-search-feedback').textContent.includes('너무 빠르거나'));assert.match(await page.locator('#temporary-search-feedback').textContent(),/요청/);assert.equal(await page.locator('#temporary-search-submit').isDisabled(),true);failResponse=null;await idle();mode='normal';
  gate=new Promise(resolve=>release=resolve);const beforePending=providerCalls,pending=page.waitForResponse(r=>r.url()===origin+'/api/admin/temporary-search');await page.locator('#temporary-search-keyword').fill('합성 탭 전환');await page.locator('#temporary-search-submit').click();await savedTab.click();await active(true);release();gate=null;await pending;await idle();assert.equal(providerCalls,beforePending+1);assert.equal(await page.locator('.search-result').count(),10);await searchTab.click();await active(false);assert.equal(await page.locator('.search-result').first().isVisible(),true);
  pass('Switching tabs during an in-flight synthetic search neither aborts nor starts a request; its results remain available in the search view');
  gate=new Promise(resolve=>release=resolve);await page.locator('#temporary-search-keyword').fill('합성 지연');await page.locator('#temporary-search-submit').click();await page.waitForFunction(()=>document.getElementById('temporary-search-clear').disabled===false);await page.locator('#temporary-search-clear').click();release();gate=null;await page.waitForTimeout(100);assert.equal(await page.locator('.search-result').count(),0);
  pass('Provider error is sanitized, 429 is enforced without retry, and clearing an in-flight search prevents stale results from reappearing');
  assert.equal(requests.filter(r=>r.path==='/api/admin/instagram/follow-exclusions').length,0);
  await search();const beforeExclusionManagement=providerCalls,currentSearch=await page.locator('#temporary-search-results').textContent();
  const exclusions=page.locator('#instagram-follow-exclusions');await exclusions.locator('summary').click();await page.waitForFunction(()=>document.getElementById('instagram-follow-exclusions-feedback').textContent.includes('확인했습니다'));
  assert.equal(providerCalls,beforeExclusionManagement);assert.equal(requests.filter(r=>r.path==='/api/admin/instagram/follow-exclusions'&&r.method==='GET').length,1);
  await page.locator('#instagram-follow-exclusion-usernames').fill('@Transient_0, transient_1');await exclusions.getByRole('button',{name:'팔로잉 계정 제외 등록',exact:true}).click();await page.waitForFunction(()=>document.getElementById('instagram-follow-exclusions-feedback').textContent.includes('2개 계정'));
  assert.equal(providerCalls,beforeExclusionManagement);assert.equal(await page.locator('#temporary-search-results').textContent(),currentSearch);
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await exclusions.screenshot({path:path.join(output,'exclusions-management-'+width+'.png')});
  }
  for(const keyword of ['합성 여행사','합성 다른 검색어']){const before=providerCalls;await search('instagram',keyword);assert.equal(providerCalls,before+1);assert.match(await page.locator('#temporary-search-range').textContent(),/2개.*제외|제외.*2개/);assert.ok(!(await page.locator('#temporary-search-results').textContent()).includes('/transient_0/'));assert.ok(!(await page.locator('#temporary-search-results').textContent()).includes('/transient_1/'));await page.locator('#temporary-search-next').click();assert.equal(await page.locator('.search-result').count(),8);assert.equal(providerCalls,before+1);}
  await exclusions.getByRole('button',{name:'@transient_0 검색에 다시 표시',exact:true}).click();await page.waitForFunction(()=>document.getElementById('instagram-follow-exclusions-feedback').textContent.includes('@transient_0 계정을 다음 검색'));
  await search();assert.match(await page.locator('#temporary-search-results').textContent(),/\/transient_0\//);assert.match(await page.locator('#temporary-search-range').textContent(),/1개.*제외|제외.*1개/);
  const session=await (await context.request.get(origin+'/api/admin/status')).json();const requestSaved=await context.request.post(origin+'/api/admin/instagram/follow-exclusions',{headers:{Origin:origin,'X-CSRF-Token':session.csrfToken},data:{account:'spymedia_kr',items:[{username:'transient_2',state:'requested'}]}});assert.equal(requestSaved.status(),200);
  await search();assert.match(await page.locator('#temporary-search-range').textContent(),/2개.*제외|제외.*2개/);assert.ok(!(await page.locator('#temporary-search-results').textContent()).includes('/transient_2/'));
  for(const sns of ['x','blog']){const before=providerCalls;await search(sns);assert.equal(providerCalls,before+1);assert.equal(await page.locator('.search-result').count(),10);assert.ok((await page.locator('#temporary-search-results').textContent()).includes('transient_1'));assert.doesNotMatch(await page.locator('#temporary-search-range').textContent(),/2개.*제외|제외.*2개/);}
  assert.equal(snsCalls,0);pass('History is read only when opened; manually confirmed following/requested accounts stay excluded across keywords; restoring changes only future search visibility; each search makes exactly one provider request and X/blog remain unchanged');
  failResponse={status:401,error:'authentication_required'};await page.locator('#temporary-search-keyword').fill('합성 만료');await page.locator('#temporary-search-submit').click();await page.waitForFunction(()=>document.getElementById('temporary-search-login').hidden===false);assert.equal(await page.locator('.search-result').count(),0);assert.equal(await page.locator('#temporary-search-submit').isDisabled(),true);
  await savedTab.click();await active(true);assert.equal(await page.locator('#candidate-save').isDisabled(),true);assert.equal(await page.locator('#candidates-login').isVisible(),true);await searchTab.click();await active(false);
  const {instagramFollowExclusions,...unchanged}=JSON.parse(await fs.readFile(path.join(dir,'journal.json'),'utf8'));assert.deepEqual(unchanged,JSON.parse(journalBefore));assert.deepEqual(Object.keys(instagramFollowExclusions),['spymedia_kr']);assert.deepEqual(Object.keys(instagramFollowExclusions.spymedia_kr).sort(),['transient_1','transient_2']);for(const entry of Object.values(instagramFollowExclusions.spymedia_kr)){assert.deepEqual(Object.keys(entry).sort(),['confirmedAt','state','username']);assert.ok(['following','requested'].includes(entry.state));assert.ok(Number.isFinite(Date.parse(entry.confirmedAt)));}assert.deepEqual((await service.candidates.list()).items[0],manual);assert.equal(snsCalls,0);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  assert.ok(requests.filter(r=>r.method!=='GET').every(r=>['/api/admin/login','/api/admin/temporary-search','/api/admin/instagram/follow-exclusions'].includes(r.path)));assert.ok(requests.every(r=>!r.path.includes('합성')&&!r.path.includes(encodeURIComponent('합성'))));
  pass('Auth expiry clears search memory; only minimal confirmed exclusion history persists; existing saved candidate and all other journal fields remain unchanged; zero SNS actions or real external requests occur');
  await fs.writeFile(path.join(output,'results.json'),JSON.stringify({checks,errors,realExternalRequests:external.length,syntheticBraveRequests:providerCalls,snsCalls,persistentWrites:await page.evaluate(()=>window.__persistentWrites),otherJournalFieldsUnchanged:true,onlyMinimalFollowHistoryPersisted:true,fixturesOnly:true,realApiVerified:false},null,2));
}finally{release?.();await browser?.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await fs.rm(dir,{recursive:true,force:true});}
