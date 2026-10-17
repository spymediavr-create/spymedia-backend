import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {EphemeralJobs,isAdminUrl,ACTOR,ACTOR_NAME,SOURCE,NAVER_ORIGIN,VERSION,MAX_TTL,MAX_PROFILES,RESERVED,canonicalProfile,validatePreparation,validateAdminCommand} from '../../browser-tools/naver-neighbor/core.mjs';

const origin='https://spymedia-backend.onrender.com';
const target='https://blog.naver.com/reviewed_studio';
const second='https://blog.naver.com/reviewed-travel';
const requestId='admin-naver-neighbor-test';
const prep=(extra={})=>({source:SOURCE,type:'PREPARE',requestId,platform:'blog',expectedAccount:ACTOR,profiles:[target],expiresAt:61000,control:'admin',...extra});

test('Naver extension accepts exact reviewed blog profiles and does not reinterpret posts, mobile URLs or service paths',()=>{
  for(const value of [target,second,NAVER_ORIGIN+'/a',NAVER_ORIGIN+'/12345',NAVER_ORIGIN+'/'+'a'.repeat(50)])assert.equal(canonicalProfile(value),value);
  const invalid=[null,42,{},'',...Array.from(RESERVED,name=>NAVER_ORIGIN+'/'+name),NAVER_ORIGIN+'/UPPER',NAVER_ORIGIN+'/a/',NAVER_ORIGIN+'/'+'a'.repeat(51),NAVER_ORIGIN+'/a.b',NAVER_ORIGIN+'/a/123',NAVER_ORIGIN+'/PostList.naver?blogId=reviewed_studio',NAVER_ORIGIN+'/PostView.naver?blogId=reviewed_studio&logNo=123',NAVER_ORIGIN+'/BuddyAdd.naver?blogId=reviewed_studio',NAVER_ORIGIN+'/%61',target+'?tracking=1',target+'#part',target+'\n','https://m.blog.naver.com/reviewed_studio','https://section.blog.naver.com/reviewed_studio','https://nid.naver.com/reviewed_studio','http://blog.naver.com/reviewed_studio','https://user:pass@blog.naver.com/reviewed_studio','https://blog.naver.com:444/reviewed_studio','https://blog.naver.com:443/reviewed_studio','https://blog.naver.com\\@evil.invalid/reviewed_studio'];
  for(const value of invalid)assert.equal(canonicalProfile(value),null,String(value));
});

test('Naver preparation binds one fixed blog and an explicit reviewed 1–10 profile list',()=>{
  assert.equal(ACTOR,'spymedia');assert.equal(ACTOR_NAME,ACTOR);assert.equal(MAX_PROFILES,10);
  const valid=validatePreparation(prep(),1000);assert.equal(valid.ok,true);assert.equal(valid.value.expectedName,'spymedia');assert.equal(valid.value.control,'admin');
  const failures=[{source:'spymedia-admin-follow'},{source:'spymedia-admin-facebook-follow'},{type:'START'},{platform:'instagram'},{expectedAccount:'different_blog'},{control:'runner'},{control:undefined},{profiles:[]},{profiles:Array(11).fill(target)},{profiles:[target,target]},{profiles:new Array(1)},{profiles:[target,undefined]},{profiles:[NAVER_ORIGIN+'/'+ACTOR]},{profiles:[target+'/123']},{profiles:[target+'?x=1']},{expiresAt:1000},{expiresAt:1001+MAX_TTL},{expiresAt:61000.5},{expiresAt:'61000'},{token:'do-not-accept'},{expectedName:'spymedia'},{requestId:'short'},{requestId:'x'.repeat(81)}];
  for(const extra of failures)assert.equal(validatePreparation(prep(extra),1000).ok,false,JSON.stringify(extra));
  for(const missing of Object.keys(prep())){const value=prep();delete value[missing];assert.equal(validatePreparation(value,1000).ok,false,missing);}
  for(const value of [null,[],42,'PREPARE'])assert.equal(validatePreparation(value,1000).ok,false);
  const input=prep();const parsed=validatePreparation(input,1000);input.profiles[0]=second;assert.deepEqual(parsed.value.profiles,[target]);
});

test('Naver messages enforce explicit confirmations, bounded step indices and an isolated namespace',()=>{
  const command=(type,extra={})=>({source:SOURCE,type,requestId,...extra});
  for(const [type,extra]of [['PING',{}],['CANCEL',{}],['STATUS',{}],['START',{confirmed:true}],['STEP',{index:0}],['STEP',{index:9}]])assert.equal(validateAdminCommand(command(type,extra)).ok,true);
  for(const [type,extra]of [['START',{}],['START',{confirmed:false}],['START',{confirmed:1}],['STEP',{}],['STEP',{index:-1}],['STEP',{index:10}],['STEP',{index:1.5}],['STEP',{index:'0'}],['STATUS',{cookie:'never'}],['ADD_MUTUAL_NEIGHBOR',{message:'never'}],['constructor',{}],['toString',{}],['__proto__',{}]])assert.equal(validateAdminCommand(command(type,extra)).ok,false);
  for(const source of ['spymedia-admin-follow','spymedia-admin-facebook-follow','spymedia-follow-extension'])assert.equal(validateAdminCommand({...command('PING'),source}).ok,false);
});

test('Naver administrator URL check does not grant access to login, nested or foreign pages',()=>{
  for(const url of [origin+'/admin',origin+'/admin#sns-accounts'])assert.equal(isAdminUrl(url),true);
  for(const url of [origin+'/admin/login',origin+'/admin/',origin+'/admin-other',origin+'.invalid/admin','http://spymedia-backend.onrender.com/admin','https://user:password@spymedia-backend.onrender.com/admin',null,{},'not a URL'])assert.equal(isAdminUrl(url),false);
});

test('Naver jobs are scoped to the owner and request, globally single-job and memory-only',()=>{
  let now=1000;const jobs=new EphemeralJobs({now:()=>now,token:()=> 'naver-capability'}),first=jobs.prepare(prep({profiles:[target,second]}),7);
  assert.equal(first.ok,true);assert.equal(first.job.naverTabId,null);assert.ok(first.job.popupTabIds instanceof Set);assert.equal(first.job.started,false);assert.equal(first.job.running,false);assert.equal(first.job.index,0);
  assert.equal(jobs.getAdmin(7,requestId),first.job);assert.equal(jobs.getAdmin(8,requestId),null);assert.equal(jobs.getAdmin(7,'other-request'),null);
  assert.equal(jobs.prepare(prep({requestId:'other-request'}),8).code,'job_exists');
  jobs.cancelAdmin(8,requestId);jobs.cancelAdmin(7,'other-request');assert.equal(jobs.get('naver-capability'),first.job);
  first.job.results.push({index:0,state:'added'});first.job.popupTabIds.add(11);jobs.cancelAdmin(7,requestId);
  assert.equal(jobs.get('naver-capability'),null);assert.equal(first.job.cancelled,true);assert.deepEqual(first.job.profiles,[]);assert.deepEqual(first.job.results,[]);assert.equal(first.job.popupTabIds.size,0);
  assert.equal(new EphemeralJobs().get('naver-capability'),null);
  for(const tabId of [0,-1,1.5,undefined,'7'])assert.equal(jobs.prepare(prep(),tabId).code,'invalid_message');
  const expiring=jobs.prepare(prep({expiresAt:2000}),7);assert.equal(expiring.ok,true);now=2000;assert.equal(jobs.get('naver-capability'),null);assert.deepEqual(expiring.job.profiles,[]);
  now=3000;assert.equal(jobs.prepare(prep({expiresAt:4000}),7).ok,true,'A new explicit preparation is allowed after expiration; there is no automatic resume');
});

async function bridge({pathname='/admin',top=true,runtime}={}){
  const script=await fs.readFile(new URL('../../browser-tools/naver-neighbor/bridge.js',import.meta.url),'utf8');
  const handlers={},calls=[],replies=[],win={postMessage:(m,targetOrigin)=>replies.push({message:m,targetOrigin}),addEventListener:(name,fn)=>handlers[name]=fn};win.top=top?win:{};
  const job={expectedAccount:ACTOR,expectedName:ACTOR_NAME,profiles:[target],expiresAt:61000,index:0,started:false,running:false,terminalError:null,results:[]};
  const location={origin,pathname};
  vm.runInNewContext(script,{location,window:win,chrome:{runtime:{sendMessage:async m=>{calls.push(m);return runtime?runtime(m):['PREPARE','START','STEP','STATUS'].includes(m.message.type)?{ok:true,job}:{ok:true};}}}});
  const send=(m,extra={})=>handlers.message?.({source:win,origin,data:m,...extra});
  return {handlers,calls,replies,win,location,send};
}

test('Naver bridge forwards only this administrator top frame and versions all responses',async()=>{
  const b=await bridge(),ping={source:SOURCE,type:'PING',requestId};
  for(const source of ['spymedia-admin-follow','spymedia-admin-facebook-follow'])await b.send({...ping,source});
  await b.send(ping,{origin:'https://evil.invalid'});await b.send(ping,{source:{}});assert.equal(b.calls.length,0);
  await b.send(ping);let reply=b.replies.at(-1);assert.equal(reply.targetOrigin,origin);assert.equal(reply.message.source,'spymedia-naver-neighbor-extension');assert.equal(reply.message.type,'READY');assert.equal(reply.message.version,VERSION);
  for(const m of [prep(),{source:SOURCE,type:'START',requestId,confirmed:true},{source:SOURCE,type:'STEP',requestId,index:0},{source:SOURCE,type:'STATUS',requestId}]){await b.send(m);reply=b.replies.at(-1).message;assert.equal(reply.type,'STATE');assert.equal(reply.requestId,requestId);assert.equal(reply.action,m.type);assert.equal(reply.version,VERSION);}
  assert.equal((await bridge({top:false})).handlers.message,undefined);assert.equal((await bridge({pathname:'/admin/login'})).handlers.message,undefined);
  const count=b.calls.length;b.location.pathname='/admin/login';await b.send(ping);assert.equal(b.calls.length,count);
});

test('Naver bridge refuses extra data, wrong actor, mutual requests and out-of-range commands before the worker',async()=>{
  const b=await bridge(),command=(type,extra={})=>({source:SOURCE,type,requestId,...extra});
  for(const m of [prep({platform:'facebook'}),prep({expectedAccount:'other'}),prep({control:'runner'}),prep({profiles:[]}),prep({profiles:Array(11).fill(target)}),prep({expiresAt:'61000'}),prep({token:'private'}),command('START',{confirmed:false}),command('START',{confirmed:true,message:'never'}),command('STEP',{index:10}),command('STATUS',{cookie:'never'}),command('START'),command('STEP')]){await b.send(m);assert.equal(b.replies.at(-1).message.type,'ERROR');}
  await b.send(command('ADD_MUTUAL_NEIGHBOR',{message:'never'}));assert.equal(b.calls.length,0);
  await b.send(prep({profiles:[target+'a'.repeat(4096)]}));assert.equal(b.calls.length,0);assert.equal(b.replies.at(-1).message.code,'invalid_message');
});

test('Naver bridge cancels only prepared jobs on departure and reports worker loss without retry',async()=>{
  const b=await bridge();await b.send(prep());b.handlers.pagehide();assert.equal(b.calls.at(-1).message.type,'CANCEL');assert.equal(b.calls.at(-1).message.source,SOURCE);const count=b.calls.length;b.handlers.pagehide();assert.equal(b.calls.length,count);
  const cancelled=await bridge();await cancelled.send(prep());await cancelled.send({source:SOURCE,type:'CANCEL',requestId});const before=cancelled.calls.length;cancelled.handlers.pagehide();assert.equal(cancelled.calls.length,before);
  const failed=await bridge({runtime:async()=>{throw Error('worker restarted');}});await failed.send(prep());assert.equal(failed.calls.length,1);assert.equal(failed.replies.at(-1).message.code,'job_lost');failed.handlers.pagehide();assert.equal(failed.calls.length,1);
  const rejected=await bridge({runtime:async()=>({ok:false,code:'account_mismatch'})});await rejected.send(prep());assert.equal(rejected.calls.length,1);assert.equal(rejected.replies.at(-1).message.code,'account_mismatch');
});

test('Naver extension permissions are limited to the blog and administrator, without login/session/storage grants',async()=>{
  const manifest=JSON.parse(await fs.readFile(new URL('../../browser-tools/naver-neighbor/manifest.json',import.meta.url),'utf8'));
  assert.equal(manifest.version,VERSION);assert.equal(manifest.manifest_version,3);assert.deepEqual(manifest.permissions,['scripting']);assert.deepEqual(manifest.host_permissions,[NAVER_ORIGIN+'/*',origin+'/*']);
  assert.equal(manifest.background.type,'module');assert.deepEqual(manifest.content_scripts[0].matches,[origin+'/admin*']);assert.equal(manifest.content_scripts[0].all_frames,false);assert.equal(manifest.content_scripts[0].run_at,'document_idle');assert.equal('optional_permissions' in manifest,false);
  assert.doesNotMatch(JSON.stringify(manifest),/nid\.naver|cookies|storage|webRequest|debugger|<all_urls>/);
});
