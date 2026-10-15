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
import {REGION_OPTIONS,CURRENT_PROVINCES,LEGACY_AREAS} from '../public/candidate-regions.js';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'spymedia-candidates-browser-'));
const output=fileURLToPath(new URL('../test-results/candidates/',import.meta.url));await fs.mkdir(output,{recursive:true});
const checks=[],errors=[],external=[],opened=[],writes=[],regionQueries=[];const pass=text=>{checks.push(text);console.log('PASS '+text);};
let providerCalls=0,mediaCalls=0,browser,server,failMutation=null,failRead=false;
const forbidden=async()=>{providerCalls++;throw Error('External SNS calls prohibited');};
const settings=config({SNS_DATA_DIR:dir,SNS_STORAGE_PERSISTENCE:'confirmed',SNS_SINGLE_INSTANCE:'confirmed',SNS_PUBLISH_ENABLED:'false'}),store=new Store(settings);
const service=new Service({settings,store,connectors:{availability:()=>({blog:true}),publish:forbidden,checkInstagramConnection:forbidden,checkFacebookConnection:forbidden,checkXConnection:forbidden},media:{tools:async()=>{mediaCalls++;throw Error('No media tools');},convert:async()=>{mediaCalls++;throw Error('No conversion');}}});
const salt=randomBytes(16),password=randomBytes(24).toString('hex'),handler=createAdminHandler({mode:'authenticated',username:'fixture',passwordHash:salt.toString('hex')+':'+scryptSync(password,salt,64).toString('hex'),secureCookie:false,service});
server=http.createServer((req,res)=>{if(!['GET','HEAD'].includes(req.method))writes.push({path:new URL(req.url,'http://localhost').pathname,method:req.method});handler(req,res).then(done=>{if(!done){res.writeHead(404);res.end();}}).catch(e=>{errors.push(e.message);res.writeHead(500);res.end();});});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
try{
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1100}});
  await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.origin===origin){
      if(req.method()==='GET'&&url.pathname==='/api/admin/candidates')regionQueries.push(url.searchParams.get('region'));
      if(req.method()==='PATCH'&&url.pathname.startsWith('/api/admin/candidates/')&&failMutation)return route.fulfill({status:failMutation,contentType:'application/json',body:JSON.stringify({error:failMutation===401?'authentication_required':'storage_unavailable'})});
      if(req.method()==='GET'&&url.pathname==='/api/admin/candidates'&&failRead)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'storage_unavailable'})});
      return route.continue();
    }
    if(['https://www.instagram.com','https://www.google.com'].includes(url.origin)){
      opened.push({url:url.href,headers:await req.allHeaders()});return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Local placeholder: no external request</title>'});
    }
    if(req.url().startsWith('blob:')||req.url().startsWith('data:'))return route.continue();
    external.push(req.url());return route.abort();
  });
  context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  const page=await context.newPage();let accept=true;page.on('dialog',dialog=>accept?dialog.accept():dialog.dismiss());
  const idle=()=>page.waitForFunction(()=>!document.getElementById('candidates-refresh').disabled);
  const feedback=()=>page.locator('#candidates-feedback').textContent();
  const row=name=>page.locator('.candidate-card').filter({hasText:name});
  const platform=async value=>{await page.locator('[data-candidate-platform="'+value+'"]').click();await idle();};
  const filter=async({q='',industry='',region='',status='all'}={})=>{
    await page.locator('#candidates-query').fill(q);await page.locator('#candidates-industry').fill(industry);await page.locator('#candidates-region').fill(region);await page.locator('#candidates-status').selectOption(status);
    await page.locator('#candidates-filter button').click();await idle();
  };
  const create=async({sns='instagram',name,url,industry='공공기관·지자체',region='인천시',reason='합성 추천 이유',note='합성 메모'})=>{
    await page.locator('#candidate-editor').evaluate(el=>el.open=true);
    for(const [key,value]of Object.entries({platform:sns,accountName:name,profileUrl:url,industry,region,reason,note})){
      const field=page.locator('#candidate-'+key);if(key==='platform')await field.selectOption(value);else await field.fill(value);
    }
    await page.locator('#candidate-save').click();await idle();assert.match(await feedback(),/저장했습니다/);
  };
  await page.goto(origin+'/admin/login');await page.locator('#login-id').fill('fixture');await page.locator('#login-password').fill(password);await page.locator('#login-submit').click();await page.waitForURL(origin+'/admin');await idle();
  assert.equal(await page.locator('.candidate-card').count(),0);assert.match(await page.locator('#candidates-list').textContent(),/후보가 없습니다/);assert.equal(Object.keys(store.state.candidates||{}).length,0);assert.equal(await page.locator('#candidates-pages button').count(),0);assert.match(await page.locator('#candidates-range').textContent(),/0\/0페이지/);assert.equal(await page.locator('#candidates-prev').isDisabled(),true);assert.equal(await page.locator('#candidates-next').isDisabled(),true);
  assert.match(await page.locator('.candidate-notice').textContent(),/자동 확인하지 않습니다/);
  assert.deepEqual(await page.locator('#candidate-industries option').evaluateAll(items=>items.map(i=>i.value)),['공공기관·지자체','부동산','영상제작','건설','행사기획·운영','기타']);
  assert.deepEqual(await page.locator('#candidate-regions option').evaluateAll(items=>items.map(i=>i.value)),REGION_OPTIONS);
  for(const area of [...CURRENT_PROVINCES,...LEGACY_AREAS])assert.ok(REGION_OPTIONS.includes(area.name));
  pass('Empty default, custom industries, nationwide, all current/legacy province choices, six area groups and existing localities');
  await create({name:'합성 여행사 <script>window.injected=1</script>',url:'https://instagram.com/fixture_agency/?igsh=synthetic',industry:'여행사',note:'여행사 & 드론 + #제주'});
  assert.equal(await page.locator('#candidates-pages button').count(),1);assert.equal(await page.locator('#candidates-pages [aria-current=page]').textContent(),'1');assert.equal(await page.locator('#candidates-next').isDisabled(),true);
  await create({name:'합성 영흥도 기관',url:'https://www.instagram.com/fixture_island/',region:'영흥도'});
  await create({name:'합성 시흥 건설업체',url:'https://www.instagram.com/fixture_build/',region:'시흥시',industry:'건설'});
  assert.equal(await page.locator('.candidate-card').count(),3);assert.equal(await page.evaluate(()=>window.injected),undefined);assert.equal(await page.locator('.candidate-card script').count(),0);
  await page.getByRole('checkbox',{name:'합성 영흥도 기관 선택',exact:true}).check();await idle();assert.equal(await page.locator('#candidates-all').evaluate(el=>el.indeterminate),true);
  await page.locator('#candidates-all').check();await idle();assert.equal((await service.candidates.list()).selectedCount,3);
  await page.reload();await idle();assert.equal(await page.locator('#candidates-all').isChecked(),true);
  await page.locator('#candidates-exclude').click();await idle();assert.equal((await service.candidates.list({status:'excluded'})).total,3);
  accept=false;await page.locator('#candidates-done').click();assert.equal((await service.candidates.list({status:'done'})).total,0);
  accept=true;await page.locator('#candidates-done').click();await idle();assert.equal((await service.candidates.list({status:'done'})).total,3);
  assert.ok((await service.candidates.list()).items.every(i=>i.manualDoneAt));
  await page.locator('#candidates-pending').click();await idle();assert.ok((await service.candidates.list()).items.every(i=>i.manualDoneAt===null));
  await page.locator('#candidates-all').uncheck();await idle();pass('Individual/all selection persists through reload; excluded, manual completed and restored statuses remain independent of checkboxes');
  await filter({industry:'여행사',region:'인천',q:'드론 + #제주'});assert.equal(await page.locator('.candidate-card').count(),1);
  await page.locator('#candidates-all').check();await idle();assert.equal((await service.candidates.list()).selectedCount,1);
  await page.locator('#candidates-exclude').click();await idle();assert.equal((await service.candidates.list({status:'pending'})).total,2);
  pass('Custom industry, keyword and partial region combine with SNS; select-all affects only displayed filtered candidates');
  const popupPending=page.waitForEvent('popup');await row('합성 여행사').getByRole('link').click();const popup=await popupPending;await popup.waitForLoadState();assert.equal(popup.url(),'https://www.instagram.com/fixture_agency/');assert.equal(await popup.evaluate(()=>window.opener),null);await popup.close();
  await page.locator('#candidates-query').fill('여행사 & 드론 + #제주? / @');await page.locator('#candidates-region').fill('인천 영흥도');
  const searchPending=page.waitForEvent('popup');await page.locator('#candidates-external').click();const search=await searchPending;await search.waitForLoadState();const searchUrl=new URL(search.url());
  assert.equal(searchUrl.origin,'https://www.google.com');assert.equal(searchUrl.searchParams.get('q'),'여행사 & 드론 + #제주? / @ 인천 영흥도 site:instagram.com');assert.equal(searchUrl.hash,'');assert.equal(await search.evaluate(()=>window.opener),null);await search.close();
  assert.equal(opened.length,2);assert.ok(opened.every(item=>!item.headers.referer&&!item.headers.cookie));
  pass('Profile and encoded external search open in isolated tabs without cookies/referrer; external results are never collected');
  await filter();await row('합성 여행사').getByRole('button',{name:'정보·메모 수정'}).click();await page.locator('#candidate-note').fill('사용자 메모 수정');await page.locator('#candidate-save').click();await idle();assert.equal((await service.candidates.list({q:'사용자 메모 수정'})).total,1);
  await row('합성 여행사').getByRole('button',{name:'정보·메모 수정'}).click();await page.locator('#candidate-note').fill('충돌 때 보존할 편집');
  const target=(await service.candidates.list({q:'사용자 메모 수정'})).items[0];await service.candidates.update(target.id,{revision:target.revision,note:'다른 세션의 변경'});
  await page.locator('#candidate-save').click();await idle();assert.match(await feedback(),/다른 화면/);assert.equal(await page.locator('#candidate-note').inputValue(),'충돌 때 보존할 편집');
  await page.locator('#candidate-cancel').click();await page.locator('#candidates-refresh').click();await idle();
  failMutation=503;await row('합성 영흥도').getByRole('checkbox').check();await idle();assert.match(await feedback(),/저장소/);assert.equal(await row('합성 영흥도').getByRole('checkbox').isChecked(),false);failMutation=null;
  pass('Memo updates save; concurrent edits conflict without losing the draft; failed selection saves restore the persisted checkbox');
  // Duplicate input stays available for correction.
  await page.locator('#candidate-editor').evaluate(el=>el.open=true);await page.locator('#candidate-accountName').fill('중복 입력 합성');await page.locator('#candidate-profileUrl').fill('https://instagram.com/FIXTURE_AGENCY/');await page.locator('#candidate-save').click();await idle();assert.match(await feedback(),/이미 등록/);assert.equal(await page.locator('#candidate-accountName').inputValue(),'중복 입력 합성');await page.locator('#candidate-cancel').click();
  for(const [sns,url]of [['facebook','https://facebook.com/fixturepublic'],['x','https://twitter.com/fixture_public'],['blog','https://m.blog.naver.com/fixture_public']]){
    await create({sns,name:'합성 '+sns+' 기관·업체',url,industry:'여행사',region:'시흥'});assert.equal(await page.locator('.candidate-card').count(),1);
    await filter({industry:'여행사',region:'인천'});assert.equal(await page.locator('.candidate-card').count(),0);await filter();
  }
  await platform('instagram');
  failRead=true;await platform('x');assert.equal(await page.locator('.candidate-card').count(),0);assert.equal(await page.locator('#candidates-all').isDisabled(),true);failRead=false;await page.locator('#candidates-refresh').click();await idle();assert.equal(await page.locator('.candidate-card').count(),1);
  await platform('instagram');
  pass('Four SNS lists, canonical duplicate rejection and empty filter/load-error states preserve other platforms');
  const seedPage=async i=>service.candidates.create({platform:'instagram',accountName:'페이지 fixture '+i,profileUrl:'https://www.instagram.com/page_fixture_'+i+'/',industry:'기타',region:'합성 지역'});
  for(let i=0;i<18;i++){
    await seedPage(i);
    if([6,7,16,17].includes(i)){
      const total=i+4,pages=Math.ceil(total/10);await page.locator('#candidates-refresh').click();await idle();
      assert.equal(await page.locator('.candidate-card').count(),10);assert.equal(await page.locator('#candidates-pages button').count(),pages);assert.match(await page.locator('#candidates-range').textContent(),new RegExp('1/'+pages+'페이지'));
      if(pages>1){await page.getByRole('button',{name:pages+'페이지',exact:true}).click();await idle();assert.equal(await page.locator('.candidate-card').count(),((total-1)%10)+1);assert.equal(await page.locator('#candidates-next').isDisabled(),true);await page.getByRole('button',{name:'1페이지',exact:true}).click();await idle();}
    }
  }
  const selectedCard=page.locator('.candidate-card').first(),selectedId=await selectedCard.getAttribute('data-candidate-id');await selectedCard.getByRole('checkbox').check();await idle();
  await page.getByRole('button',{name:'2페이지',exact:true}).click();await idle();await page.getByRole('button',{name:'1페이지',exact:true}).click();await idle();assert.equal(await page.locator('[data-candidate-id="'+selectedId+'"] input[type=checkbox]').isChecked(),true);
  await page.reload();await idle();assert.equal(await page.locator('[data-candidate-id="'+selectedId+'"] input[type=checkbox]').isChecked(),true);
  for(let i=18;i<77;i++)await seedPage(i);
  await page.locator('#candidates-refresh').click();await idle();await page.getByRole('button',{name:'4페이지',exact:true}).click();await idle();assert.ok((await page.locator('#candidates-pages').textContent()).includes('…'));assert.ok(await page.locator('#candidates-pages button').count()<=7);
  for(const width of [390,360]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.locator('.candidate-pages').screenshot({path:path.join(output,'page-numbers-'+width+'.png')});}
  await page.getByRole('button',{name:'8페이지',exact:true}).click();await idle();assert.equal(await page.locator('#candidates-next').isDisabled(),true);
  for(let i=0;i<21;i++)await service.candidates.create({platform:'instagram',accountName:'마지막 페이지 '+i,profileUrl:'https://instagram.com/last_page_'+i+'/',region:'범위 테스트'});
  await filter({region:'범위 테스트',status:'pending'});await page.getByRole('button',{name:'3페이지',exact:true}).click();await idle();await page.locator('#candidates-all').check();await idle();await page.locator('#candidates-exclude').click();await idle();assert.equal(await page.locator('.candidate-card').count(),10);assert.equal(await page.locator('#candidates-pages [aria-current=page]').textContent(),'2');assert.match(await page.locator('#candidates-range').textContent(),/2\/2페이지/);
  await filter({region:'영흥도'});assert.equal(await page.locator('#candidates-pages [aria-current=page]').textContent(),'1');assert.match(await page.locator('#candidates-range').textContent(),/1\/1페이지/);
  await filter({q:'없는 합성 검색어'});assert.equal(await page.locator('#candidates-pages button').count(),0);assert.equal(await page.locator('#candidates-prev').isDisabled(),true);assert.equal(await page.locator('#candidates-next').isDisabled(),true);
  await filter({region:'영흥도'});
  for(const width of [390,360]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.locator('#sns-candidates').screenshot({path:path.join(output,'mobile-'+width+'.png')});}
  await page.setViewportSize({width:1440,height:1100});await page.locator('#sns-candidates').screenshot({path:path.join(output,'desktop.png')});
  pass('0/1/10/11/20/21 item boundaries, ten-row pages, numeric/previous/next controls, persisted checks, filter reset and 360/390px ellipses fit');
  for(const [i,region]of ['전라북도 전주시','충남 천안시','대전광역시','','제주도'].entries())await service.candidates.create({platform:'instagram',accountName:'지역 호환 합성 '+i,profileUrl:'https://www.instagram.com/region_check_'+i+'/',industry:'여행사',region});
  await filter({region:'전국',industry:'여행사'});assert.equal(await page.locator('.candidate-card').count(),6);assert.ok(await row('지역 호환 합성 3').count());assert.equal(regionQueries.at(-1),'');
  await page.locator('#candidates-query').fill('여행사 & 드론 + #지역');
  const nationwideUrl=new URL(await page.locator('#candidates-external').getAttribute('href'));assert.equal(nationwideUrl.searchParams.get('q'),'여행사 & 드론 + #지역 site:instagram.com');
  await filter({region:'충청도',industry:'여행사'});assert.equal(await page.locator('.candidate-card').count(),2);assert.equal(regionQueries.at(-1),'충청도');
  await page.locator('#candidates-query').fill('여행사');const groupUrl=new URL(await page.locator('#candidates-external').getAttribute('href'));assert.match(groupUrl.searchParams.get('q'),/충북 OR 충남 OR 대전 OR 세종/);
  await filter({region:'전북특별자치도',q:'전라북도'});assert.equal(await page.locator('.candidate-card').count(),1);assert.ok(await row('지역 호환 합성 0').count());
  await row('지역 호환 합성 0').getByRole('button',{name:'정보·메모 수정'}).click();assert.equal(await page.locator('#candidate-region').inputValue(),'전라북도 전주시');await page.locator('#candidate-cancel').click();
  await filter({region:'제주특별자치도'});assert.equal(await page.locator('.candidate-card').count(),1);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.locator('#sns-candidates').screenshot({path:path.join(output,'regions-mobile-390.png')});
  await page.reload();await idle();await filter({region:'전라도'});assert.equal(await page.locator('.candidate-card').count(),1);await filter({region:'영흥도'});
  pass('Nationwide sends no region restriction; regional groups, official/old names, unknown regions and external search terms work without rewriting saved text');
  await row('합성 영흥도').getByRole('button',{name:'정보·메모 수정'}).click();await page.locator('#candidate-note').fill('만료 시 보존할 메모');failMutation=401;await page.locator('#candidate-save').click();await page.waitForFunction(()=>!document.getElementById('candidates-login').hidden);
  assert.equal(await page.locator('#candidate-note').inputValue(),'만료 시 보존할 메모');assert.equal(await page.locator('#candidate-save').isDisabled(),true);assert.equal(await page.locator('#prepare-server').isDisabled(),true);failMutation=null;
  pass('Authentication expiry disables writes, preserves the draft and offers re-login');
  assert.equal(providerCalls,0);assert.equal(mediaCalls,0);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  assert.ok(writes.every(item=>item.path==='/api/admin/login'||item.path.startsWith('/api/admin/candidates')));
  pass('Zero SNS provider calls, zero scraping/media tool calls, zero posting API writes and zero real external requests');
  await fs.writeFile(path.join(output,'results.json'),JSON.stringify({checks,errors,external,providerCalls,mediaCalls,profileAndSearchOpens:opened.map(item=>item.url),postingWrites:writes.filter(item=>item.path.includes('/jobs')),fixtureOnly:true},null,2));
}finally{
  if(browser)await browser.close();if(server)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
  await fs.rm(dir,{recursive:true,force:true});
}
