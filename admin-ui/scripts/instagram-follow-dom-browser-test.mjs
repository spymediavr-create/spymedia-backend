import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {inspectInstagramPage} from '../../browser-tools/instagram-follow/dom-agent.mjs';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const target='https://www.instagram.com/reviewed_studio/';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium'});
let cases=0;
function fixture({actor='spymedia_kr',alt,svg=false,semantic=false,headerless=true,decoy=false,nav=true,hiddenNav=false,duplicateActor=false,duplicateFollow=false,stats=true,postsInside=false,absolutePost=false,button='팔로우',visibleLogin=false,wrongTitle=false,recommendations=[],recommendationDivs=false,recommendationsAfterClick=false,nestedControl=false,omitTarget=false,socialProof=false}={}) {
  const account=(name,hide=false)=>`<a ${hide?'style="display:none"':''} href="/${name}/">${svg?'<svg width="20" height="20"><title>프로필</title></svg>':`<img width="20" height="20" alt="${alt??name+"님의 프로필 사진"}" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==">`}</a>`;
  const navTag=semantic?'nav':'div';
  const rail=nav?`<${navTag} style="position:fixed;left:0;top:0;width:70px;${hiddenNav?'display:none;':''}"><a href="/">홈</a><div><a href="/reels/">릴스</a></div><a href="/direct/inbox/">메시지</a>${account(actor)}${duplicateActor?account('another_account'):account('hidden_account',true)}</${navTag}>`:'';
  const tag=headerless?'div':'header';
  const listTag=recommendationDivs?'div':'ul',cardTag=recommendationDivs?'div':'li';
  const suggestions=`<section data-recommendations><h3>회원님을 위한 추천</h3><${listTag}>${recommendations.map((label,index)=>`<${cardTag} data-recommendation-card><a href="/recommended_${index}/">recommended_${index}</a><button data-recommendation-control onclick="this.dataset.clicks=String(Number(this.dataset.clicks||0)+1);this.textContent='팔로잉'">${label}</button></${cardTag}>`).join('')}</${listTag}></section>`;
  const clickScript="this.dataset.clicks=String(Number(this.dataset.clicks||0)+1);this.textContent='팔로잉'"+(recommendationsAfterClick?";document.getElementById('profile').append(document.getElementById('recommendation-template').content.cloneNode(true))":'');
  const targetButton=`<button data-target-control onclick="${clickScript}">${button}</button>`;
  const control=omitTarget?'':nestedControl?`<div role="button">${targetButton}</div>`:targetButton;
  const proof=socialProof?'<div>촬영 문의 <a href="/partner_studio/">partner_studio</a></div><div><a href="/friend_one/">friend_one</a>님과 <a href="/friend_two/">friend_two</a>님이 팔로우합니다</div>':'';
  return `<!doctype html><meta charset="utf-8"><style>main{margin-left:100px}a,button{display:inline-block;margin:6px;padding:8px}img{display:inline-block}</style>${rail}<main><${tag} id="profile"><div><h2>${wrongTitle?'other_studio':'reviewed_studio'}</h2></div>${stats?'<a href="/reviewed_studio/followers/">팔로워 100</a><a href="/reviewed_studio/following/">팔로우 200</a>':''}${proof}<div>${absolutePost?'추천 계정 <a href="https://www.instagram.com/p/synthetic/">게시물</a>':''}${control}${duplicateFollow?control:''}</div>${recommendations.length&&!recommendationsAfterClick?suggestions:''}${postsInside?'<article>추천 계정 <a href="/p/synthetic/">게시물</a></article>':''}</${tag}><article>${decoy?account('spymedia_kr'):''}<button>팔로우</button><a href="/p/fixture/">합성 게시물</a></article></main>${recommendationsAfterClick?`<template id="recommendation-template">${suggestions}</template>`:''}${visibleLogin?'<input name="username"><input name="password" type="password">':''}`;
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
  // Instagram inserts recommendation cards inside the same profile header after
  // following. Their buttons must neither invalidate nor impersonate the target.
  for(const headerless of [false,true]) {
    for(const recommendationDivs of [false,true]) {
      const common={semantic:true,headerless,recommendationDivs,socialProof:true};
      for(const [button,state] of [['팔로잉','following'],['요청됨','requested']]) {
        const options={...common,button,recommendations:['팔로우','팔로우']};
        await load(options);assert.equal((await inspect('inspect')).state,state,JSON.stringify(options));
        assert.equal((await inspect('click')).state,state);assert.equal(await page.locator('[data-clicks]').count(),0);cases++;
      }
      await load({...common,recommendations:['팔로잉','요청됨']});
      assert.equal((await inspect('inspect')).state,'follow','A recommendation relationship is not the target relationship');
      assert.equal((await inspect('click')).state,'clicked');
      assert.equal((await inspect('inspect')).state,'following');
      assert.equal(await page.locator('[data-target-control][data-clicks="1"]').count(),1);
      assert.equal(await page.locator('[data-recommendation-control][data-clicks]').count(),0);cases++;

      await load({...common,recommendations:['팔로우','팔로우'],recommendationsAfterClick:true});
      assert.equal(await page.locator('[data-recommendation-control]').count(),0);
      assert.equal((await inspect('click')).state,'clicked');
      assert.equal(await page.locator('[data-recommendation-control]').count(),2);
      assert.equal((await inspect('inspect')).state,'following','New suggestions must not hide a successful follow');
      assert.equal((await inspect('click')).state,'following');
      assert.equal(await page.locator('[data-target-control][data-clicks="1"]').count(),1);
      assert.equal(await page.locator('[data-recommendation-control][data-clicks]').count(),0);cases++;

      for(const options of [
        {...common,duplicateFollow:true,recommendations:['팔로우']},
        {...common,omitTarget:true,recommendations:['팔로우']},
        {...common,omitTarget:true,recommendations:['팔로잉']}
      ]) {
        await load(options);assert.equal((await inspect('click')).ok,false,JSON.stringify(options));
        assert.equal(await page.locator('[data-clicks]').count(),0);cases++;
      }
      await load({...common,nestedControl:true,recommendations:['팔로우']});
      assert.equal((await inspect('click')).state,'clicked','One native button nested in a role wrapper is one action');
      assert.equal((await inspect('inspect')).state,'following');
      assert.equal((await inspect('click')).state,'following');
      assert.equal(await page.locator('[data-target-control][data-clicks="1"]').count(),1);
      assert.equal(await page.locator('[data-recommendation-control][data-clicks]').count(),0);cases++;
    }
  }
  // A recommendation's profile link can itself wrap its button directly under
  // the header, without a separate list item or card container.
  for(const omitTarget of [true,false]) {
    await load({semantic:true,headerless:false,omitTarget,button:'팔로잉'});
    await page.evaluate(()=>{
      const profileLink=document.createElement('a');
      profileLink.href='/recommended/';
      const recommendationButton=document.createElement('div');
      recommendationButton.setAttribute('role','button');
      recommendationButton.setAttribute('data-recommendation-control','');
      recommendationButton.textContent='팔로우';
      recommendationButton.addEventListener('click',event=>{
        event.preventDefault();
        recommendationButton.dataset.clicks=String(Number(recommendationButton.dataset.clicks||0)+1);
      });
      profileLink.append(recommendationButton);
      document.getElementById('profile').append(profileLink);
    });
    const result=await inspect('click');
    if(omitTarget) assert.equal(result.ok,false,'A foreign anchor cannot substitute for a missing target control');
    else assert.equal(result.state,'following','A foreign anchor cannot invalidate the target following state');
    assert.equal(await page.locator('[data-clicks]').count(),0);cases++;
  }
  console.log(`PASS ${cases} real Chromium DOM fixtures: icon rail, translated avatar labels, headerless profile, recommendation cards before/after click, target-only relationship results, wrong-account/decoy/ambiguity guards, no repeated click. Actual Instagram requests and follows: 0.`);
} finally { await browser.close(); }
