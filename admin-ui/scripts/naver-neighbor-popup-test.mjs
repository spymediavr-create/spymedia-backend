import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {inspectNaverDialog} from '../../browser-tools/naver-neighbor/dom-agent.mjs';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium'});
const origin='https://blog.naver.com',targetId='wherechoice',targetUrl=origin+'/'+targetId,targetName='어디가까';
const firstUrl=origin+'/BuddyAdd.naver?blogId='+targetId+'&trackingCode=fixture';
const laterUrl=origin+'/BuddyAdd.naver';
let allowedUrl='',html='',cases=0,blockedRequests=0;

// These are synthetic HTML fixtures derived from the three user screenshots.
// Native radio/select controls are covered. They do not claim live Naver DOM
// compatibility; no remote request, credentials, form POST or real add is used.
function fixture({stage='choice',name=targetName,heading='이웃추가',ordinary=true,mutual=false,
  hiddenOrdinary=false,disabledOrdinary=false,extraRadio=false,duplicateNext=false,
  disabledNext=false,hiddenNext=false,groupName='광고',selected='새그룹',duplicateGroup=false,
  disabledGroup=false,hiddenGroup=false,disabledOption=false,customGroup=false,
  extraSelect=false,login=false,challenge=false,extraDialog=false,successText,
  hiddenSuccess=false,decoy=false}={}){
  const next=`<button type="button" data-action="next" ${disabledNext?'disabled':''} ${hiddenNext?'hidden':''} onclick="this.dataset.clicks=String(Number(this.dataset.clicks||0)+1)">다음</button>`;
  const option=(name,disabled=false)=>`<option ${name===selected?'selected':''} ${disabled?'disabled':''}>${name}</option>`;
  const select=`<select aria-label="이웃 그룹" data-group ${disabledGroup?'disabled':''} ${hiddenGroup?'hidden':''} onchange="this.dataset.changes=String(Number(this.dataset.changes||0)+1)">${option('새그룹')}${option(groupName,disabledOption)}${duplicateGroup?option(groupName):''}</select>`;
  const body=stage==='choice'?`<div class="box"><span class="target">${name}</span>님을 <label ${hiddenOrdinary?'hidden':''}><input type="radio" name="relation" value="ordinary" ${ordinary?'checked':''} ${disabledOrdinary?'disabled':''}>이웃</label> <label><input type="radio" name="relation" value="mutual" ${mutual?'checked':''}>서로이웃</label>으로 추가합니다.${extraRadio?'<label><input type="radio" name="other">이웃</label>':''}</div>`:
    stage==='group'?`<div class="box"><p><span class="target">${name}</span>님을 추가할 그룹을 선택해주세요.</p>${customGroup?`<div role="combobox" aria-label="이웃 그룹" tabindex="0">${selected}</div><div role="listbox"><div role="option">광고</div></div>`:select}${extraSelect?select:''}<button type="button" data-action="create" onclick="this.dataset.clicks='1'">+ 그룹추가</button></div>`:
    `<div class="box" ${hiddenSuccess?'hidden':''}><p>${successText??`${name}님의 블로그를 이웃으로 추가하였습니다.`}</p><p>${name}님은 가까운 이웃이 아직 없습니다.</p></div>`;
  return `<!doctype html><meta charset="utf-8"><style>body{font:16px sans-serif;padding:28px}label,button,select{display:inline-block;margin:8px}.box{border:1px solid #ddd;padding:18px}button{padding:10px}select{width:260px}</style><h2>${heading}</h2>${body}${stage==='result'?'<button type="button" data-action="close" onclick="this.dataset.clicks=\'1\'">닫기</button>':`<button type="button" data-action="cancel" onclick="this.dataset.clicks='1'">취소</button>${next}${duplicateNext?next:''}`}<p>이웃과 서로이웃은 무엇인가요?</p>${login?'<a href="https://nid.naver.com/nidlogin.login">로그인</a><input type="password">':''}${challenge?'<div role="alert">보안 인증이 필요합니다.</div>':''}${extraDialog?'<div role="dialog">다른 설정을 확인하세요.</div>':''}${decoy?'<div hidden><button data-action="decoy" onclick="this.dataset.clicks=\'1\'">다음</button><select><option>광고</option></select></div>':''}`;
}

try{
  const context=await browser.newContext({viewport:{width:900,height:700}}),page=await context.newPage();
  await context.route('**/*',route=>{
    if(route.request().isNavigationRequest()&&route.request().url()===allowedUrl.split('#')[0])return route.fulfill({status:200,contentType:'text/html',body:html});
    blockedRequests++;return route.abort();
  });
  const load=async(options={},url=(options.stage==='group'||options.stage==='result')?laterUrl:firstUrl)=>{html=fixture(options);allowedUrl=new URL(url).href;await page.goto(allowedUrl);};
  const inspect=(stage='choice',mode='inspect',extra={})=>page.evaluate(inspectNaverDialog,{targetUrl,targetName,stage,mode,groupName:'광고',...extra});
  const unchanged=async()=>{assert.equal(await page.locator('[data-clicks]').count(),0,'No control may be clicked during a refused/read-only operation');assert.equal(await page.locator('[data-changes]').count(),0,'No group change may occur during a refused/read-only operation');};
  const refuse=async(options={},stage=options.stage||'choice',mode=stage==='choice'?'next':stage==='group'?'submit':'inspect',url,extra={})=>{
    await load(options,url);const result=await inspect(stage,mode,extra);assert.equal(result.ok,false,JSON.stringify({options,stage,mode,url,extra,result}));await unchanged();cases++;
  };

  await load();assert.equal((await inspect()).state,'choice');await unchanged();
  assert.equal((await inspect('choice','next')).state,'advanced');assert.equal(await page.locator('[data-action="next"][data-clicks="1"]').count(),1);assert.equal(await page.locator('[data-action="cancel"][data-clicks]').count(),0);cases++;
  await load({stage:'group'});assert.equal((await inspect('group')).state,'group');await unchanged();
  assert.equal((await inspect('group','select')).state,'selected');assert.equal(await page.locator('select').inputValue(),'광고');assert.equal(await page.locator('[data-clicks]').count(),0);
  assert.equal((await inspect('group','submit')).state,'submitted');assert.equal(await page.locator('[data-action="next"][data-clicks="1"]').count(),1);assert.equal(await page.locator('[data-action="create"][data-clicks]').count(),0);cases++;
  await load({stage:'result'});assert.equal((await inspect('result')).state,'added');await unchanged();cases++;
  await load({decoy:true});assert.equal((await inspect()).state,'choice');assert.equal((await inspect('choice','next')).state,'advanced');assert.equal(await page.locator('[data-action="decoy"][data-clicks]').count(),0);cases++;

  for(const options of [{ordinary:false},{ordinary:false,mutual:true}]){
    await load(options);assert.equal((await inspect('choice','next')).state,'advanced');
    assert.equal(await page.locator('input[value="ordinary"]').isChecked(),true);assert.equal(await page.locator('input[value="mutual"]').isChecked(),false);assert.equal(await page.locator('[data-action="next"][data-clicks="1"]').count(),1);cases++;
  }
  for(const options of [{name:'다른블로그'},{heading:'서로이웃 신청'},{hiddenOrdinary:true},{disabledOrdinary:true},{extraRadio:true},{duplicateNext:true},{disabledNext:true},{hiddenNext:true},{login:true},{challenge:true},{extraDialog:true}])await refuse(options);
  for(const url of [laterUrl,origin+'/BuddyAdd.naver?blogId=another_blog',origin+'/BuddyAdd.naver?blogId='+targetId+'&blogId='+targetId,origin+'/BuddyAdd.naver?blogId='+targetId+'#other','https://m.blog.naver.com/BuddyAdd.naver?blogId='+targetId,'https://blog.naver.com.evil.invalid/BuddyAdd.naver?blogId='+targetId,origin+'/Other.naver?blogId='+targetId])await refuse({},'choice','next',url);
  for(const extra of [{targetUrl:origin+'/spymedia'},{targetUrl:targetUrl+'/123'},{targetUrl:targetUrl+'?x=1'},{targetName:''},{targetName:'다른블로그'},{groupName:'새그룹'},{stage:'unknown'},{mode:'unknown'}])await refuse({},'choice','next',undefined,extra);
  for(const options of [{name:'다른블로그'},{groupName:'기본그룹'},{duplicateGroup:true},{disabledGroup:true},{hiddenGroup:true},{disabledOption:true},{customGroup:true},{extraSelect:true},{duplicateNext:true},{disabledNext:true},{hiddenNext:true},{login:true},{challenge:true},{extraDialog:true}])await refuse({stage:'group',...options},'group','select');
  await refuse({stage:'group'},'group','submit'); // Never submit the default group.
  await refuse({stage:'group',selected:'광고',name:'다른블로그'},'group','submit');
  await refuse({stage:'group',selected:'광고'},'group','submit',origin+'/BuddyAdd.naver?blogId=another_blog');
  for(const options of [{name:'다른블로그'},{hiddenSuccess:true},{successText:`${targetName}님의 블로그를 서로이웃으로 추가하였습니다.`},{successText:'이웃추가가 완료되지 않았습니다.'},{successText:`${targetName}님의 블로그를 이웃으로 추가하였습니다. 다른블로그님의 블로그를 이웃으로 추가하였습니다.`},{login:true},{challenge:true},{extraDialog:true}])await refuse({stage:'result',...options},'result','inspect');
  await refuse({stage:'group'},'result','inspect');await refuse({stage:'choice'},'group','submit');
  await refuse({stage:'result'},'choice','next');

  // The final submission revalidates the selected group and target name.
  await load({stage:'group'});assert.equal((await inspect('group','select')).state,'selected');await page.locator('select').selectOption({label:'새그룹'});await page.locator('select').evaluate(n=>{delete n.dataset.changes;});assert.equal((await inspect('group','submit')).ok,false);await unchanged();cases++;
  await load({stage:'group',selected:'광고'});assert.equal((await inspect('group')).state,'group');await page.locator('.target').evaluate(n=>{n.textContent='바뀐블로그';});assert.equal((await inspect('group','submit')).ok,false);await unchanged();cases++;

  console.log(`PASS ${cases} offline Chromium Naver popup fixtures: ordinary neighbor only, exact target and route, separate choice/group/result stages, exact existing 광고 selection, one final submit, explicit success, and refusal on login/challenge/ambiguity. Blocked non-fixture requests: ${blockedRequests}. Live Naver requests, form submissions and neighbor additions: 0.`);
}finally{await browser.close();}
