import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {inspectInstagramPage} from '../../browser-tools/instagram-follow/dom-agent.mjs';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const target='https://www.instagram.com/reviewed_studio/';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium'});
let cases=0;
function fixture({actor='spymedia_kr',alt,svg=false,semantic=false,headerless=true,decoy=false,nav=true,hiddenNav=false,duplicateActor=false,duplicateFollow=false,stats=true,postsInside=false,absolutePost=false,button='팔로우',visibleLogin=false,wrongTitle=false}={}) {
  const account=(name,hide=false)=>`<a ${hide?'style="display:none"':''} href="/${name}/">${svg?'<svg width="20" height="20"><title>프로필</title></svg>':`<img width="20" height="20" alt="${alt??name+"님의 프로필 사진"}" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==">`}</a>`;
  const navTag=semantic?'nav':'div';
  const rail=nav?`<${navTag} style="position:fixed;left:0;top:0;width:70px;${hiddenNav?'display:none;':''}"><a href="/">홈</a><div><a href="/reels/">릴스</a></div><a href="/direct/inbox/">메시지</a>${account(actor)}${duplicateActor?account('another_account'):account('hidden_account',true)}</${navTag}>`:'';
  const tag=headerless?'div':'header';
  const control=`<button onclick="this.dataset.clicks=String(Number(this.dataset.clicks||0)+1);this.textContent='팔로잉'">${button}</button>`;
  return `<!doctype html><meta charset="utf-8"><style>main{margin-left:100px}a,button{display:inline-block;margin:6px;padding:8px}img{display:inline-block}</style>${rail}<main><${tag} id="profile"><div><h2>${wrongTitle?'other_studio':'reviewed_studio'}</h2></div>${stats?'<a href="/reviewed_studio/followers/">팔로워 100</a><a href="/reviewed_studio/following/">팔로우 200</a>':''}<div>${absolutePost?'추천 계정 <a href="https://www.instagram.com/p/synthetic/">게시물</a>':''}${control}${duplicateFollow?control:''}</div>${postsInside?'<article>추천 계정 <a href="/p/synthetic/">게시물</a></article>':''}</${tag}><article>${decoy?account('spymedia_kr'):''}<button>팔로우</button><a href="/p/fixture/">합성 게시물</a></article></main>${visibleLogin?'<input name="username"><input name="password" type="password">':''}`;
}
try {
  const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
  let html='';
  await context.route('**/*',route=>route.request().isNavigationRequest()&&route.request().url()===target?route.fulfill({status:200,contentType:'text/html',body:html}):route.abort());
  const load=async options=>{html=fixture(options);await page.goto(target);};
  const inspect=mode=>page.evaluate(inspectInstagramPage,{expectedAccount:'spymedia_kr',targetUrl:target,mode});
  for(const options of [{},{svg:true},{alt:"spymedia_kr's profile picture"},{semantic:true,headerless:false},{alt:'spymedia_kr님의 프로필사진'}]) {
    await load(options);assert.equal((await inspect('inspect')).state,'follow');assert.equal(await page.locator('[data-clicks]').count(),0);
    assert.equal((await inspect('click')).state,'clicked');assert.equal((await inspect('inspect')).state,'following');
    assert.equal((await inspect('click')).state,'following');assert.equal(await page.locator('[data-clicks="1"]').count(),1);cases++;
  }
  for(const [options,code] of [
    [{actor:'different_account'},'account_mismatch'],[{nav:false,decoy:true},'account_unverified'],
    [{hiddenNav:true,decoy:true},'account_unverified'],[{duplicateActor:true},'account_unverified'],
    [{alt:'unrelated_person님의 프로필 사진'},'account_unverified'],[{stats:false},'ambiguous_profile'],
    [{duplicateFollow:true},'ambiguous_profile'],[{postsInside:true},'ambiguous_profile'],[{absolutePost:true},'ambiguous_profile'],
    [{visibleLogin:true},'login_required'],[{wrongTitle:true},'ambiguous_profile'],[{button:'맞팔로우'},'ambiguous_profile']
  ]) {
    await load(options);assert.equal((await inspect('click')).code,code,JSON.stringify(options));assert.equal(await page.locator('[data-clicks]').count(),0);cases++;
  }
  for(const [button,state] of [['팔로잉','following'],['요청됨','requested']]) {
    await load({button});assert.equal((await inspect('click')).state,state);assert.equal(await page.locator('[data-clicks]').count(),0);cases++;
  }
  console.log(`PASS ${cases} real Chromium DOM fixtures: icon rail, translated avatar labels, headerless profile, wrong-account/decoy/ambiguity guards, no repeated click. Actual Instagram requests and follows: 0.`);
} finally { await browser.close(); }
