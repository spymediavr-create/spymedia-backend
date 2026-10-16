import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {EphemeralJobs,isAdminUrl,ACTOR,VERSION,validatePreparation,validateAdminCommand} from '../../browser-tools/instagram-follow/core.mjs';

const origin='https://spymedia-backend.onrender.com';
const target='https://www.instagram.com/reviewed_studio/';
const second='https://www.instagram.com/second_studio/';
const source='spymedia-admin-follow';
const requestId='admin-follow-test-request';
const prep=(extra={})=>({source,type:'PREPARE',requestId,platform:'instagram',expectedAccount:ACTOR,profiles:[target],expiresAt:61000,control:'admin',...extra});
const backgroundSource=(await fs.readFile(new URL('../../browser-tools/instagram-follow/background.mjs',import.meta.url),'utf8')).replace(/^import .*?;\r?\n/gm,'');

async function browser(options={}) {
  let now=1000,next=3,hook=null;
  const tabs=new Map([[1,{id:1,url:origin+'/admin',status:'complete'}],[2,{id:2,url:origin+'/admin',status:'complete'}]]),events={},navigations=[],calls=[],waits=[];
  const responseQueue=[...(options.responses||[])];
  const chrome={runtime:{getURL:file=>'chrome-extension://fixture/'+file,onMessage:{addListener:fn=>events.message=fn}},
    tabs:{create:async attrs=>{const tab={id:next++,...attrs,status:'complete'};tabs.set(tab.id,tab);navigations.push({kind:'create',...attrs});return tab;},
      update:async(id,attrs)=>{Object.assign(tabs.get(id),attrs);navigations.push({kind:'update',...attrs});return tabs.get(id);},
      get:async id=>{if(!tabs.has(id))throw Error('closed');return tabs.get(id);},onRemoved:{addListener:fn=>events.removed=fn},onUpdated:{addListener:fn=>events.updated=fn}},
    scripting:{executeScript:async({args})=>{
      const detail=args[0];calls.push(detail);if(hook)await hook(detail);
      const result=responseQueue.length?responseQueue.shift():detail.mode==='click'?{ok:true,state:'clicked'}:{ok:true,state:calls.some(c=>c.mode==='click')?'following':'follow'};
      return [{result}];
    }}};
  class MemoryJobs extends EphemeralJobs {constructor(){super({now:()=>now,token:()=> 'memory-only-capability'});}}
  vm.runInNewContext(backgroundSource,{EphemeralJobs:MemoryJobs,isAdminUrl,ACTOR,validateAdminCommand,inspectInstagramPage:()=>{},chrome,
    Date:{now:()=>now},setTimeout:(fn,ms)=>{waits.push(ms);queueMicrotask(()=>{now+=ms;fn();});}});
  const send=(m,tabId=1,senderExtra={})=>new Promise(resolve=>events.message({kind:'ADMIN_MESSAGE',message:m},{tab:tabs.get(tabId),frameId:0,url:tabs.get(tabId).url,...senderExtra},resolve));
  const command=(type,extra={},tabId=1)=>send({source,type,requestId,...extra},tabId);
  return {send,command,tabs,events,calls,waits,navigations,setNow:value=>now=value,now:()=>now,setHook:fn=>hook=fn};
}

test('admin protocol validates optional control and strict command keys',()=>{
  assert.equal(validatePreparation(prep(),1000).ok,true);
  const legacy=prep();delete legacy.control;assert.equal(validatePreparation(legacy,1000).value.control,'runner');
  for(const extra of [{control:'silent'},{control:null},{capability:'injected'}])assert.equal(validatePreparation(prep(extra),1000).ok,false);
  for(const [type,extra] of [['START',{confirmed:true}],['STEP',{index:0}],['STATUS',{}],['CANCEL',{}],['PING',{}]])assert.equal(validateAdminCommand({source,type,requestId,...extra}).ok,true);
  for(const [type,extra] of [['START',{confirmed:false}],['START',{confirmed:true,index:0}],['STEP',{index:'0'}],['STEP',{index:-1}],['STEP',{index:10}],['STATUS',{capability:'x'}],['UNKNOWN',{}]])assert.equal(validateAdminCommand({source,type,requestId,...extra}).ok,false);
  assert.equal(validatePreparation(prep({requestId:[requestId]}),1000).ok,false);
  assert.equal(validateAdminCommand({source,type:['STATUS'],requestId}).ok,false);
});

test('admin prepares without runner tab and completes exactly one confirmed background-tab follow',async()=>{
  const b=await browser();
  assert.equal((await b.command('PING')).ok,true);
  const prepared=await b.send(prep());assert.equal(prepared.ok,true);assert.equal(b.navigations.length,0);
  assert.equal(prepared.job.expectedAccount,ACTOR);assert.equal('capability' in prepared.job,false);
  assert.equal((await b.command('STEP',{index:0})).code,'not_confirmed');assert.equal(b.calls.length,0);
  assert.equal((await b.command('START',{confirmed:true})).job.started,true);
  const done=await b.command('STEP',{index:0});assert.equal(done.ok,true);assert.equal(done.job.index,1);assert.equal(done.job.running,false);
  assert.equal(done.job.results[0].state,'followed');assert.equal(b.calls.filter(c=>c.mode==='click').length,1);
  assert.equal(b.navigations.length,2);for(const nav of b.navigations)assert.equal(nav.active,false);
  assert.equal((await b.command('STEP',{index:0})).code,'not_confirmed');assert.equal((await b.command('START',{confirmed:true})).code,'not_confirmed');
  assert.equal((await b.command('STATUS')).job.results.length,1);assert.equal(b.calls.filter(c=>c.mode==='click').length,1);
});

test('job ownership requires same top-level admin tab and request; global lock rejects another preparation',async()=>{
  const b=await browser();await b.send(prep());
  assert.equal((await b.send(prep({requestId:'another-admin-request'}),2)).code,'job_exists');
  assert.equal((await b.command('START',{confirmed:true},2)).code,'job_lost');
  assert.equal((await b.command('CANCEL',{},2)).code,'job_lost');
  assert.equal((await b.command('STATUS',{requestId:'wrong-request-id'})).code,'job_lost');
  assert.equal((await b.send({source,type:'STATUS',requestId},1,{frameId:1})).code,'invalid_message');
  assert.equal((await b.send({source,type:'STATUS',requestId},1,{url:origin+'/admin/login'})).code,'invalid_message');
  assert.equal((await b.command('STATUS')).job.started,false);assert.equal(b.calls.length,0);
  assert.equal((await b.command('CANCEL')).ok,true);assert.equal((await b.command('STATUS')).code,'job_lost');
});

test('duplicate START and simultaneous STEP never repeat a click or advance a second target',async()=>{
  const b=await browser();await b.send(prep({profiles:[target,second]}));
  const started=await Promise.all([b.command('START',{confirmed:true}),b.command('START',{confirmed:true})]);assert.equal(started.filter(r=>r.ok).length,1);
  const stepped=await Promise.all([b.command('STEP',{index:0}),b.command('STEP',{index:0})]);assert.equal(stepped.filter(r=>r.ok).length,1);
  assert.equal(b.calls.filter(c=>c.mode==='click').length,1);assert.equal((await b.command('STATUS')).job.index,1);
  assert.equal((await b.command('STEP',{index:0})).code,'not_confirmed');assert.equal(b.calls.filter(c=>c.mode==='click').length,1);
});

test('DOM hydration wait is read-only and bounded before one eventual click',async()=>{
  const b=await browser({responses:[{ok:false,code:'account_unverified'},{ok:false,code:'ambiguous_profile'},{ok:true,state:'follow'},{ok:true,state:'clicked'},{ok:true,state:'following'}]});
  await b.send(prep());await b.command('START',{confirmed:true});assert.equal((await b.command('STEP',{index:0})).job.results[0].state,'followed');
  assert.deepEqual(b.calls.map(c=>c.mode),['inspect','inspect','inspect','click','inspect']);assert.equal(b.waits.filter(ms=>ms===500).length,3);
  const unresolved=await browser({responses:Array.from({length:17},()=>({ok:false,code:'account_unverified'}))});
  await unresolved.send(prep());await unresolved.command('START',{confirmed:true});assert.equal((await unresolved.command('STEP',{index:0})).code,'account_unverified');
  assert.equal(unresolved.calls.length,17);assert.equal(unresolved.now(),9250);assert.equal(unresolved.calls.some(c=>c.mode==='click'),false);
});

test('login, challenge and identity mismatch halt immediately without hydration retries',async()=>{
  for(const code of ['login_required','challenge','account_mismatch','wrong_profile']){
    const b=await browser({responses:[{ok:false,code}]});await b.send(prep());await b.command('START',{confirmed:true});
    assert.equal((await b.command('STEP',{index:0})).code,code);assert.equal(b.calls.length,1);
    const state=(await b.command('STATUS')).job;assert.equal(state.running,false);assert.equal(state.terminalError,code);
    assert.equal((await b.command('STEP',{index:0})).code,'not_confirmed');assert.equal(b.calls.length,1);
  }
});

test('selection TTL is never extended; expiry, owner departure and cancellation stop in-flight work',async()=>{
  const expired=await browser();await expired.send(prep({expiresAt:1300}));await expired.command('START',{confirmed:true});expired.setNow(1301);
  assert.equal((await expired.command('STEP',{index:0})).code,'job_lost');assert.equal(expired.calls.length,0);
  const b=await browser({responses:[{ok:false,code:'account_unverified'}]});await b.send(prep());await b.command('START',{confirmed:true});
  b.setHook(async()=>{await b.command('CANCEL');});assert.equal((await b.command('STEP',{index:0})).code,'job_lost');assert.equal(b.calls.filter(c=>c.mode==='click').length,0);
  const left=await browser();await left.send(prep());left.events.updated(1,{url:origin+'/admin/login'});assert.equal((await left.command('STATUS')).code,'job_lost');
  const closed=await browser();await closed.send(prep());closed.events.removed(1);assert.equal((await closed.command('STATUS')).code,'job_lost');
});

test('uncertain click result is terminal and preserves previous results without re-click',async()=>{
  const responses=[{ok:true,state:'following'},{ok:true,state:'follow'},{ok:true,state:'clicked'},...Array.from({length:16},()=>({ok:true,state:'follow'}))];
  const b=await browser({responses});await b.send(prep({profiles:[target,second]}));await b.command('START',{confirmed:true});
  assert.equal((await b.command('STEP',{index:0})).job.results[0].state,'following');
  assert.equal((await b.command('STEP',{index:1})).code,'uncertain');const state=(await b.command('STATUS')).job;
  assert.equal(state.index,1);assert.equal(state.results.length,1);assert.equal(state.terminalError,'uncertain');
  assert.equal((await b.command('STEP',{index:1})).code,'not_confirmed');assert.equal(b.calls.filter(c=>c.mode==='click').length,1);
});

test('post-click transient profile replacement and account rendering resolve without another click',async()=>{
  for(const [code,ending,result] of [['ambiguous_profile','following','followed'],['account_unverified','requested','request_sent']]){
    const b=await browser({responses:[{ok:true,state:'follow'},{ok:true,state:'clicked'},{ok:false,code},{ok:true,state:'follow'},{ok:true,state:ending}]});
    await b.send(prep());await b.command('START',{confirmed:true});const done=await b.command('STEP',{index:0});
    assert.equal(done.ok,true);assert.equal(done.job.results[0].state,result);assert.equal(done.job.terminalError,null);
    assert.deepEqual(b.calls.map(call=>call.mode),['inspect','click','inspect','inspect','inspect']);
    assert.equal(b.waits.filter(ms=>ms===500).length,3);assert.equal(b.calls.filter(call=>call.mode==='click').length,1);
    assert.equal((await b.command('STEP',{index:0})).code,'not_confirmed');
  }
});

test('post-click authentication, restriction, identity and other errors halt on the first read',async()=>{
  for(const code of ['login_required','challenge','account_mismatch','wrong_profile','browser_error','unsupported_language']){
    const b=await browser({responses:[{ok:true,state:'follow'},{ok:true,state:'clicked'},{ok:false,code}]});
    await b.send(prep());await b.command('START',{confirmed:true});assert.equal((await b.command('STEP',{index:0})).code,code);
    assert.equal(b.calls.length,3);assert.equal(b.waits.filter(ms=>ms===500).length,1);
    assert.equal((await b.command('STATUS')).job.terminalError,code);assert.equal((await b.command('STEP',{index:0})).code,'not_confirmed');
    assert.equal(b.calls.filter(call=>call.mode==='click').length,1);
  }
});

test('post-click unresolved render errors end uncertain after eight seconds and never repeat the click',async()=>{
  for(const code of ['ambiguous_profile','account_unverified']){
    const b=await browser({responses:[{ok:true,state:'follow'},{ok:true,state:'clicked'},...Array.from({length:16},()=>({ok:false,code}))]});
    await b.send(prep());await b.command('START',{confirmed:true});assert.equal((await b.command('STEP',{index:0})).code,'uncertain');
    assert.equal(b.calls.length,18);assert.equal(b.now(),9250);assert.equal(b.waits.filter(ms=>ms===500).length,16);
    assert.equal((await b.command('STATUS')).job.terminalError,'uncertain');assert.equal((await b.command('START',{confirmed:true})).code,'not_confirmed');
    assert.equal((await b.command('STEP',{index:0})).code,'not_confirmed');assert.equal(b.calls.filter(call=>call.mode==='click').length,1);
  }
});

test('bridge reports versioned admin STATE with matching action and rejects unexpected keys',async()=>{
  const script=await fs.readFile(new URL('../../browser-tools/instagram-follow/bridge.js',import.meta.url),'utf8');
  const handlers={},calls=[],replies=[],win={postMessage:m=>replies.push(m),addEventListener:(name,fn)=>handlers[name]=fn};win.top=win;
  const job={expectedAccount:ACTOR,profiles:[target],expiresAt:61000,index:0,started:false,running:false,terminalError:null,results:[]};
  vm.runInNewContext(script,{location:{origin,pathname:'/admin'},window:win,chrome:{runtime:{sendMessage:async m=>{calls.push(m);return ['PREPARE','START','STEP','STATUS'].includes(m.message.type)?{ok:true,job}:{ok:true};}}}});
  const send=m=>handlers.message({source:win,origin,data:m});
  await send({source,type:'PING',requestId});assert.equal(replies.at(-1).type,'READY');assert.equal(replies.at(-1).version,VERSION);
  for(const m of [prep(),{source,type:'START',requestId,confirmed:true},{source,type:'STEP',requestId,index:0},{source,type:'STATUS',requestId}]){
    await send(m);assert.equal(replies.at(-1).type,'STATE');assert.equal(replies.at(-1).action,m.type);assert.equal(replies.at(-1).requestId,requestId);assert.equal('capability' in replies.at(-1).job,false);
  }
  const count=calls.length;await send({source,type:'START',requestId,confirmed:true,token:'extra'});assert.equal(calls.length,count);assert.equal(replies.at(-1).type,'ERROR');assert.equal(replies.at(-1).action,'START');
  handlers.pagehide();assert.equal(calls.at(-1).message.type,'CANCEL');
});
