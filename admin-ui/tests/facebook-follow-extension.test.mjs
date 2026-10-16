import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {EphemeralJobs,isAdminUrl,ACTOR,ACTOR_NAME,SOURCE,FACEBOOK_ORIGIN,VERSION,MAX_TTL,canonicalProfile,validatePreparation,validateAdminCommand} from '../../browser-tools/facebook-follow/core.mjs';

const origin='https://spymedia-backend.onrender.com';
const target='https://www.facebook.com/reviewed.studio';
const second='https://www.facebook.com/profile.php?id=100000000000002';
const actorUrl=FACEBOOK_ORIGIN+'/me/';
const requestId='admin-facebook-follow-test';
const actor={ok:true,state:'actor_verified',actorId:ACTOR};
const prep=(extra={})=>({source:SOURCE,type:'PREPARE',requestId,platform:'facebook',expectedAccount:ACTOR,profiles:[target],expiresAt:61000,control:'admin',...extra});
const backgroundSource=(await fs.readFile(new URL('../../browser-tools/facebook-follow/background.mjs',import.meta.url),'utf8')).replace(/^import .*?;\r?\n/gm,'');

async function browser(options={}){
  let now=1000,next=3,hook=null;
  const tabs=new Map([[1,{id:1,url:origin+'/admin',status:'complete'}],[2,{id:2,url:origin+'/admin',status:'complete'}]]),events={},navigations=[],calls=[],waits=[],clicked=new Set();
  const responses=[...(options.responses||[])];
  const chrome={runtime:{onMessage:{addListener:fn=>events.message=fn}},tabs:{
    create:async attrs=>{const tab={id:next++,...attrs,status:'complete'};tabs.set(tab.id,tab);navigations.push({kind:'create',...attrs});return tab;},
    update:async(id,attrs)=>{Object.assign(tabs.get(id),attrs);navigations.push({kind:'update',...attrs});return tabs.get(id);},
    get:async id=>{if(!tabs.has(id))throw Error('closed');return tabs.get(id);},onRemoved:{addListener:fn=>events.removed=fn},onUpdated:{addListener:fn=>events.updated=fn}},
    scripting:{executeScript:async({target:frame,args})=>{
      assert.deepEqual(Array.from(frame.frameIds),[0]);
      const detail=args[0];calls.push(detail);if(hook)await hook(detail);
      const result=responses.length?responses.shift():detail.mode==='actor'?actor:detail.mode==='click'?(clicked.add(detail.targetUrl),{ok:true,state:'clicked'}):{ok:true,state:clicked.has(detail.targetUrl)?'following':'follow'};
      return [{result}];
    }}};
  class MemoryJobs extends EphemeralJobs{constructor(){super({now:()=>now,token:()=> 'memory-only-facebook-capability'});}}
  vm.runInNewContext(backgroundSource,{EphemeralJobs:MemoryJobs,isAdminUrl,ACTOR,ACTOR_NAME,SOURCE,FACEBOOK_ORIGIN,validateAdminCommand,inspectFacebookPage:()=>{},chrome,Date:{now:()=>now},setTimeout:(fn,ms)=>{waits.push(ms);queueMicrotask(()=>{now+=ms;fn();});}});
  const send=(m,tabId=1,extra={})=>new Promise(resolve=>events.message({kind:'ADMIN_MESSAGE',message:m},{tab:tabs.get(tabId),frameId:0,url:tabs.get(tabId).url,...extra},resolve));
  const command=(type,extra={},tabId=1)=>send({source:SOURCE,type,requestId,...extra},tabId);
  return {send,command,tabs,events,calls,waits,navigations,setNow:value=>now=value,now:()=>now,setHook:fn=>hook=fn};
}

test('Facebook extension accepts exact canonical profiles and a fixed actor in admin-only preparations',()=>{
  for(const url of [target,second,'https://www.facebook.com/a.b123'])assert.equal(canonicalProfile(url),url);
  const invalid=['https://www.facebook.com/me','https://www.facebook.com/me/','https://www.facebook.com/123','https://www.facebook.com/UPPER','https://www.facebook.com/a/','https://www.facebook.com/...','https://www.facebook.com/groups','https://www.facebook.com/pages','https://www.facebook.com/events','https://www.facebook.com/watch','https://www.facebook.com/reel/123','https://www.facebook.com/a/posts/123','https://www.facebook.com/search','https://www.facebook.com/profile.php?id=1&id=2','https://www.facebook.com/profile.php?id=1&x=2','https://www.facebook.com/profile.php?x=2&id=1','https://www.facebook.com/profile.php?id=1#x','https://www.facebook.com/%61','https://facebook.com/name','https://m.facebook.com/name','http://www.facebook.com/name','https://u:p@www.facebook.com/name','https://www.facebook.com:444/name',target+'?x=1'];
  for(const url of invalid)assert.equal(canonicalProfile(url),null,url);
  assert.equal(validatePreparation(prep(),1000).ok,true);
  const failures=[{control:undefined},{control:'runner'},{source:'spymedia-admin-follow'},{platform:'instagram'},{expectedAccount:'someone_else'},{profiles:[]},{profiles:Array(11).fill(target)},{profiles:[target,target]},{profiles:[FACEBOOK_ORIGIN+'/profile.php?id='+ACTOR]},{expiresAt:1000},{expiresAt:1001+MAX_TTL},{token:'private'},{requestId:'short'}];
  for(const extra of failures)assert.equal(validatePreparation(prep(extra),1000).ok,false,JSON.stringify(extra));
  assert.equal(isAdminUrl(origin+'/admin#sns-accounts'),true);
  for(const url of [origin+'/admin/login',origin+'/admin/',origin+'.invalid/admin','http://spymedia-backend.onrender.com/admin'])assert.equal(isAdminUrl(url),false);
});

test('Facebook commands enforce exact keys and confirmations and never accept Instagram messages',()=>{
  for(const [type,extra]of [['PING',{}],['CANCEL',{}],['STATUS',{}],['START',{confirmed:true}],['STEP',{index:0}]])assert.equal(validateAdminCommand({source:SOURCE,type,requestId,...extra}).ok,true);
  for(const [type,extra]of [['START',{confirmed:false}],['STEP',{index:-1}],['STEP',{index:10}],['STEP',{index:'0'}],['STATUS',{token:'x'}],['constructor',{}],['toString',{}]])assert.equal(validateAdminCommand({source:SOURCE,type,requestId,...extra}).ok,false);
  assert.equal(validateAdminCommand({source:'spymedia-admin-follow',type:'PING',requestId}).ok,false);
});

test('ephemeral ownership, expiration and worker restart never resume a Facebook job',()=>{
  let now=1000;const jobs=new EphemeralJobs({now:()=>now,token:()=> 'capability'}),first=jobs.prepare(prep({expiresAt:2000}),7);
  assert.equal(first.ok,true);assert.equal(jobs.prepare(prep({expiresAt:2000}),8).code,'job_exists');
  jobs.cancelAdmin(8,requestId);assert.equal(jobs.get('capability'),first.job);
  now=2001;assert.equal(jobs.get('capability'),null);assert.deepEqual(first.job.profiles,[]);assert.deepEqual(first.job.results,[]);
  assert.equal(new EphemeralJobs().get('capability'),null);
});

test('every target resolves /me/ and verifies the fixed Page before one selected follow',async()=>{
  const b=await browser();assert.equal((await b.command('PING')).ok,true);
  const prepared=await b.send(prep({profiles:[target,second]}));assert.equal(prepared.ok,true);assert.equal(b.navigations.length,0);
  assert.equal(prepared.job.expectedAccount,ACTOR);assert.equal(prepared.job.expectedName,ACTOR_NAME);assert.equal('capability' in prepared.job,false);
  assert.equal((await b.command('STEP',{index:0})).code,'not_confirmed');assert.equal(b.calls.length,0);
  await b.command('START',{confirmed:true});
  for(let index=0;index<2;index++){const result=await b.command('STEP',{index});assert.equal(result.ok,true);assert.equal(result.job.results[index].state,'followed');}
  assert.deepEqual(b.navigations.filter(n=>n.kind==='update').map(n=>n.url),[actorUrl,target,actorUrl,second]);
  assert.deepEqual(b.calls.map(c=>c.mode),['actor','inspect','click','inspect','actor','inspect','click','inspect']);
  assert.ok(b.calls.every(c=>c.expectedAccount===ACTOR&&c.expectedName===ACTOR_NAME));
  assert.ok(b.navigations.every(n=>n.active===false));assert.equal((await b.command('STEP',{index:1})).code,'not_confirmed');
  assert.equal(b.calls.filter(c=>c.mode==='click').length,2);
});

test('wrong actor or malformed actor evidence stops before navigating to any target',async()=>{
  for(const evidence of [{ok:true,state:'actor_verified',actorId:'wrong'},{ok:true,state:'following',actorId:ACTOR},{ok:false,code:'account_mismatch'},{ok:false,code:'login_required'},{ok:false,code:'challenge'}]){
    const b=await browser({responses:[evidence]});await b.send(prep());await b.command('START',{confirmed:true});
    const result=await b.command('STEP',{index:0});assert.equal(result.ok,false);assert.equal(b.calls.length,1);assert.equal(b.calls[0].mode,'actor');
    assert.deepEqual(b.navigations.filter(n=>n.kind==='update').map(n=>n.url),[actorUrl]);
    assert.equal((await b.command('STATUS')).job.running,false);assert.equal((await b.command('STEP',{index:0})).code,'not_confirmed');
  }
});

test('existing following is read-only and unrecognized relationships cannot become successes',async()=>{
  for(const state of ['following']){
    const b=await browser({responses:[actor,{ok:true,state}]});await b.send(prep());await b.command('START',{confirmed:true});
    assert.equal((await b.command('STEP',{index:0})).job.results[0].state,state);assert.equal(b.calls.some(c=>c.mode==='click'),false);
  }
  for(const state of ['liked','friend_requested','requested','request_sent','success']){
    const b=await browser({responses:[actor,{ok:true,state}]});await b.send(prep());await b.command('START',{confirmed:true});
    assert.equal((await b.command('STEP',{index:0})).code,'browser_error');assert.equal(b.calls.some(c=>c.mode==='click'),false);
  }
});

test('global ownership, strict top-frame origin and repeated START/STEP cannot duplicate follows',async()=>{
  const b=await browser();await b.send(prep({profiles:[target,second]}));
  assert.equal((await b.send(prep({requestId:'another-request'}),2)).code,'job_exists');
  assert.equal((await b.command('START',{confirmed:true},2)).code,'job_lost');
  assert.equal((await b.send({source:SOURCE,type:'STATUS',requestId},1,{frameId:1})).code,'invalid_message');
  assert.equal((await b.send({source:SOURCE,type:'STATUS',requestId},1,{url:origin+'/admin/login'})).code,'invalid_message');
  assert.equal((await b.send({source:'spymedia-admin-follow',type:'PING',requestId})).code,'invalid_message');
  const starts=await Promise.all([b.command('START',{confirmed:true}),b.command('START',{confirmed:true})]);assert.equal(starts.filter(r=>r.ok).length,1);
  const steps=await Promise.all([b.command('STEP',{index:0}),b.command('STEP',{index:0})]);assert.equal(steps.filter(r=>r.ok).length,1);
  assert.equal(b.calls.filter(c=>c.mode==='click').length,1);assert.equal((await b.command('STEP',{index:0})).code,'not_confirmed');
});

test('hydration and result reads are bounded and a transient replacement never repeats a click',async()=>{
  const b=await browser({responses:[{ok:false,code:'account_unverified'},actor,{ok:false,code:'ambiguous_profile'},{ok:true,state:'follow'},{ok:true,state:'clicked'},{ok:false,code:'ambiguous_profile'},{ok:true,state:'follow'},{ok:true,state:'following'}]});
  await b.send(prep());await b.command('START',{confirmed:true});assert.equal((await b.command('STEP',{index:0})).job.results[0].state,'followed');
  assert.deepEqual(b.calls.map(c=>c.mode),['actor','actor','inspect','inspect','click','inspect','inspect','inspect']);assert.equal(b.calls.filter(c=>c.mode==='click').length,1);
  const unresolved=await browser({responses:Array.from({length:17},()=>({ok:false,code:'account_unverified'}))});await unresolved.send(prep());await unresolved.command('START',{confirmed:true});
  assert.equal((await unresolved.command('STEP',{index:0})).code,'account_unverified');assert.equal(unresolved.calls.length,17);assert.equal(unresolved.calls.some(c=>c.mode==='click'),false);
});

test('post-click uncertainty is terminal and preserves earlier confirmed outcomes',async()=>{
  const b=await browser({responses:[actor,{ok:true,state:'following'},actor,{ok:true,state:'follow'},{ok:true,state:'clicked'},...Array.from({length:16},()=>({ok:false,code:'ambiguous_profile'}))]});
  await b.send(prep({profiles:[target,second]}));await b.command('START',{confirmed:true});
  assert.equal((await b.command('STEP',{index:0})).job.results[0].state,'following');assert.equal((await b.command('STEP',{index:1})).code,'uncertain');
  const state=(await b.command('STATUS')).job;assert.equal(state.index,1);assert.equal(state.results.length,1);assert.equal(state.terminalError,'uncertain');
  assert.equal((await b.command('STEP',{index:1})).code,'not_confirmed');assert.equal((await b.command('START',{confirmed:true})).code,'not_confirmed');assert.equal(b.calls.filter(c=>c.mode==='click').length,1);
});

test('authentication, restriction or identity failures after click halt on the first result read',async()=>{
  for(const code of ['login_required','challenge','account_mismatch','wrong_profile','browser_error','unsupported_language']){
    const b=await browser({responses:[actor,{ok:true,state:'follow'},{ok:true,state:'clicked'},{ok:false,code}]});await b.send(prep());await b.command('START',{confirmed:true});
    assert.equal((await b.command('STEP',{index:0})).code,code);assert.equal(b.calls.length,4);assert.equal(b.calls.filter(c=>c.mode==='click').length,1);
    assert.equal((await b.command('STEP',{index:0})).code,'not_confirmed');
  }
});

test('expiration, owner navigation, closed tabs and cancellation stop outstanding work',async()=>{
  const expired=await browser();await expired.send(prep({expiresAt:1300}));await expired.command('START',{confirmed:true});expired.setNow(1301);
  assert.equal((await expired.command('STEP',{index:0})).code,'job_lost');assert.equal(expired.calls.length,0);
  const cancelled=await browser();await cancelled.send(prep());await cancelled.command('START',{confirmed:true});cancelled.setHook(async()=>{await cancelled.command('CANCEL');});
  assert.equal((await cancelled.command('STEP',{index:0})).code,'job_lost');assert.equal(cancelled.calls.some(c=>c.mode==='click'),false);
  const left=await browser();await left.send(prep());left.events.updated(1,{url:origin+'/admin/login'});assert.equal((await left.command('STATUS')).code,'job_lost');
  const closed=await browser();await closed.send(prep());closed.events.removed(1);assert.equal((await closed.command('STATUS')).code,'job_lost');
});

test('Facebook bridge isolates its namespace, restricts sender, versions every result and cancels on departure',async()=>{
  const script=await fs.readFile(new URL('../../browser-tools/facebook-follow/bridge.js',import.meta.url),'utf8');
  const handlers={},calls=[],replies=[],win={postMessage:m=>replies.push(m),addEventListener:(name,fn)=>handlers[name]=fn};win.top=win;
  const job={expectedAccount:ACTOR,expectedName:ACTOR_NAME,profiles:[target],expiresAt:61000,index:0,started:false,running:false,terminalError:null,results:[]};
  vm.runInNewContext(script,{location:{origin,pathname:'/admin'},window:win,chrome:{runtime:{sendMessage:async m=>{calls.push(m);return ['PREPARE','START','STEP','STATUS'].includes(m.message.type)?{ok:true,job}:{ok:true};}}}});
  const send=(m,extra={})=>handlers.message({source:win,origin,data:m,...extra});
  await send({source:'spymedia-admin-follow',type:'PING',requestId});assert.equal(calls.length,0);
  await send({source:SOURCE,type:'PING',requestId},{origin:'https://evil.invalid'});assert.equal(calls.length,0);
  await send({source:SOURCE,type:'PING',requestId},{source:{}});assert.equal(calls.length,0);
  await send({source:SOURCE,type:'PING',requestId});assert.equal(replies.at(-1).type,'READY');assert.equal(replies.at(-1).version,VERSION);assert.equal(replies.at(-1).source,'spymedia-facebook-follow-extension');
  for(const m of [prep(),{source:SOURCE,type:'START',requestId,confirmed:true},{source:SOURCE,type:'STEP',requestId,index:0},{source:SOURCE,type:'STATUS',requestId}]){await send(m);assert.equal(replies.at(-1).type,'STATE');assert.equal(replies.at(-1).action,m.type);assert.equal(replies.at(-1).requestId,requestId);}
  const before=calls.length;await send({source:SOURCE,type:'START',requestId,confirmed:true,token:'private'});assert.equal(calls.length,before);assert.equal(replies.at(-1).type,'ERROR');
  handlers.pagehide();assert.equal(calls.at(-1).message.type,'CANCEL');assert.equal(calls.at(-1).message.source,SOURCE);
});

test('Facebook manifest limits permissions to its two hosts and does not modify Instagram grants',async()=>{
  const manifest=JSON.parse(await fs.readFile(new URL('../../browser-tools/facebook-follow/manifest.json',import.meta.url),'utf8'));
  assert.equal(manifest.version,VERSION);assert.deepEqual(manifest.permissions,['scripting']);
  assert.deepEqual(manifest.host_permissions,[FACEBOOK_ORIGIN+'/*',origin+'/*']);assert.equal(manifest.content_scripts[0].all_frames,false);
  assert.equal(manifest.background.type,'module');assert.deepEqual(manifest.content_scripts[0].matches,[origin+'/admin*']);
});
