import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {inspectNaverPage} from '../../browser-tools/naver-neighbor/dom-agent.mjs';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const actor='spymedia',targetId='dearhye_',target='https://blog.naver.com/'+targetId,actorUrl='https://blog.naver.com/'+actor;
const actorLabel='드론촬영스.. 내정보 보기';
const targetName='어디가까';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium'});
let cases=0,allowedUrl='',html='',blockedRequests=0;

// All HTML is synthetic and fulfilled locally. These fixtures exercise only the
// profile frame and owner proof; no Naver response, popup submission or account
// credentials are used, and an open action increments a local counter only.
function fixture({owner=false,globalActor=true,hiddenActor=false,label=actorLabel,
  profile=true,hiddenProfile=false,duplicateProfile=false,profileLink=true,
  linkId=owner?actor:targetId,profileLabel='프로필',duplicateProfileLink=false,
  menu=true,menuLabel='내 메뉴',hiddenMenu=false,write=true,writeId=actor,
  manage=true,manageId=actor,ownerControlsOutside=false,
  control=true,state='add',controlLabel,controlTarget='_blank',buddyClass=true,
  duplicateControl=false,hiddenDuplicate=false,disabled=false,ariaDisabled=false,
  controlHidden=false,controlAriaHidden=false,controlInert=false,
  login=false,hiddenLogin=false,challenge=false,dialog=false,
  feedDecoys=true}={}){
  const global=globalActor?`<div id="gnb"><a id="gnb_my" href="#" ${hiddenActor?'style="display:none"':''}>${label}</a></div>`:'';
  const myMenu=menu?`<a id="myMenuLink" href="#" ${hiddenMenu?'style="display:none"':''}>${menuLabel}</a>`:'';
  const identity=`<a href="https://blog.naver.com/profile/intro.naver?blogId=${linkId}">${profileLabel}</a>`;
  const ownControls=(write?`<a href="https://blog.naver.com/${writeId}/postwrite">글쓰기</a>`:'')+(manage?`<a href="https://admin.blog.naver.com/${manageId}">관리</a>`:'');
  const actualLabel=controlLabel??(state==='add'?'이웃추가':state==='existing'?'이웃':state);
  const actualClass=state==='add'?'btn_add_nb':state==='existing'?'btn_nb':'btn_unknown';
  const action=`<a href="#" class="btn ${actualClass} ${buddyClass?'_addBuddyPop':''} _rosRestrictAll _returnFalse" target="${controlTarget}" data-target-control ${disabled?'disabled':''} ${ariaDisabled?'aria-disabled="true"':''} ${controlHidden?'style="display:none"':''} ${controlAriaHidden?'aria-hidden="true"':''} ${controlInert?'inert':''} onclick="this.dataset.clicks=String(Number(this.dataset.clicks||0)+1);return false;"><span class="blind">${actualLabel}</span></a>`;
  const profileBlock=`<section id="blog-profile" ${hiddenProfile?'style="display:none"':''}><span id="nickNameArea">${targetName}</span><span class="blog_domain">${owner?actor:targetId}</span>${profileLink?identity:''}${duplicateProfileLink?identity:''}${owner&&!ownerControlsOutside?ownControls:''}${!owner&&control?action:''}${duplicateControl?action:''}${hiddenDuplicate?`<div style="display:none">${action}</div>`:''}</section>`;
  const decoy='<article><h2>합성 블로그 글</h2><a class="btn btn_add_nb _addBuddyPop" target="_blank" href="#" data-feed-control onclick="this.dataset.clicks=\'1\';return false;">이웃추가</a><a class="btn btn_nb _addBuddyPop" target="_blank" href="#" data-feed-control onclick="this.dataset.clicks=\'1\';return false;">이웃</a></article>';
  return `<!doctype html><meta charset="utf-8"><style>a{display:inline-block;margin:6px;padding:8px}.btn{position:relative;min-width:80px;min-height:20px}.blind{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}#blog-profile{border:1px solid #ddd;padding:16px;width:260px}article{margin:24px}</style>${global}${owner?myMenu:''}${profile?profileBlock:''}${duplicateProfile?profileBlock:''}${ownerControlsOutside?ownControls:''}${feedDecoys?decoy:''}${login?`<div ${hiddenLogin?'style="display:none"':''}><a href="https://nid.naver.com/nidlogin.login">로그인</a><input type="password"></div>`:''}${challenge?'<div role="alert">보안 인증이 필요합니다. 잠시 후 다시 시도하세요.</div>':''}${dialog?'<div role="dialog">알림 내용을 확인하세요.</div>':''}`;
}

try{
  const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();
  await context.route('**/*',route=>{
    if(route.request().isNavigationRequest()&&route.request().url()===allowedUrl)return route.fulfill({status:200,contentType:'text/html',body:html});
    blockedRequests++;return route.abort();
  });
  const frameUrl=(id=targetId,kind='/PostList.naver')=>'https://blog.naver.com'+kind+'?blogId='+id;
  const load=async(options={},url=frameUrl(options.owner?actor:targetId))=>{html=fixture(options);allowedUrl=new URL(url).href;await page.goto(allowedUrl);};
  const inspect=(mode='inspect',targetUrl=target,proof=actorLabel,overrides={})=>page.evaluate(inspectNaverPage,{expectedAccount:actor,expectedName:actor,targetUrl,mode,actorLabel:proof,...overrides});
  const zeroClicks=async()=>assert.equal(await page.locator('[data-clicks]').count(),0,'A failed, existing or read-only check must not click any control');
  const refuse=async(options={},url=frameUrl(),targetUrl=target,proof=actorLabel,overrides={})=>{
    await load(options,url);assert.equal((await inspect('open',targetUrl,proof,overrides)).ok,false,JSON.stringify({options,url,targetUrl,proof,overrides}));await zeroClicks();cases++;
  };
  const refuseActor=async(options={},url=frameUrl(actor),targetUrl=actorUrl)=>{
    await load({owner:true,...options},url);assert.equal((await inspect('actor',targetUrl)).ok,false,JSON.stringify({options,url,targetUrl}));await zeroClicks();cases++;
  };

  for(const frame of ['/PostList.naver','/PostView.naver','/prologue/PrologueList.naver']){
    await load({owner:true},frameUrl(actor,frame));
    const proof=await inspect('actor',actorUrl,undefined);assert.deepEqual(proof,{ok:true,state:'actor_verified',actorId:actor,actorLabel});await zeroClicks();cases++;
    await load({},frameUrl(targetId,frame));
    assert.deepEqual(await inspect(),{ok:true,state:'add',targetId,targetName});await zeroClicks();
    assert.deepEqual(await inspect('open',target,proof.actorLabel),{ok:true,state:'opened',targetId,targetName});
    assert.equal(await page.locator('[data-target-control][data-clicks="1"]').count(),1);assert.equal(await page.locator('[data-feed-control][data-clicks]').count(),0);cases++;
  }
  for(const options of [{state:'existing'},{state:'existing',hiddenDuplicate:true},{hiddenDuplicate:true}]){
    await load(options);const expected=options.state==='existing'?'existing':'add';assert.equal((await inspect()).state,expected);await zeroClicks();
    if(expected==='existing'){assert.deepEqual(await inspect('open'),{ok:true,state:'existing',targetId,targetName});await zeroClicks();}
    else {assert.equal((await inspect('open')).state,'opened');assert.equal(await page.locator('[data-target-control][data-clicks="1"]').count(),1);}
    cases++;
  }

  for(const options of [
    {globalActor:false},{hiddenActor:true},{label:'다른계정 내정보 보기'},
    {profile:false},{hiddenProfile:true},{duplicateProfile:true},
    {profileLink:false},{linkId:'different_blog'},{profileLabel:'소개'},{duplicateProfileLink:true},
    {control:false},{duplicateControl:true},{buddyClass:false},{controlTarget:'_self'},
    {state:'서로이웃추가'},{state:'서로이웃'},{state:'이웃취소'},
    {controlLabel:'서로이웃추가'},{controlLabel:'이웃추가 취소'},
    {disabled:true},{ariaDisabled:true},{controlHidden:true},{controlAriaHidden:true},{controlInert:true},
    {login:true},{challenge:true},{dialog:true}
  ])await refuse(options);
  await load({login:true,hiddenLogin:true});assert.equal((await inspect()).state,'add');await zeroClicks();cases++;
  for(const proof of [null,'','다른계정 내정보 보기'])await refuse({},frameUrl(),target,proof);
  for(const overrides of [{expectedAccount:'other_user'},{expectedName:'other_user'}])await refuse({},frameUrl(),target,actorLabel,overrides);
  for(const invalidTarget of [actorUrl,'https://blog.naver.com/dearhye_/123','https://blog.naver.com/dearhye_?view=1','https://blog.naver.com/dearhye_#main','https://blog.naver.com.evil.test/dearhye_'])await refuse({},frameUrl(),invalidTarget);
  for(const current of [
    target,'https://blog.naver.com/advertisement?blogId='+targetId,
    frameUrl('different_blog'),frameUrl()+'&blogId='+targetId,
    'https://m.blog.naver.com/PostList.naver?blogId='+targetId,
    'https://blog.naver.com.evil.test/PostList.naver?blogId='+targetId
  ])await refuse({},current);

  for(const options of [
    {globalActor:false},{hiddenActor:true},{label:''},{menu:false},{hiddenMenu:true},{menuLabel:'전체 메뉴'},
    {write:false},{writeId:'different_blog'},{manage:false},{manageId:'different_blog'},
    {ownerControlsOutside:true},{profile:false},{profileLink:false},{linkId:'different_blog'},
    {duplicateProfile:true},{duplicateProfileLink:true},{login:true},{challenge:true},{dialog:true}
  ])await refuseActor(options);
  await refuseActor({},actorUrl);
  await refuseActor({},frameUrl('different_blog'),actorUrl);
  await refuseActor({owner:false},frameUrl(),target);

  // Revalidation occurs at the moment of opening, after an earlier read succeeded.
  await load();assert.equal((await inspect()).state,'add');await page.locator('#gnb_my').evaluate(node=>{node.textContent='다른계정 내정보 보기';});assert.equal((await inspect('open')).ok,false);await zeroClicks();cases++;
  await load();assert.equal((await inspect()).state,'add');await page.locator('#blog-profile a').first().evaluate(node=>{node.href='https://blog.naver.com/profile/intro.naver?blogId=other_blog';});assert.equal((await inspect('open')).ok,false);await zeroClicks();cases++;
  await load();assert.equal((await inspect('unknown')).ok,false);await zeroClicks();cases++;

  console.log(`PASS ${cases} offline Chromium Naver profile DOM fixtures: owner-only actor proof, allowed content frames, exact profile identity, add/existing controls, target-only local open, feed decoys, login/challenge/ambiguity guards and last-moment actor/profile revalidation. Blocked non-fixture requests: ${blockedRequests}. Actual Naver requests, popup submissions and neighbor additions: 0.`);
}finally{await browser.close();}
