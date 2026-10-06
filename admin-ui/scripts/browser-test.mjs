import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createAdminHandler} from '../server-core.cjs';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const handler=createAdminHandler({mode:'preview',allowPreview:true}),errors=[],external=[],writes=[];
const server=http.createServer((req,res)=>{if(req.method!=='GET')writes.push(req.url);handler(req,res).then(done=>{if(!done){res.writeHead(404);res.end();}});});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1440,height:1100}});
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',route=>{const u=route.request().url();if(u.startsWith(origin+'/')||u.startsWith('blob:'+origin)||u.startsWith('data:'))return route.continue();external.push(u);return route.abort();});
try{
  await page.goto(origin+'/admin/login');await page.waitForFunction(()=>document.getElementById('login-feedback').textContent.length>0);
  assert.equal(await page.locator('#login-submit').isDisabled(),true);console.log('PASS local preview does not impersonate an authenticated login');
  await page.getByRole('link',{name:'화면 미리보기'}).click();await page.waitForURL(origin+'/admin/preview');await page.waitForFunction(()=>document.querySelectorAll('.channel-card').length===5);
  assert.equal(await page.locator('#import-youtube').isDisabled(),true);assert.equal(await page.locator('#server-workflow').isHidden(),true);
  assert.equal(await page.getByRole('tab').count(),5);console.log('PASS preview displays five channels and disables import and server actions');
  await page.click('#check-draft');assert.match(await page.locator('#draft-feedback').textContent(),/제목을 입력하세요.*설명을 입력하세요.*유튜브/s);
  await page.fill('#youtube-url','https://youtu.be/AbCdEf123_-');await page.fill('#title','제주 해안 드론');await page.fill('#description','파도와 하늘을 담았습니다.');
  await page.click('#recommend-tags');await page.getByRole('button',{name:'+ #항공촬영',exact:true}).click();await page.fill('#tag-input','#제주 #제주');await page.press('#tag-input','Enter');
  assert.equal(await page.locator('#tag-list .tag-chip').count(),2);
  await page.fill('#x-text','사용자가 직접 쓴 X 문구');await page.fill('#description','수정한 설명');assert.equal(await page.inputValue('#x-text'),'사용자가 직접 쓴 X 문구');
  await page.click('#check-draft');assert.match(await page.locator('#draft-feedback').textContent(),/입력이 준비됐습니다/);
  console.log('PASS source validation, tag suggestions and manual X edits work without server calls');
  await page.locator('#image-input').setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPucAAAAASUVORK5CYII=','base64')});
  assert.equal(await page.locator('#image-files img').count(),1);await page.getByRole('button',{name:'fixture.png 제거'}).click();assert.equal(await page.locator('#image-files img').count(),0);
  await page.click('#tab-blog');assert.equal(await page.locator('#blog-note').isVisible(),true);
  for(const width of [390,360]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log('PASS photo selection/removal and mobile preview cause zero authenticated writes or external requests');
}finally{await browser.close();await new Promise(r=>server.close(r));}
