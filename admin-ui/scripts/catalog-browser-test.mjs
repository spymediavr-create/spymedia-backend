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
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'spymedia-catalog-browser-'));
const output=fileURLToPath(new URL('../test-results/catalog/',import.meta.url));
await fs.mkdir(output,{recursive:true});
const checks=[],errors=[],external=[];
const ok=message=>{checks.push(message);console.log('PASS '+message);};
const settings=config({SNS_DATA_DIR:dir,SNS_STORAGE_PERSISTENCE:'confirmed',SNS_SINGLE_INSTANCE:'confirmed',SNS_PUBLISH_ENABLED:'true'});
const store=new Store(settings);await store.init();
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPucAAAAASUVORK5CYII=','base64');
const hash=value=>createHash('sha256').update(value).digest('hex');
const storedId=randomUUID(),protectedId=randomUUID(),failedId=randomUUID(),publishedId=randomUUID(),oldId=randomUUID();
const source=(id,name,time='2026-10-05T10:00:00.000Z')=>({id,name,kind:'image',type:'image/png',size:png.length,sha256:hash(png),createdAt:time});
const job=(id,mediaId,status,channel='facebook',createdAt='2026-10-05T10:00:00.000Z')=>({id,mediaIds:[mediaId],status,channel,key:randomBytes(32).toString('hex'),input:{title:'Synthetic '+id,description:'Local fixture only',tags:[]},publicationAttempted:status==='succeeded'||status==='unknown',assets:[],createdAt,updatedAt:createdAt,...(status==='succeeded'?{result:{externalId:'mock-published',url:'https://www.facebook.com/mock-published'}}:{})});
await store.transaction(s=>{
  s.media[storedId]=source(storedId,'stored-content.png');s.media[protectedId]=source(protectedId,'protected-content.png','2026-10-05T11:00:00.000Z');
  for(let i=0;i<25;i++){const id=randomUUID();s.media[id]=source(id,i===1?'long-name-'+'a'.repeat(160)+'.png':'extra-'+i+'.png','2026-10-04T10:00:00.000Z');}
  s.jobs[failedId]={...job(failedId,storedId,'failed','instagram','2026-10-05T15:00:00.000Z'),error:'interrupted'};
  s.jobs[publishedId]=job(publishedId,storedId,'succeeded');
  const unknown=randomUUID();s.jobs[unknown]=job(unknown,protectedId,'unknown','facebook','2026-10-05T14:00:00.000Z');
  s.jobs[oldId]=job(oldId,storedId,'succeeded','facebook','2026-09-01T10:00:00.000Z');s.jobs[oldId].input.title='Oldest retained record';
  for(let i=0;i<110;i++){const id=randomUUID();s.jobs[id]=job(id,storedId,'succeeded','facebook',new Date(Date.UTC(2026,9,3,0,i)).toISOString());}
});
for(const id of Object.keys(store.state.media))await fs.writeFile(store.file(id),png);
let publications=0;
const connectors={availability:()=>({instagram:true,facebook:true,blog:true,x:true,youtube:true}),publish:async()=>{publications++;throw Error('External publication prohibited in this test');}};
const media={tools:async()=>true,convert:async()=>{throw Error('Unexpected conversion');}};
let currentService=new Service({settings,store,connectors,media});
const salt=randomBytes(16),password=randomBytes(32).toString('hex');
const options={mode:'authenticated',username:'synthetic',passwordHash:salt.toString('hex')+':'+scryptSync(password,salt,64).toString('hex'),secureCookie:false};
let handler=createAdminHandler({...options,service:currentService}),failCatalog=false;
const server=http.createServer((req,res)=>{
  if(failCatalog&&req.url.startsWith('/api/admin/catalog')){res.writeHead(503,{'Content-Type':'text/html'});res.end('<html>synthetic outage</html>');return;}
  handler(req,res).then(done=>{if(!done){res.writeHead(404);res.end();}}).catch(e=>{errors.push(e.message);res.end();});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1440,height:1100}});
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',route=>{const u=route.request().url();if(u.startsWith(origin+'/')||u.startsWith('blob:'+origin)||u.startsWith('data:'))return route.continue();external.push(u);return route.abort();});
const row=id=>page.locator('.catalog-row[data-id="'+id+'"]');
const login=async()=>{await page.fill('#login-id','synthetic');await page.fill('#login-password',password);await page.click('#login-submit');await page.waitForURL(origin+'/admin');await page.waitForFunction(()=>document.querySelectorAll('.catalog-row').length===20);};
const tab=async(selector)=>{await page.click(selector);await page.waitForFunction(()=>!document.getElementById('catalog-refresh').disabled);};
const change=async()=>{await page.click('#catalog-change');await page.waitForFunction(()=>!document.getElementById('catalog-refresh').disabled);};
try {
  await page.goto(origin+'/admin');await page.waitForURL(origin+'/admin/login');await login();
  assert.match(await page.locator('#detail-status').textContent(),/서버 설정 준비/);assert.doesNotMatch(await page.locator('#detail-status').textContent(),/실패/);
  assert.match(await page.locator('#detail-job-status').textContent(),/최근 작업: 실패/);
  assert.match(await page.locator('.job-card').filter({has:page.locator('h3',{hasText:'Synthetic '+failedId})}).textContent(),/오류 코드: interrupted.*준비된 파일 0개/s);
  assert.equal(await page.getByRole('tab').count(),5);ok('Connection configuration stays separate from recent failure; safe error code, asset count and dates are visible');
  assert.match(await page.locator('#catalog-range').textContent(),/27개/);
  assert.equal(await row(protectedId).locator('input').isDisabled(),true);
  await row(storedId).locator('input').check();page.once('dialog',d=>d.dismiss());await page.click('#catalog-change');
  assert.equal(store.state.media[storedId].trashedAt,undefined);ok('Protected originals cannot be selected and cancellation changes no stored content');
  const key=store.state.jobs[publishedId].key,result=structuredClone(store.state.jobs[publishedId].result);
  page.once('dialog',async d=>{assert.match(d.message(),/SNS에 게시된 콘텐츠는 삭제되지 않습니다/);await d.accept();});await change();
  assert.ok(store.state.media[storedId].trashedAt);assert.equal(await row(storedId).count(),0);
  assert.equal(hash(await fs.readFile(store.file(storedId))),hash(png));assert.equal(store.state.jobs[publishedId].key,key);assert.deepEqual(store.state.jobs[publishedId].result,result);
  await tab('[data-catalog-bin=trash]');await row(storedId).waitFor();ok('Moving to trash hides originals but preserves bytes, publication history and duplicate keys');
  await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.catalog-row').length===20);await tab('[data-catalog-bin=trash]');await row(storedId).waitFor();
  await row(storedId).locator('input').check();await change();assert.equal(store.state.media[storedId].trashedAt,null);assert.equal(publications,0);
  await tab('[data-catalog-bin=active]');await row(storedId).waitFor();ok('Reload retains trash, and restoration returns the original without any automatic publication');
  failCatalog=true;await page.click('#catalog-refresh');await page.waitForFunction(()=>!document.getElementById('catalog-refresh').disabled);
  assert.match(await page.locator('#catalog-feedback').textContent(),/서버 응답/);assert.equal(await row(storedId).count(),1);failCatalog=false;await page.click('#catalog-refresh');await page.waitForFunction(()=>!document.getElementById('catalog-refresh').disabled);
  ok('A non-JSON server outage gives a server message and retains the visible list');
  await tab('[data-catalog-kind=jobs]');assert.match(await page.locator('#catalog-range').textContent(),/114개/);
  while(await page.locator('#catalog-next').isEnabled()){await page.click('#catalog-next');await page.waitForFunction(()=>!document.getElementById('catalog-refresh').disabled);}
  await row(oldId).waitFor();ok('Pagination reaches older history beyond the recent 100 jobs');
  await row(oldId).locator('input').check();page.once('dialog',d=>d.accept());await change();
  await tab('[data-catalog-bin=trash]');await row(oldId).waitFor();assert.deepEqual(store.state.jobs[oldId].result,{externalId:'mock-published',url:'https://www.facebook.com/mock-published'});
  await row(oldId).locator('input').check();await change();ok('Successful job history can be hidden and restored while preserving its channel result');
  await tab('[data-catalog-kind=media]');await tab('[data-catalog-bin=active]');
  for(const width of [390,360]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  await page.screenshot({path:path.join(output,'catalog-mobile.png'),fullPage:true});await page.setViewportSize({width:1440,height:1100});
  await page.screenshot({path:path.join(output,'catalog-desktop.png'),fullPage:true});ok('360px and 390px layouts wrap file names and retain all five preview tabs');
  const restartedStore=new Store(settings);currentService=new Service({settings,store:restartedStore,connectors,media});handler=createAdminHandler({...options,service:currentService});
  await page.click('#catalog-refresh');await page.waitForFunction(()=>!document.querySelector('.session-notice').hidden);
  assert.equal(await page.locator('#prepare-server').isDisabled(),true);assert.equal(await page.locator('#start-server').isDisabled(),true);assert.equal(await page.locator('#catalog-change').isDisabled(),true);
  assert.ok(await page.locator('.catalog-row').count());assert.match(await page.locator('.session-notice').textContent(),/서버 재시작이나 로그인 제한 시간/);
  await page.locator('.session-notice a').click();await page.waitForURL(origin+'/admin/login?reason=session_expired');
  assert.match(await page.locator('#login-feedback').textContent(),/로그인이 만료/);await login();await row(storedId).waitFor();
  assert.equal((await restartedStore.job(publishedId)).key,key);assert.deepEqual((await restartedStore.job(publishedId)).result,result);
  ok('A real handler restart expires only the synthetic session; re-login reads the same durable catalog');
  assert.equal(publications,0);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  ok('Real local authentication and persistent storage use synthetic fixtures only; zero external requests or publications');
  await fs.writeFile(path.join(output,'verification.json'),JSON.stringify({checks,errors,external,mockOnly:true,userBrowserSessionUsed:false,realPublications:0,fixturePublicationCalls:publications},null,2));
} finally {
  await browser.close();await new Promise(resolve=>server.close(resolve));
  assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));await fs.rm(dir,{recursive:true,force:true});
}
