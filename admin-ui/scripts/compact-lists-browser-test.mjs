import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {randomBytes,randomUUID,scryptSync,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {config} from '../backend/config.cjs';
import {Store} from '../backend/store.cjs';
import {Service} from '../backend/service.cjs';
import {createAdminHandler} from '../server-core.cjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'spymedia-compact-browser-'));
const output=fileURLToPath(new URL('../test-results/compact-lists/',import.meta.url));await fs.mkdir(output,{recursive:true});
const checks=[],errors=[],external=[],writes=[],mediaReads=[],geometry=[];
const ok=message=>{checks.push(message);console.log('PASS '+message);};
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:1100}});
await context.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.__copied=text;}}});});
const page=await context.newPage();
const png=Buffer.from(await page.evaluate(()=>{
  const c=document.createElement('canvas');c.width=640;c.height=360;const g=c.getContext('2d');g.fillStyle='#0b2b49';g.fillRect(0,0,640,360);
  g.fillStyle='#11b5cd';g.fillRect(0,240,640,120);g.fillStyle='#effcff';g.font='bold 40px Arial';g.fillText('SPYMEDIA',45,90);g.font='18px Arial';g.fillText('LOCAL UI TEST',48,125);
  return c.toDataURL('image/png').split(',')[1];
}),'base64');
const settings=config({SNS_DATA_DIR:dir,SNS_STORAGE_PERSISTENCE:'confirmed',SNS_SINGLE_INSTANCE:'confirmed',SNS_PUBLISH_ENABLED:'true'});
const store=new Store(settings);await store.init();
const fileIds=Array.from({length:5},()=>randomUUID()),ids={failed:randomUUID(),succeeded:randomUUID(),prepared:randomUUID(),instagram:randomUUID(),blog:randomUUID(),unknown:randomUUID(),trash:randomUUID()};
const names=['youtube-ffap_MOKHvM.jpg','덕소역4.mp4','경기도.mp4','인스타04-'+'긴촬영파일명'.repeat(20)+'-'+'x'.repeat(120)+'.png','휴지통 보관 사진.png'];
const longTitle='긴 제목 '+ '강변 항공 촬영과 도시 풍경 '.repeat(12)+'<script>window.listUnsafe=true</script>';
const description='길게 작성한 소개글입니다. '+ '본문은 상세를 펼쳤을 때만 표시되어야 합니다. '.repeat(150);
const baseJob=(id,status,channel,title)=>({id,type:'link',channel,key:randomBytes(32).toString('hex'),input:{title,description,tags:['SpyMedia','드론촬영'],youtubeUrl:'https://www.youtube.com/watch?v=ffap_MOKHvM'},mediaIds:[],assets:[],status,publicationAttempted:['succeeded','unknown'].includes(status),createdAt:'2026-10-06T10:00:00.000Z',updatedAt:'2026-10-06T10:05:00.000Z'});
await store.transaction(s=>{
  fileIds.forEach((id,i)=>{s.media[id]={id,name:names[i],kind:[1,2].includes(i)?'video':'image',type:[1,2].includes(i)?'video/mp4':'image/png',size:i===1?Math.round(283.5*1024**2):i===2?213*1024**2:png.length,sha256:createHash('sha256').update(png).digest('hex'),createdAt:new Date(Date.UTC(2026,9,6,11,i)).toISOString(),...(i===4?{trashedAt:'2026-10-06T12:00:00.000Z'}:{})};});
  s.jobs[ids.failed]={...baseJob(ids.failed,'failed','facebook',longTitle),error:'channel_auth_or_permission',errorDetails:{phase:'facebook_identity',httpStatus:401,providerCode:190,providerSubcode:463,providerType:'OAuthException'}};
  s.jobs[ids.succeeded]={...baseJob(ids.succeeded,'succeeded','facebook','완료된 링크 소개'),result:{externalId:'synthetic_post',url:'https://www.facebook.com/synthetic_post'}};
  s.jobs[ids.prepared]=baseJob(ids.prepared,'prepared','facebook','전송 준비된 소개글');
  s.jobs[ids.instagram]={...baseJob(ids.instagram,'failed','instagram','인스타그램 기존 사진 작업'),type:'legacy',mediaIds:[fileIds[0]],assets:[{...s.media[fileIds[0]],original:true}],error:'interrupted'};
  s.jobs[ids.blog]={...baseJob(ids.blog,'prepared','blog','블로그 원고와 참고 이미지'),mediaIds:[fileIds[3]],assets:[{...s.media[fileIds[3]],original:true}],manuscript:'합성 블로그 원고\n'+description};
  s.jobs[ids.unknown]={...baseJob(ids.unknown,'unknown','x','전송 결과 확인이 필요한 이력'),mediaIds:[fileIds[2]],error:'verify_publication'};
  s.jobs[ids.trash]={...baseJob(ids.trash,'succeeded','facebook','휴지통의 완료된 소개글'),result:{externalId:'retained_post',url:'https://www.facebook.com/retained_post'},trashedAt:'2026-10-06T12:00:00.000Z'};
});
for(const id of fileIds)await fs.writeFile(store.file(id),png);
const originalJournal=JSON.stringify(store.state);let publicationCalls=0,diagnosticCalls=0;
const connectors={availability:()=>({facebook:true,x:false,blog:true,instagram:true,youtube:false}),checkFacebookConnection:async()=>{diagnosticCalls++;return {pageId:'1387247911137772',identityVerified:true,publishingEnabled:true};},publish:async()=>{publicationCalls++;throw Error('Publication prohibited');}};
const media={tools:async()=>{throw Error('No conversion permitted');},convert:async()=>{throw Error('No conversion permitted');}};
const service=new Service({settings,store,connectors,media}),salt=randomBytes(16),password=randomBytes(24).toString('hex');
const handler=createAdminHandler({mode:'authenticated',username:'synthetic',passwordHash:salt.toString('hex')+':'+scryptSync(password,salt,64).toString('hex'),secureCookie:false,service});
let emptyTrash=false,emptyJobs=false,protectSelectedFile=false;
const server=http.createServer((req,res)=>{
  if(emptyJobs&&req.method==='GET'&&req.url==='/api/admin/jobs'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({jobs:[]}));return;}
  if(protectSelectedFile&&req.method==='GET'&&req.url.startsWith('/api/admin/catalog?kind=media&bin=active')){
    const u=new URL(req.url,'http://localhost');
    service.catalog.list({kind:'media',bin:'active',offset:Number(u.searchParams.get('offset')),limit:Number(u.searchParams.get('limit'))}).then(data=>{
      for(const item of data.items)if(item.id===fileIds[0])item.canTrash=false;
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(data));
    });return;
  }
  if(emptyTrash&&req.url.startsWith('/api/admin/catalog')&&req.url.includes('bin=trash')){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({items:[],total:0}));return;}
  handler(req,res).then(done=>{if(!done){res.writeHead(404);res.end();}}).catch(e=>{errors.push(e.message);res.end();});
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
page.on('pageerror',e=>errors.push(e.message));
page.on('request',request=>{const p=new URL(request.url()).pathname;if(request.method()==='POST'&&p!=='/api/admin/login')writes.push(p);if(p.startsWith('/api/admin/media/'))mediaReads.push(p);});
await context.route('**/*',route=>{const u=route.request().url();if(u.startsWith(origin+'/')||u.startsWith('blob:'+origin)||u.startsWith('data:'))return route.continue();external.push(u);return route.abort();});
const jobRow=id=>page.locator('.job-card[data-id="'+id+'"]'),fileRow=id=>page.locator('.catalog-row[data-id="'+id+'"]');
const waitCatalog=()=>page.waitForFunction(()=>!document.getElementById('catalog-refresh').disabled);
const tab=async selector=>{await page.click(selector);await waitCatalog();};
async function checkGeometry(selector,width,maxHeight){
  const result=await page.locator(selector).evaluateAll(rows=>rows.map(row=>{
    const r=row.getBoundingClientRect(),check=row.querySelector('.record-select').getBoundingClientRect(),name=row.querySelector('.record-title'),n=name.getBoundingClientRect();
    return {height:r.height,checkboxWidth:check.width,checkboxHeight:check.height,checkboxInset:check.left-r.left,titleWidth:n.width,titleHeight:n.height,titleWhiteSpace:getComputedStyle(name).whiteSpace,expanded:row.querySelector('.record-toggle').getAttribute('aria-expanded')};
  }));
  assert.ok(result.length);for(const r of result){assert.equal(r.expanded,'false');assert.ok(r.height<=maxHeight,JSON.stringify(r));assert.equal(r.checkboxWidth,16);assert.equal(r.checkboxHeight,16);assert.ok(r.checkboxInset<=14);assert.ok(r.titleWidth>=90,JSON.stringify(r));assert.ok(r.titleHeight<=20);assert.equal(r.titleWhiteSpace,'nowrap');}
  geometry.push({selector,width,maxHeightObserved:Math.max(...result.map(r=>r.height)),minimumTitleWidth:Math.min(...result.map(r=>r.titleWidth)),checkboxWidth:16});
}
try{
  await page.goto(origin+'/admin');await page.waitForURL(origin+'/admin/login');await page.fill('#login-id','synthetic');await page.fill('#login-password',password);await page.click('#login-submit');await page.waitForURL(origin+'/admin');
  await page.waitForFunction(()=>document.querySelectorAll('.job-card').length===6&&document.querySelectorAll('.catalog-row').length===4);
  assert.equal(await page.locator('.record-details:visible').count(),0);assert.equal(await page.locator('.job-card img').count(),0);assert.equal(mediaReads.length,0);
  await checkGeometry('.job-card',1440,60);await checkGeometry('.catalog-row',1440,60);
  for(const status of ['failed','succeeded','prepared','unknown'])assert.ok(await page.locator('.job-card[data-status="'+status+'"]').count());
  ok('Every success, failure and prepared job starts as one short row; all long bodies, diagnostics and images are collapsed');
  assert.equal(await fileRow(fileIds[2]).locator('.record-select').isDisabled(),true);
  const longName=fileRow(fileIds[3]);assert.equal(await longName.locator('.record-title').textContent(),names[3]);assert.equal(await longName.locator('.record-title').getAttribute('title'),names[3]);
  await longName.locator('.record-toggle').click();assert.match(await longName.locator('.record-details').textContent(),/원본 다운로드/);await longName.locator('.record-toggle').click();
  for(const i of [1,2]){await fileRow(fileIds[i]).locator('.record-toggle').click();assert.match(await fileRow(fileIds[i]).locator('.record-details').textContent(),i===1?/283\.5 MB/:/213\.0 MB/);await fileRow(fileIds[i]).locator('.record-toggle').click();}
  ok('Fixed 16px checkboxes leave horizontal file-name space; long Korean/English names and large video metadata do not create blank giant rows');
  const prepared=jobRow(ids.prepared),failed=jobRow(ids.failed);
  await prepared.locator('.record-select').check();assert.equal(await page.locator('#start-server').isEnabled(),true);
  await failed.locator('.record-toggle').focus();await failed.locator('.record-toggle').press('Enter');
  assert.equal(await failed.locator('.record-toggle').getAttribute('aria-expanded'),'true');assert.equal(await failed.locator('.record-details').isVisible(),true);
  assert.match(await failed.locator('.record-details').textContent(),/HTTP 401.*Meta code 190.*subcode 463/);
  assert.equal(await failed.locator('.record-details p').filter({hasText:description}).count(),1);
  assert.equal(await failed.locator('button',{hasText:'실패 작업 다시 준비'}).count(),1);
  assert.equal(await prepared.locator('.record-select').isChecked(),true);
  await failed.locator('.record-toggle').press('Space');assert.equal(await failed.locator('.record-details').isHidden(),true);
  page.once('dialog',d=>d.dismiss());await page.click('#start-server');assert.equal(publicationCalls,0);assert.deepEqual(writes,[]);
  ok('Keyboard disclosure shows full text and safe error codes; disclosure never selects a job, and cancelled sending causes no write');
  const blog=jobRow(ids.blog);assert.equal(await blog.locator('img').count(),0);await blog.locator('.record-toggle').click();await blog.locator('img').waitFor();
  await page.waitForFunction(()=>document.querySelector('.job-card[data-job-channel=blog] img')?.naturalWidth===640);
  assert.equal(await blog.locator('a',{hasText:'원본 1 다운로드'}).count(),1);await blog.locator('button',{hasText:'원고 복사'}).click();assert.match(await page.evaluate(()=>window.__copied),/합성 블로그 원고/);
  const href=await blog.locator('a',{hasText:'원본 1 다운로드'}).getAttribute('href'),download=await context.request.get(origin+href);
  assert.equal(download.status(),200);assert.deepEqual(await download.body(),png);
  await blog.locator('.record-toggle').click();assert.ok(mediaReads.length>=1);
  ok('Photos load only after expansion; blog copy and original download still work without a posting request');
  const legacy=jobRow(ids.instagram);assert.equal(await legacy.locator('.record-select').isDisabled(),true);await legacy.locator('.record-toggle').click();
  assert.match(await legacy.locator('.record-details').textContent(),/이력 조회만/);assert.equal(await legacy.getByRole('button',{name:'실패 작업 다시 준비'}).count(),0);await legacy.locator('.record-toggle').click();
  ok('Legacy images and historical errors remain readable while legacy send/retry restrictions stay intact');
  await page.locator('#server-workflow').screenshot({path:path.join(output,'compact-jobs-desktop.png')});await page.locator('#content-library').screenshot({path:path.join(output,'compact-files-desktop.png')});
  for(const width of [390,360]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await checkGeometry('.job-card',width,100);await checkGeometry('.catalog-row',width,100);}
  await page.locator('#server-workflow').screenshot({path:path.join(output,'compact-jobs-mobile.png')});await page.locator('#content-library').screenshot({path:path.join(output,'compact-files-mobile.png')});
  await page.setViewportSize({width:1440,height:1100});ok('Desktop and 360/390px mobile rows stay compact, with one-line names, readable dates/status and no horizontal overflow');
  await fileRow(fileIds[0]).locator('.record-select').check();await fileRow(fileIds[0]).locator('.record-toggle').click();await page.click('#catalog-refresh');await waitCatalog();
  assert.equal(await fileRow(fileIds[0]).locator('.record-select').isChecked(),true);assert.equal(await fileRow(fileIds[0]).locator('.record-details').isVisible(),true);
  assert.equal(await prepared.locator('.record-select').isChecked(),true);await page.click('#facebook-check');await page.waitForFunction(()=>document.getElementById('facebook-feedback').textContent.includes('Page 인증 확인됨'));
  assert.equal(diagnosticCalls,1);assert.equal(await prepared.locator('.record-select').isChecked(),true);assert.equal(await fileRow(fileIds[0]).locator('.record-details').isVisible(),true);
  assert.match(await page.locator('#facebook-feedback').textContent(),/글쓰기 권한은 아직 검증하지/);assert.deepEqual(writes,['/api/admin/facebook/check']);
  ok('Refresh and Facebook diagnosis preserve disclosure and selection; the existing authenticated diagnosis remains available');
  protectSelectedFile=true;await page.click('#catalog-refresh');await waitCatalog();
  assert.equal(await fileRow(fileIds[0]).locator('.record-select').isDisabled(),true);assert.equal(await fileRow(fileIds[0]).locator('.record-select').isChecked(),false);assert.equal(await page.locator('#catalog-change').isDisabled(),true);
  protectSelectedFile=false;ok('Refreshing a newly protected original removes its stale selection and disables movement without changing storage');
  await tab('[data-catalog-bin=trash]');await fileRow(fileIds[4]).waitFor();await checkGeometry('.catalog-row',1440,60);await fileRow(fileIds[4]).locator('.record-toggle').click();
  assert.match(await fileRow(fileIds[4]).locator('.record-details').textContent(),/휴지통 이동/);assert.equal(await fileRow(fileIds[4]).getByRole('link',{name:'원본 다운로드'}).count(),1);assert.equal(await page.locator('#catalog-change').textContent(),'선택 항목 복원');
  await page.locator('#content-library').screenshot({path:path.join(output,'compact-trash-files-desktop.png')});
  await tab('[data-catalog-kind=jobs]');await fileRow(ids.trash).waitFor();assert.equal(await fileRow(ids.trash).locator('.record-state').textContent(),'완료');await fileRow(ids.trash).locator('.record-toggle').click();
  assert.equal(await fileRow(ids.trash).getByRole('link',{name:'채널에서 확인'}).getAttribute('href'),'https://www.facebook.com/retained_post');await page.locator('#content-library').screenshot({path:path.join(output,'compact-trash-jobs-desktop.png')});
  ok('File trash and successful-job trash use the same rows and retain restore/download/publication-history access');
  emptyTrash=true;await page.click('#catalog-refresh');await waitCatalog();assert.match(await page.locator('.record-empty').last().textContent(),/휴지통이 비어/);assert.equal(await page.locator('#catalog-change').isDisabled(),true);assert.equal(await page.locator('#catalog-next').isDisabled(),true);
  emptyJobs=true;await page.locator('#server-jobs .record-empty').waitFor();assert.match(await page.locator('#server-jobs .record-empty').textContent(),/준비한 작업이 없습니다/);assert.equal(await page.locator('#start-server').isDisabled(),true);
  ok('An empty refreshed job list clears stale send selection and presents a short empty state');
  assert.equal(await page.evaluate(()=>window.listUnsafe),undefined);assert.equal(await page.locator('.record-item script').count(),0);assert.equal(await page.locator('.record-item img[onerror]').count(),0);
  assert.equal(JSON.stringify(store.state),originalJournal);assert.equal(publicationCalls,0);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  ok('Empty trash and untrusted long text remain safe; fixtures, originals, results and duplicate keys are unchanged with zero real publications');
  await fs.writeFile(path.join(output,'verification.json'),JSON.stringify({checks,errors,external,writes,geometry,baseCommit:'b62a3b642dbe6d9822c673bcd62bd041e4bc2fa1',mockOnly:true,userBrowserSessionUsed:false,realPublications:0,fixturePublicationCalls:publicationCalls,fixtureJournalUnchanged:true},null,2));
}finally{
  await browser.close();await new Promise(r=>server.close(r));assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));await fs.rm(dir,{recursive:true,force:true});
}
