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
import {Connectors} from '../backend/connectors.cjs';
import {createAdminHandler} from '../server-core.cjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'spymedia-ig-browser-')),output=fileURLToPath(new URL('../test-results/instagram-photo/',import.meta.url));
await fs.mkdir(output,{recursive:true});
const calls=[],checks=[],errors=[],external=[],dialogs=[],random=()=>randomBytes(24).toString('hex');
let identityOverride=null,uncertain=false,diagnosticNow=1000;
const settings=config({SNS_DATA_DIR:dir,SNS_STORAGE_PERSISTENCE:'confirmed',SNS_SINGLE_INSTANCE:'confirmed',SNS_PUBLISH_ENABLED:'true',META_GRAPH_VERSION:'v25.0',IG_USER_ID:'178414000000001',IG_ACCESS_TOKEN:random(),IG_PUBLISH_ENABLED:'true',PUBLIC_ORIGIN:'http://127.0.0.1',MEDIA_SIGNING_KEY:randomBytes(32).toString('hex')});
const store=new Store(settings),connectors=new Connectors(settings,{mediaUrl:asset=>service.signedUrl(asset),sleep:async()=>{},request:async(method,url,token,body)=>{
  calls.push({method,phase:url.includes('fields=id,user_id,username')?'identity':url.includes('/content_publishing_limit?')?'permissions':url.endsWith('/media_publish')?'publish':url.endsWith('/media')?'container':url.includes('fields=status_code')?'processing':'verify'});
  if(url.includes('fields=id,user_id,username'))return {data:identityOverride||{id:'900000000001',user_id:settings.env.IG_USER_ID,username:'spymedia_kr',unsafe:'<script>window.unsafe=true</script>'}};
  if(url.includes('/content_publishing_limit?')){assert.equal(method,'GET');assert.equal(url,'https://graph.instagram.com/'+settings.env.META_GRAPH_VERSION+'/'+settings.env.IG_USER_ID+'/content_publishing_limit?fields=quota_usage,config');return {data:{data:[{quota_usage:0,config:{quota_total:100,quota_duration:86400}}]}};}
  if(url.endsWith('/media')){assert.equal(url,'https://graph.instagram.com/'+settings.env.META_GRAPH_VERSION+'/'+settings.env.IG_USER_ID+'/media');assert.equal(body.video_url,undefined);assert.equal(body.media_type,undefined);assert.match(body.image_url,new RegExp('^'+settings.origin));return {data:{id:'container_1'}};}
  if(url.includes('fields=status_code'))return {data:{status_code:'FINISHED'}};
  if(url.endsWith('/media_publish')){assert.equal(url,'https://graph.instagram.com/'+settings.env.META_GRAPH_VERSION+'/'+settings.env.IG_USER_ID+'/media_publish');if(uncertain)throw Object.assign(Error('synthetic-private-provider-message'),{status:502,code:'channel_network_failure',uncertain:true});return {data:{id:'media_1'}};}
  if(url.includes('fields=id,permalink'))return {data:{id:'media_1',permalink:'https://www.instagram.com/p/synthetic_1/'}};
  throw Error('Unexpected mocked endpoint');
}});
const service=new Service({settings,store,connectors,media:{tools:async()=>{throw Error('No media tools allowed');},convert:async()=>{throw Error('No conversion allowed');}},diagnosticNow:()=>diagnosticNow});service.jobs.failureLogger=()=>{};
const salt=randomBytes(16),password=random(),handler=createAdminHandler({mode:'authenticated',username:'synthetic',passwordHash:salt.toString('hex')+':'+scryptSync(password,salt,64).toString('hex'),secureCookie:false,service});
const server=http.createServer((req,res)=>handler(req,res).then(done=>{if(!done){res.writeHead(404);res.end();}}));
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;settings.origin=origin;
let browser;const pass=value=>{checks.push(value);console.log('PASS '+value);};
try{
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});const context=await browser.newContext({viewport:{width:1440,height:1100}});
  await context.route('**/*',route=>{const url=route.request().url();if(url.startsWith('blob:')||url.startsWith('data:')||new URL(url).origin===origin)return route.continue();external.push('blocked external request');return route.abort();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));let accept=false;
  page.on('dialog',async dialog=>{dialogs.push(dialog.message());await (accept?dialog.accept():dialog.dismiss());});
  assert.equal((await context.request.get(origin+'/admin/instagram',{maxRedirects:0})).status(),303);pass('Instagram workspace remains protected before login');
  await page.goto(origin+'/admin/login');await page.locator('#login-id').fill('synthetic');await page.locator('#login-password').fill(password);await page.locator('#login-submit').click();await page.waitForURL(origin+'/admin');
  await page.locator('.channel-card[data-channel=instagram]').waitFor();await page.locator('#tab-instagram').waitFor();assert.equal(await page.getByRole('button',{name:'인스타그램',exact:true}).count()>0,true);assert.equal(await page.getByRole('tab',{name:'인스타그램',exact:true}).count()>0,true);pass('main Instagram channel card and preview tab remain present');
  await page.goto(origin+'/admin/instagram');await page.waitForFunction(()=>document.getElementById('ig-check').disabled===false);
  assert.equal(calls.length,0);assert.equal(await page.locator('#ig-open').getAttribute('href'),'https://business.facebook.com/');assert.equal(await page.locator('#ig-copy').count(),1);pass('load makes zero provider requests and preserves the existing Business Suite helper');
  assert.equal(await page.locator('#ig-send').isDisabled(),true);await page.locator('#ig-check').click();await page.waitForFunction(()=>document.getElementById('ig-connection').textContent.includes('계정 확인됨'));
  assert.deepEqual(calls,[{method:'GET',phase:'identity'},{method:'GET',phase:'permissions'}]);assert.match(await page.locator('#ig-connection').textContent(),/게시 권한 확인됨.*실제 게시 결과는 전송 후/);assert.equal(await page.evaluate(()=>window.unsafe),undefined);const diagnosisCalls=calls.length;pass('explicit connection check validates the fixed account and performs a read-only publishing-permission probe without claiming a real post');
  await page.locator('#ig-title').fill('합성 사진 검토');await page.locator('#ig-description').fill('검토한 문구 <script>literal</script>');await page.locator('#ig-tags').fill('#SpyMedia');
  const jpeg=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1080;c.height=1080;const ctx=c.getContext('2d');ctx.fillStyle='#123552';ctx.fillRect(0,0,1080,1080);ctx.fillStyle='#16adc5';ctx.fillRect(120,120,840,840);return c.toDataURL('image/jpeg',0.85).split(',')[1];}),'base64');
  await page.locator('#ig-photo').setInputFiles({name:'synthetic-photo.jpg',mimeType:'image/jpeg',buffer:jpeg});await page.waitForFunction(()=>document.getElementById('ig-photo-preview').naturalWidth===1080);assert.equal(await page.locator('[name=ig-kind][value=photo]').isChecked(),true);pass('real canvas JPEG previews locally and selects photo mode');
  assert.equal(await page.locator('#ig-placeholder img').isVisible(),true);assert.equal(await page.locator('#ig-placeholder p').isVisible(),false);pass('Instagram preview shows the selected actual photo with the existing caption');
  await page.locator('#ig-prepare').click();await page.waitForFunction(()=>document.getElementById('ig-publish-feedback').textContent.includes('저장했습니다'));
  assert.equal(calls.length,diagnosisCalls);assert.equal(await page.locator('#ig-send').isEnabled(),true);assert.match(await page.locator('#ig-jobs .record-details').textContent(),/검토한 문구 <script>literal<\/script>/);assert.equal(await page.evaluate(()=>window.literal),undefined);pass('photo preparation stores exact caption and original without a provider request');
  await page.locator('#ig-send').click();assert.equal(calls.length,diagnosisCalls);assert.match(dialogs.at(-1),/spymedia_kr/);assert.match(dialogs.at(-1),/synthetic-photo.jpg/);assert.match(dialogs.at(-1),/검토한 문구/);assert.match(dialogs.at(-1),/1080 × 1080px/);pass('cancelled confirmation includes saved account, photo and caption and sends nothing');
  await page.locator('#ig-description').fill('전송 직전 편집된 저장하지 않은 문구');await page.locator('#ig-send').click();assert.match(dialogs.at(-1),/검토한 문구/);assert.equal(dialogs.at(-1).includes('저장하지 않은 문구'),false);assert.equal(calls.length,diagnosisCalls);pass('send confirmation uses the immutable saved draft rather than unsaved edits');
  accept=true;await page.locator('#ig-send').click();await page.waitForFunction(()=>document.querySelector('#ig-jobs .record-item[data-status=succeeded]'));
  assert.deepEqual(calls.slice(diagnosisCalls).map(c=>c.phase),['identity','permissions','container','processing','publish','verify']);assert.equal(calls.filter(c=>c.phase==='publish').length,1);assert.equal(await page.locator('#ig-send').isDisabled(),true);pass('approved mock send rechecks identity and permissions, publishes once and verifies the returned post');
  await page.screenshot({path:path.join(output,'instagram-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(output,'instagram-mobile.png'),fullPage:true});pass('photo preparation and compact result rows fit mobile without overflow');
  await page.locator('#ig-prepare').click();await page.waitForFunction(()=>document.querySelector('#ig-jobs .record-item[data-status=prepared]'));uncertain=true;await page.locator('#ig-send').click();await page.waitForFunction(()=>document.querySelector('#ig-jobs .record-item[data-status=unknown]'));assert.equal(await page.locator('#ig-send').isDisabled(),true);assert.equal(await page.getByRole('button',{name:'다시 준비',exact:true}).count(),0);pass('uncertain mock publication stops retries and duplicate preparation cannot replay it');
  await page.locator('#ig-prepare').click();await page.waitForFunction(()=>document.getElementById('ig-publish-feedback').textContent.includes('저장했습니다'));assert.equal(await page.locator('#ig-send').isDisabled(),true);assert.equal(calls.filter(c=>c.phase==='publish').length,2);pass('same photo and caption retain the uncertain job rather than creating another send');
  for(const scenario of [
    {identity:{id:'900000000001',user_id:settings.env.IG_USER_ID,username:'synthetic_other_account'},expected:'계정명이 spymedia_kr와 다릅니다.',detail:'계정 번호 일치',file:'instagram-username-mismatch-mobile.png'},
    {identity:{id:settings.env.IG_USER_ID,user_id:'178414000000002',username:'spymedia_kr'},expected:'계정명은 spymedia_kr와 일치하지만 계정 번호가',detail:'user_id와 기존 번호 불일치',file:'instagram-id-mismatch-mobile.png'},
    {identity:{id:'900000000001',user_id:'178414000000002',username:'synthetic_other_account'},expected:'계정명과 계정 번호가 모두',detail:'계정 번호 불일치',file:'instagram-both-mismatch-mobile.png'}
  ]){
    identityOverride=scenario.identity;diagnosticNow+=60000;await page.reload();await page.waitForFunction(()=>document.getElementById('ig-check').disabled===false);const count=calls.length;await page.locator('#ig-check').click();await page.waitForFunction(expected=>document.getElementById('ig-connection').textContent.includes(expected),scenario.expected);
    const text=await page.locator('#ig-connection').textContent();assert.match(text,new RegExp(scenario.detail));assert.equal(text.includes('synthetic_other_account'),false);assert.equal(text.includes('17841400000000'),false);assert.equal(calls.length,count+1);assert.equal(calls.at(-1).method,'GET');assert.equal(await page.locator('#ig-send').isDisabled(),true);assert.equal(calls.filter(c=>c.phase==='publish').length,2);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.locator('.ig-native').screenshot({path:path.join(output,scenario.file)});pass('safe diagnosis distinguishes '+scenario.detail+' while preserving identity blocking and zero raw account values');
  }
  settings.env.IG_ACCESS_TOKEN='';await page.reload();await page.waitForFunction(()=>document.getElementById('ig-connection').textContent.includes('인증 설정이 필요'));const before=calls.length;assert.equal(await page.locator('#ig-check').isDisabled(),true);assert.equal(await page.locator('#ig-send').isDisabled(),true);await page.waitForTimeout(100);assert.equal(calls.length,before);pass('missing existing credentials clearly disable account checks and sending without API calls');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);pass('zero real Instagram requests, external browser requests, new credentials or media conversion');
  await fs.writeFile(path.join(output,'summary.json'),JSON.stringify({checks,errors,external,mockedRequests:calls,actualInstagramRequests:0,actualPosts:0,newCredentials:0,conversions:0},null,2));
}finally{
  await browser?.close();await new Promise(r=>server.close(r));assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));await fs.rm(dir,{recursive:true,force:true});
}
