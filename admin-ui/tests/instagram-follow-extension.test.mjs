import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {EphemeralJobs,validatePreparation,canonicalProfile,isAdminUrl,MAX_TTL,messages} from '../../browser-tools/instagram-follow/core.mjs';
import {inspectInstagramPage} from '../../browser-tools/instagram-follow/dom-agent.mjs';

const origin='https://spymedia-backend.onrender.com';
const target='https://www.instagram.com/reviewed_studio/';
const prepare=(extra={})=>({source:'spymedia-admin-follow',type:'PREPARE',requestId:'12345678-1234-1234-1234-123456789012',platform:'instagram',expectedAccount:'spymedia_kr',profiles:[target],expiresAt:Date.now()+60000,...extra});

test('Instagram extension validates exact origin, bounded ephemeral selections and canonical profiles',()=>{
  assert.equal(isAdminUrl(origin+'/admin'),true);
  for(const url of [origin+'/admin/login',origin+'/admin/',origin+'.evil.invalid/admin','https://other.invalid/admin']) assert.equal(isAdminUrl(url),false);
  assert.equal(canonicalProfile(target),target);
  for(const url of ['https://www.instagram.com/accounts/','https://www.instagram.com/reel/','https://www.instagram.com/stories/','http://www.instagram.com/reviewed_studio/','https://www.instagram.com/reviewed_studio/?x=1','https://www.instagram.com/reviewed_studio/#x','https://www.instagram.com/UPPER/','https://www.instagram.com/a..b/','https://instagram.com/reviewed_studio/','https://www.instagram.com:444/reviewed_studio/','https://me:pass@www.instagram.com/reviewed_studio/']) assert.equal(canonicalProfile(url),null,url);
  assert.equal(validatePreparation(prepare()).ok,true);
  const bad=[{profiles:[]},{profiles:Array(11).fill(target)},{profiles:[target,target]},{profiles:['https://www.instagram.com/spymedia_kr/']},{expectedAccount:'someone_else'},{platform:'x'},{expiresAt:Date.now()-1},{expiresAt:Date.now()+MAX_TTL+10000},{token:'must-not-accept'},{requestId:'x'}];
  for(const extra of bad) assert.equal(validatePreparation(prepare(extra)).ok,false,JSON.stringify(extra));
});

test('jobs stay in memory, cancel only the originating admin tab and expire without resumable state',()=>{
  let now=1000;const store=new EphemeralJobs({now:()=>now,token:()=> 'random-capability'});
  const first=store.prepare(prepare({expiresAt:2000}),7);
  assert.equal(first.ok,true);assert.equal(store.prepare(prepare({expiresAt:2000}),7).code,'job_exists');
  assert.equal(store.prepare(prepare({expiresAt:2000}),8).code,'job_exists');
  store.cancelAdmin(8,first.job.requestId);assert.equal(store.get('random-capability'),first.job);
  now=2001;assert.equal(store.get('random-capability'),null);assert.deepEqual(first.job.profiles,[]);
  assert.deepEqual(first.job.results,[]);assert.equal(first.job.cancelled,true);
  assert.equal(new EphemeralJobs().get('random-capability'),null);
});

function element(label='',attrs={},children={}) {
  return {innerText:label,textContent:label,hidden:false,disabled:false,clicked:0,
    getAttribute:key=>attrs[key]??null,getClientRects:()=>[{}],
    querySelectorAll:selector=>children[selector]||[],click(){this.clicked++;this.innerText='Following';}};
}
function page({actor='spymedia_kr',actorLabel='Profile',name='reviewed_studio',button='Follow',url=target,restriction='',extraButtons=[],login=false,duplicateHeader=false,navMissing=false,clickChange='Following'}={}) {
  const follow=element(button),suggestion=element('Follow');
  follow.click=function(){this.clicked++;if(clickChange!==null)this.innerText=clickChange;};
  const header=element('',{}, {'h1,h2':[element(name)],'button,[role="button"]':[follow,...extraButtons.map(b=>element(b))]});
  const account=element(actorLabel,{href:`/${actor}/`});
  const document={body:element(restriction),querySelector:()=>login ? element(''):null,querySelectorAll:selector=>{
    if(selector==='nav a[href], aside a[href], [role="navigation"] a[href]')return navMissing?[]:[account];
    if(selector==='main header')return duplicateHeader?[header,header]:[header];
    if(selector==='button,[role="button"]')return [follow,suggestion];
    return [];
  }};
  return {document,location:new URL(url),follow,suggestion};
}
function inspect(p,mode='inspect') {
  return vm.runInNewContext(`(${inspectInstagramPage.toString()})({expectedAccount:'spymedia_kr',targetUrl:${JSON.stringify(target)},mode:${JSON.stringify(mode)}})`,{document:p.document,location:p.location,URL});
}

test('DOM agent validates acting account and target header before clicking exact follow once',()=>{
  const p=page();assert.equal(inspect(p).state,'follow');assert.equal(p.follow.clicked,0);
  assert.equal(inspect(p,'click').state,'clicked');assert.equal(p.follow.clicked,1);assert.equal(p.suggestion.clicked,0);
  assert.equal(inspect(p,'click').state,'following');assert.equal(p.follow.clicked,1);
  const ko=page({actorLabel:'프로필',button:'팔로우',clickChange:'요청됨'});
  assert.equal(inspect(ko,'click').state,'clicked');assert.equal(inspect(ko).state,'requested');
});

test('DOM agent never clicks following, requested, follow back, login, challenge or ambiguous controls',()=>{
  for(const [button,state] of [['Following','following'],['팔로잉','following'],['Requested','requested'],['요청됨','requested']]) {
    const p=page({button});assert.equal(inspect(p,'click').state,state);assert.equal(p.follow.clicked,0);
  }
  const cases=[
    [{actor:'another_account'},'account_mismatch'],[{navMissing:true},'account_unverified'],
    [{name:'other_profile'},'ambiguous_profile'],[{duplicateHeader:true},'ambiguous_profile'],
    [{button:'Follow back'},'ambiguous_profile'],[{button:'맞팔로우'},'ambiguous_profile'],
    [{extraButtons:['Follow']},'ambiguous_profile'],[{button:'Seguir'},'ambiguous_profile'],
    [{login:true},'login_required'],[{url:'https://www.instagram.com/accounts/login/'},'login_required'],
    [{url:'https://www.instagram.com/challenge/'},'challenge'],[{restriction:'Try again later'},'challenge'],
    [{restriction:'일부 활동을 제한합니다'},'challenge'],[{url:'https://www.instagram.com/other_profile/'},'wrong_profile']
  ];
  for(const [options,code] of cases) {const p=page(options);assert.equal(inspect(p,'click').code,code,JSON.stringify(options));assert.equal(p.follow.clicked,0);assert.equal(p.suggestion.clicked,0);}
});

async function mockBrowser(t,options={}) {
  const saved=globalThis.chrome, tabs=new Map([[1,{id:1,url:origin+'/admin',status:'complete'}]]),listeners={};let next=2;
  const p=page(options);let domCalls=0;
  const api={runtime:{getURL:file=>'chrome-extension://synthetic-extension/'+file,onMessage:{addListener:fn=>{listeners.message=fn;}}},
    tabs:{create:async attrs=>{const tab={id:next++,status:'complete',...attrs};tabs.set(tab.id,tab);return tab;},
      update:async(id,attrs)=>{Object.assign(tabs.get(id),attrs);return tabs.get(id);},get:async id=>{if(!tabs.has(id))throw Error('closed');return tabs.get(id);},
      onRemoved:{addListener:fn=>listeners.removed=fn},onUpdated:{addListener:fn=>listeners.updated=fn}},
    scripting:{executeScript:async({args})=>{domCalls++;return [{result:inspect(p,args[0].mode)}];}}};
  globalThis.chrome=api;t.after(()=>{globalThis.chrome=saved;});
  await import('../../browser-tools/instagram-follow/background.mjs?test='+Math.random());
  const send=(message,sender)=>new Promise(resolve=>listeners.message(message,sender,resolve));
  const admin={tab:tabs.get(1),frameId:0,url:origin+'/admin'};
  const response=await send({kind:'ADMIN_MESSAGE',message:prepare()},admin);
  assert.equal(response.ok,true);
  const runner=[...tabs.values()].find(tab=>tab.url.endsWith('/runner.html'));
  const sender={tab:runner,frameId:0,url:runner.url};
  const hello=await send({kind:'RUNNER_HELLO'},sender);assert.equal(hello.ok,true);
  const request=(kind,extra={})=>send({kind,capability:hello.capability,...extra},sender);
  return {tabs,p,listeners,send,admin,request,hello,domCalls:()=>domCalls};
}

test('mock Chrome flow requires explicit confirmation then records one follow and blocks duplicate step',async t=>{
  const b=await mockBrowser(t);
  assert.equal((await b.request('RUNNER_STEP',{index:0})).ok,false);assert.equal(b.domCalls(),0);
  assert.equal((await b.request('RUNNER_START',{confirmed:false})).ok,false);
  assert.equal((await b.request('RUNNER_START',{confirmed:true})).ok,true);
  const result=await b.request('RUNNER_STEP',{index:0});assert.equal(result.ok,true);assert.equal(result.result.state,'followed');assert.equal(result.done,true);
  assert.equal(b.p.follow.clicked,1);assert.equal((await b.request('RUNNER_STEP',{index:0})).ok,false);assert.equal(b.p.follow.clicked,1);
  assert.equal((await b.request('RUNNER_STOP')).ok,true);assert.equal((await b.request('RUNNER_HELLO')).code,'job_lost');
});

test('mock Chrome cancels on admin logout and does not click for wrong acting account',async t=>{
  const b=await mockBrowser(t,{actor:'someone_else'});
  await b.request('RUNNER_START',{confirmed:true});
  assert.equal((await b.request('RUNNER_STEP',{index:0})).code,'account_mismatch');assert.equal(b.p.follow.clicked,0);
  assert.equal((await b.request('RUNNER_START',{confirmed:true})).code,'not_confirmed');
  b.listeners.updated(1,{url:origin+'/admin/login'});
  assert.equal((await b.request('RUNNER_HELLO')).code,'job_lost');
});

test('mock Chrome stops on uncertain click outcome and never repeats the follow click',async t=>{
  const b=await mockBrowser(t,{clickChange:null});
  await b.request('RUNNER_START',{confirmed:true});
  assert.equal((await b.request('RUNNER_STEP',{index:0})).code,'uncertain');assert.equal(b.p.follow.clicked,1);
  assert.equal((await b.request('RUNNER_STEP',{index:0})).code,'not_confirmed');
  assert.equal((await b.request('RUNNER_START',{confirmed:true})).code,'not_confirmed');assert.equal(b.p.follow.clicked,1);
});

test('runner preserves partial outcomes on failure and clears all targets on administrator cancellation',async()=>{
  const source=(await fs.readFile(new URL('../../browser-tools/instagram-follow/runner.mjs',import.meta.url),'utf8')).replace(/^import .*?;\r?\n/,'');
  const node=()=>({children:[],listeners:{},disabled:false,checked:false,textContent:'',addEventListener(name,fn){this.listeners[name]=fn;},append(...items){this.children.push(...items);},replaceChildren(){this.children=[];},querySelector(){return this.children[1];}});
  const ids=['targets','confirmed','start','stop','status','expiry'],ui=Object.fromEntries(ids.map(id=>[id,node()]));
  const intervals=[],timers=[],sent=[];let adminAlive=true;
  const runtime={sendMessage:async m=>{
    sent.push(m);
    if(m.kind==='RUNNER_HELLO')return {ok:true,capability:'synthetic-capability',job:{profiles:[target,'https://www.instagram.com/second_studio/'],expiresAt:Date.now()+60000,results:[]}};
    if(m.kind==='RUNNER_STEP')return m.index===0?{ok:true,result:{index:0,state:'followed'},done:false}:{ok:false,code:'uncertain'};
    if(m.kind==='RUNNER_PING')return adminAlive?{ok:true}:{ok:false,code:'job_lost'};
    return {ok:true};
  }};
  await vm.runInNewContext(`(async()=>{${source}})()`,{messages,document:{getElementById:id=>ui[id],createElement:node},window:{addEventListener(){}},chrome:{runtime},URL,Date,setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},setInterval:fn=>{intervals.push(fn);return intervals.length;},clearInterval(){}});
  ui.confirmed.checked=true;ui.confirmed.listeners.change();await ui.start.listeners.click();
  assert.equal(ui.targets.children.length,2);assert.equal(ui.targets.children[0].children[1].textContent,'팔로우 완료');
  assert.equal(ui.targets.children[1].children[1].textContent,'확인 필요 · 자동 재시도 안 함');
  assert.equal(ui.status.textContent,messages.uncertain);assert.equal(ui.start.disabled,true);
  await ui.start.listeners.click();assert.equal(sent.filter(m=>m.kind==='RUNNER_STEP').length,2);
  adminAlive=false;await intervals[0]();assert.equal(ui.targets.children.length,0);assert.equal(ui.stop.disabled,true);
});

test('bridge authenticates message source and never forwards another origin, subframe or unbounded selection',async()=>{
  const source=await fs.readFile(new URL('../../browser-tools/instagram-follow/bridge.js',import.meta.url),'utf8');
  const handlers={},calls=[],replies=[],win={postMessage:(...args)=>replies.push(args),addEventListener:(name,fn)=>handlers[name]=fn};win.top=win;
  vm.runInNewContext(source,{location:{origin,pathname:'/admin'},window:win,chrome:{runtime:{sendMessage:async m=>{calls.push(m);return {ok:true};}}}});
  const ping={source:'spymedia-admin-follow',type:'PING',requestId:'abcdefgh'};
  await handlers.message({source:{},origin,data:ping});await handlers.message({source:win,origin:'https://evil.invalid',data:ping});assert.equal(calls.length,0);
  await handlers.message({source:win,origin,data:ping});assert.equal(replies[0][0].type,'READY');
  await handlers.message({source:win,origin,data:prepare({profiles:Array(11).fill(target)})});assert.equal(replies.at(-1)[0].type,'ERROR');assert.equal(calls.length,1);
  await handlers.message({source:win,origin,data:prepare()});handlers.pagehide();assert.equal(calls.at(-1).message.type,'CANCEL');
});

test('extension has only scoped host access and no persistence or private API code',async()=>{
  const base=new URL('../../browser-tools/instagram-follow/',import.meta.url);
  const manifest=JSON.parse(await fs.readFile(new URL('manifest.json',base),'utf8'));
  assert.deepEqual(manifest.permissions,['scripting']);assert.equal(manifest.host_permissions.includes('<all_urls>'),false);
  assert.equal(manifest.content_scripts[0].all_frames,false);
  const files=['core.mjs','background.mjs','bridge.js','runner.mjs','dom-agent.mjs'];
  const all=(await Promise.all(files.map(file=>fs.readFile(new URL(file,base),'utf8')))).join('\n');
  for(const forbidden of ['chrome.storage','localStorage','sessionStorage','indexedDB','document.cookie','console.log','fetch(','XMLHttpRequest','api/v1/']) assert.equal(all.includes(forbidden),false,forbidden);
});
