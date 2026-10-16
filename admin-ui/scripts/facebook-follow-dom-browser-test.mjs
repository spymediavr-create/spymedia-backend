import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {inspectFacebookPage} from '../../browser-tools/facebook-follow/dom-agent.mjs';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const actorId='61594869881531', actorName='스파이미디어';
const target='https://www.facebook.com/reviewed.studio';
const numericTarget='https://www.facebook.com/profile.php?id=100001234567';
const actorUrl=`https://www.facebook.com/people/${encodeURIComponent(actorName)}/${actorId}/`;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium'});
let cases=0,allowedUrl='',html='',blockedRequests=0;

// These are synthetic, headerless Facebook desktop structures. No Facebook
// response, cookies, API credentials or real follow action is used by this test.
function fixture({actor=actorId,nav=true,hiddenNav=false,duplicateActor=false,
  pageActor=false,editLink=true,editText='프로필 편집',wrongName=false,numeric=false,stats=true,
  foreignStats=false,button='팔로우',labelOnly=false,duplicateFollow=false,
  hiddenDuplicate=false,disabled=false,nestedControl=false,omitTarget=false,
  recommendations=[],recommendationsAfterClick=false,feedDecoy=true,
  postsInside=false,visibleLogin=false,challenge=false}={}) {
  const adLink=id=>`<a aria-label="광고 센터" href="/${id}/ad_center/">광고 센터</a>`;
  const rail=nav?`<div role="navigation" aria-label="Facebook" ${hiddenNav?'style="display:none"':''}><a href="/">홈</a><a href="/reel/">릴스</a>${adLink(actor)}${duplicateActor?adLink('100009999999'):''}</div>`:'';
  // A sidebar or a feed reference to the desired Page cannot prove the actor.
  const sidebar=`<aside aria-label="페이지 관리하기"><a href="/profile.php?id=${actorId}">${actorName}</a>${adLink(actorId)}</aside>`;
  const profileId=pageActor?actorId:'100001234567';
  const profilePath=foreignStats?'/different.studio':numeric||pageActor?`/profile.php?id=${profileId}`:'/reviewed.studio';
  const statsPath=kind=>profilePath+(profilePath.includes('?')?`&sk=${kind}`:`/${kind}/`);
  const name=pageActor?(wrongName?'다른 페이지':actorName):'Reviewed Studio';
  const cards=`<section data-recommendations><h3>추천 페이지</h3>${recommendations.map((label,index)=>`<div data-recommendation-card><a href="/recommended.${index}">추천 ${index}</a><button data-recommendation-control onclick="this.dataset.clicks=String(Number(this.dataset.clicks||0)+1)">${label}</button></div>`).join('')}</section>`;
  const clicked="this.dataset.clicks=String(Number(this.dataset.clicks||0)+1);this.textContent='팔로잉';this.setAttribute('aria-label','팔로잉')"+(recommendationsAfterClick?";document.getElementById('profile').append(document.getElementById('recommendation-template').content.cloneNode(true))":'');
  const primary=`<button data-target-control ${labelOnly?`aria-label="${button}"`:''} ${disabled?'disabled':''} onclick="${clicked}">${labelOnly?'<svg width="20" height="20" aria-hidden="true"></svg>':button}</button>`;
  const control=omitTarget?'':nestedControl?`<div role="button">${primary}</div>`:primary;
  const counters=stats?`<div data-profile-counters><a href="${statsPath('followers')}">팔로워 200명</a><a href="${statsPath('following')}">팔로잉 22명</a></div>`:'';
  const edit=pageActor&&editLink?`<a aria-label="프로필 편집" href="/profile.php?id=${actorId}&sk=about">${editText}</a>`:'';
  const article='<article><a href="/different.studio/posts/fixture">다른 페이지 게시물</a><button data-feed-control onclick="this.dataset.clicks=\'1\'">팔로우</button></article>';
  return `<!doctype html><meta charset="utf-8"><style>a,button,[role=button]{display:inline-block;margin:6px;padding:8px}main{margin-left:100px}aside{position:fixed;left:0;top:120px;width:90px}</style>${rail}${sidebar}<main><div id="profile"><div role="button">${name}</div>${counters}<div data-profile-actions>${pageActor?edit:control}${duplicateFollow?control:''}${hiddenDuplicate?`<span style="display:none">${control}</span>`:''}<button>메시지 보내기</button></div>${recommendations.length&&!recommendationsAfterClick?cards:''}${postsInside?article:''}</div>${feedDecoy?article:''}</main>${recommendationsAfterClick?`<template id="recommendation-template">${cards}</template>`:''}${visibleLogin?'<form><input name="email"><input name="pass" type="password"></form>':''}${challenge?'<div role="dialog">일부 활동을 제한했습니다. 나중에 다시 시도하세요.</div>':''}`;
}

try {
  const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
  await context.route('**/*',route=>{
    if(route.request().isNavigationRequest()&&route.request().url()===allowedUrl) return route.fulfill({status:200,contentType:'text/html',body:html});
    blockedRequests++;
    return route.abort();
  });
  const load=async(options={},url=target)=>{html=fixture(options);allowedUrl=new URL(url).href;await page.goto(allowedUrl);};
  const inspect=(mode='inspect',targetUrl=target)=>page.evaluate(inspectFacebookPage,{expectedAccount:actorId,expectedName:actorName,targetUrl,mode});
  const zeroClicks=async()=>assert.equal(await page.locator('[data-clicks]').count(),0,'A failed or read-only check must not click anything');
  const refuse=async(options,url=target,targetUrl=target)=>{
    await load(options,url);assert.equal((await inspect('click',targetUrl)).ok,false,JSON.stringify({options,url,targetUrl}));await zeroClicks();cases++;
  };

  for(const options of [{},{labelOnly:true},{button:'Follow'},{nestedControl:true},{hiddenDuplicate:true}]) {
    await load(options);
    assert.equal((await inspect()).state,'follow',JSON.stringify(options));await zeroClicks();
    assert.equal((await inspect('click')).state,'clicked');
    assert.equal((await inspect()).state,'following');
    assert.equal((await inspect('click')).state,'following');
    assert.equal(await page.locator('[data-target-control][data-clicks="1"]').count(),1);
    assert.equal(await page.locator('[data-feed-control][data-clicks]').count(),0);cases++;
  }
  for(const button of ['팔로잉','Following']) {
    await load({button,recommendations:['팔로우','Following']});
    assert.equal((await inspect('click')).state,'following');await zeroClicks();cases++;
  }
  for(const recommendationsAfterClick of [false,true]) {
    await load({recommendations:['팔로우','팔로잉'],recommendationsAfterClick});
    assert.equal((await inspect()).state,'follow');
    assert.equal((await inspect('click')).state,'clicked');
    assert.equal((await inspect()).state,'following','Suggestion buttons cannot hide the target result');
    assert.equal((await inspect('click')).state,'following');
    assert.equal(await page.locator('[data-target-control][data-clicks="1"]').count(),1);
    assert.equal(await page.locator('[data-recommendation-control][data-clicks]').count(),0);cases++;
  }
  for(const options of [
    {actor:'100009999999'},{nav:false},{hiddenNav:true},{duplicateActor:true},
    {stats:false},{foreignStats:true},{duplicateFollow:true},{disabled:true},
    {omitTarget:true,recommendations:['팔로우']},{omitTarget:true,recommendations:['팔로잉']},
    {postsInside:true},{visibleLogin:true},{challenge:true},
    {button:'좋아요'},{button:'Like'},{button:'친구 추가'},{button:'Add friend'},
    {button:'요청됨'},{button:'팔로우 취소'},{button:'Unfollow'}
  ]) await refuse(options);

  // Numeric profile URLs and /people/name/id redirects identify the same Page.
  for(const url of [numericTarget,'https://www.facebook.com/people/Reviewed-Studio/100001234567/']) {
    await load({numeric:true},url);
    assert.equal((await inspect('inspect',numericTarget)).state,'follow');await zeroClicks();
    assert.equal((await inspect('click',numericTarget)).state,'clicked');
    assert.equal((await inspect('inspect',numericTarget)).state,'following');cases++;
  }
  await refuse({numeric:true},numericTarget,target);
  await refuse({},'https://www.facebook.com/different.studio',target);
  for(const url of ['https://www.facebook.com/login/','https://www.facebook.com/checkpoint/','https://www.facebook.com/reviewed.studio/posts/fixture']) await refuse({},url,target);

  for(const url of [actorUrl,`https://www.facebook.com/profile.php?id=${actorId}`]) {
    await load({pageActor:true},url);
    const result=await inspect('actor');
    assert.equal(result.state,'actor_verified');assert.equal(result.actorId,actorId);await zeroClicks();cases++;
  }
  await load({pageActor:true,editText:'수정'},actorUrl);
  assert.equal((await inspect('actor')).state,'actor_verified','Visible 수정 link is identified by its 프로필 편집 accessible label');await zeroClicks();cases++;
  for(const options of [{actor:'100009999999'},{nav:false},{hiddenNav:true},{duplicateActor:true},{editLink:false},{wrongName:true}]) {
    await load({...options,pageActor:true},actorUrl);
    assert.equal((await inspect('actor')).ok,false,JSON.stringify(options));await zeroClicks();cases++;
  }

  console.log(`PASS ${cases} offline Chromium Facebook DOM fixtures: Page actor identity, numeric/people aliases, headerless profile, target-only buttons, suggestions/feed decoys, one click and following result, login/challenge/ambiguity guards. Blocked non-fixture requests: ${blockedRequests}. Actual Facebook requests and follows: 0.`);
} finally {await browser.close();}
