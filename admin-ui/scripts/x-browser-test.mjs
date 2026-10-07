import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {randomBytes,scryptSync} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {config} from '../backend/config.cjs';
import {Store} from '../backend/store.cjs';
import {Service} from '../backend/service.cjs';
import {Connectors} from '../backend/connectors.cjs';
import {providerFailure} from '../backend/diagnostics.cjs';
import {createAdminHandler} from '../server-core.cjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'spymedia-x-browser-')),output=fileURLToPath(new URL('../test-results/x-automation/',import.meta.url));
await fs.mkdir(output,{recursive:true});
const checks=[],errors=[],external=[],calls=[],dialogs=[],random=()=>randomBytes(24).toString('hex');
let upstream=null,diagnosticNow=1000;
const settings=config({SNS_DATA_DIR:dir,SNS_STORAGE_PERSISTENCE:'confirmed',SNS_SINGLE_INSTANCE:'confirmed',SNS_PUBLISH_ENABLED:'true',X_AUTH_MODE:'oauth1',X_API_KEY:random(),X_API_SECRET:random(),X_ACCESS_TOKEN:random(),X_ACCESS_TOKEN_SECRET:random(),X_PUBLISH_ENABLED:'true',X_COST_LIMIT_ACKNOWLEDGED:'true'});
const connectors=new Connectors(settings,{request:async(method,url,token,body,headers)=>{
  calls.push({method,url});assert.equal(token,null);assert.match(headers.Authorization,/^OAuth /);
  if(url.endsWith('/users/me')){
    if(upstream){const failure=providerFailure(upstream,method,'api.x.com');throw Object.assign(Error(failure.code),failure);}
    return {data:{data:{id:'123456789012345',username:'spymedia_kor',name:'<script>window.upstreamUnsafe=true</script>'}}};
  }
  throw Error('No post or refresh is permitted in this UI test');
}});
const store=new Store(settings),service=new Service({settings,store,connectors,media:{},diagnosticNow:()=>diagnosticNow});
await service.jobs.create({type:'link',title:'합성 X 검토',description:'합성 설명',xText:'합성 소개 문구',youtubeUrl:'https://www.youtube.com/watch?v=AbCdEf123_-',tags:[],channels:['x'],mediaIds:[]});
const salt=randomBytes(16),password=random(),handler=createAdminHandler({mode:'authenticated',username:'synthetic',passwordHash:salt.toString('hex')+':'+scryptSync(password,salt,64).toString('hex'),secureCookie:false,service});
const server=http.createServer((req,res)=>handler(req,res).then(done=>{if(!done){res.writeHead(404);res.end();}}).catch(()=>{errors.push('server handler failed');res.writeHead(500);res.end();}));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
let browser;
const pass=value=>{checks.push(value);console.log('PASS '+value);};
try{
  browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1100}});
  await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external.push('blocked external request');return route.abort();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  let accept=false;page.on('dialog',async dialog=>{dialogs.push(dialog.message());await (accept?dialog.accept():dialog.dismiss());});
  await page.goto(origin+'/admin/login');await page.locator('#login-id').fill('synthetic');await page.locator('#login-password').fill(password);await page.locator('#login-submit').click();await page.waitForURL(origin+'/admin');
  await page.locator('#server-jobs .job-card').waitFor();assert.equal(calls.length,0);pass('page load and job polling make zero X API calls');
  assert.match(await page.locator('#x-cost-note').textContent(),/US\$0\.20/);assert.match(await page.locator('#x-cost-note').textContent(),/금액 상한을 적용하지 않습니다/);pass('URL-post price and real Console spending cap are explicit');
  assert.equal(await page.locator('#x-check').isEnabled(),true);await page.locator('#x-check').click();assert.equal(calls.length,0);assert.match(dialogs.at(-1),/조회 비용/);pass('cancelled connection confirmation calls no API');
  accept=true;await page.locator('#x-check').click();await page.waitForFunction(()=>document.getElementById('x-feedback').textContent.includes('인증 확인됨'));
  assert.equal(calls.length,1);assert.equal(calls[0].method,'GET');assert.match(await page.locator('#x-feedback').textContent(),/OAuth 1\.0a/);assert.match(await page.locator('#x-feedback').textContent(),/글쓰기 권한은 아직 검증하지 않았습니다/);assert.equal(await page.evaluate(()=>window.upstreamUnsafe),undefined);pass('connection check uses one mocked GET and shows fixed safe identity');
  accept=false;await page.locator('#server-jobs .job-card input[type="checkbox"]').check();await page.locator('#start-server').click();assert.match(dialogs.at(-1),/US\$0\.20/);assert.match(dialogs.at(-1),/합성 소개 문구/);assert.match(dialogs.at(-1),/조회 비용 별도/);assert.equal(calls.length,1);pass('selected X send confirms exact saved content and price; cancellation sends nothing');
  assert.equal(await page.locator('#server-jobs .job-card .record-details').isVisible(),false);pass('compact job details remain collapsed');
  await page.locator('#x-copy-heading').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'x-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'x-mobile.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);pass('mobile X controls fit without horizontal overflow');
  accept=true;
  for(const scenario of [
    {status:401,data:{errors:[{code:89,message:'synthetic-private-provider-message'}]},expected:'X 인증이 거절됐습니다.'},
    {status:403,data:{type:'https://api.x.com/2/problems/client-forbidden',title:'synthetic-private-provider-message',detail:'<script>window.upstreamUnsafe=true</script>'},expected:'client-forbidden'},
    {status:403,data:{type:'https://api.twitter.com/2/problems/usage-capped',detail:'synthetic-private-provider-message'},expected:'usage-capped'},
    {status:403,data:{title:'Client Forbidden',detail:'synthetic-private-provider-message'},expected:'앱 API 접근 제한'},
    {status:403,data:{title:'synthetic-private-provider-message',detail:'synthetic-private-provider-message'},expected:'세부 원인: 알 수 없음'}
  ]){
    upstream=scenario;diagnosticNow+=60000;const before=calls.length;
    await page.locator('#x-check').click();await page.waitForFunction(expected=>document.getElementById('x-feedback').textContent.includes(expected),scenario.expected);
    const feedback=await page.locator('#x-feedback').textContent();assert.match(feedback,new RegExp('HTTP '+scenario.status));assert.equal(feedback.includes('만료'),false);assert.equal(feedback.includes('synthetic-private-provider-message'),false);assert.equal(feedback.includes('https://'),false);assert.equal(calls.length,before+1);
    assert.equal(await page.locator('.session-notice').isVisible(),false);assert.equal(await page.locator('#x-check').isEnabled(),true);assert.equal(await page.evaluate(()=>window.upstreamUnsafe),undefined);
    if(scenario.expected==='client-forbidden'){await page.setViewportSize({width:1440,height:1100});await page.screenshot({path:path.join(output,'x-forbidden-desktop.png'),fullPage:true});await page.locator('.facebook-check-row').nth(1).screenshot({path:path.join(output,'x-forbidden-detail.png')});}
    pass('mocked HTTP '+scenario.status+' shows '+scenario.expected+' without raw provider text or administrator logout');
  }
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'x-unknown-mobile.png'),fullPage:true});await page.locator('.facebook-check-row').nth(1).screenshot({path:path.join(output,'x-unknown-detail.png')});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);pass('unknown 403 reason fits mobile without overflow');
  const diagnosticCalls=calls.length;
  settings.env.X_COST_LIMIT_ACKNOWLEDGED='false';await page.reload();await page.locator('#server-jobs .job-card').waitFor();assert.equal(await page.locator('#x-check').isDisabled(),true);assert.equal(await page.locator('#x-check').textContent(),'X 조회 사용 중지');assert.match(await page.locator('#x-feedback').textContent(),/조회 사용 중지\(비용 확인 필요\)/);assert.match(await page.locator('#x-feedback').textContent(),/현재 X 조회는 실행되지 않습니다/);assert.equal(await page.locator('#x-check').getAttribute('aria-describedby'),'x-feedback');assert.equal(await page.locator('#server-jobs .job-card input[type="checkbox"]').isDisabled(),true);assert.equal(calls.length,diagnosticCalls);pass('unacknowledged API costs visibly mark diagnosis stopped and sending disabled without a request');
  await page.screenshot({path:path.join(output,'x-stopped-mobile.png'),fullPage:true});await page.locator('.facebook-check-row').nth(1).screenshot({path:path.join(output,'x-stopped-detail.png')});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);pass('stopped diagnosis explanation remains readable on mobile');
  settings.env.X_API_KEY='';await page.reload();await page.locator('#server-jobs .job-card').waitFor();assert.equal(await page.locator('#x-check').isDisabled(),true);assert.match(await page.locator('#x-feedback').textContent(),/조회 사용 중지\(인증 설정 필요\)/);assert.equal(calls.length,diagnosticCalls);pass('missing credentials show a separate stopped reason without API calls');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.ok(calls.every(c=>c.method==='GET'));pass('zero live SNS requests, zero posts/refreshes and zero external browser requests');
  await fs.writeFile(path.join(output,'summary.json'),JSON.stringify({checks,errors,external,mockedXRequests:calls.map(({method})=>({method,phase:'x_identity'})),actualXRequests:0,posts:0,refreshes:0},null,2));
}finally{
  await browser?.close();await new Promise(resolve=>server.close(resolve));assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));await fs.rm(dir,{recursive:true,force:true});
}
