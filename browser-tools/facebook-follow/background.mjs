import {EphemeralJobs,isAdminUrl,ACTOR,ACTOR_NAME,SOURCE,FACEBOOK_ORIGIN,validateAdminCommand} from './core.mjs';
import {inspectFacebookPage} from './dom-agent.mjs';

const jobs=new EphemeralJobs();
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const rejected=code=>({ok:false,code});
const jobView=job=>({expectedAccount:job.expectedAccount,expectedName:job.expectedName,profiles:[...job.profiles],expiresAt:job.expiresAt,index:job.index,started:job.started,running:job.running,terminalError:job.terminalError,results:job.results.map(result=>({...result}))});
const actorUrl=FACEBOOK_ORIGIN+'/me/';
const temporaryErrors=new Set(['account_unverified','ambiguous_profile']);
const relationshipStates=new Set(['follow','following']);
function assertActive(job){if(!job||jobs.get(job.capability)!==job||job.cancelled)throw Object.assign(Error('job_lost'),{code:'job_lost'});}
async function assertAdmin(job){
  assertActive(job);const tab=await chrome.tabs.get(job.adminTabId);
  if(!isAdminUrl(tab.url)){jobs.cancel(job.capability);throw Object.assign(Error('cancelled'),{code:'cancelled'});}
  assertActive(job);
}
async function runDom(job,targetUrl,mode){
  await assertAdmin(job);
  const records=await chrome.scripting.executeScript({target:{tabId:job.facebookTabId,frameIds:[0]},func:inspectFacebookPage,args:[{expectedAccount:ACTOR,expectedName:ACTOR_NAME,targetUrl,mode}]});
  assertActive(job);
  if(records.length!==1||!records[0].result)return rejected('browser_error');
  const result=records[0].result;
  if(result.ok!==true&&result.ok!==false)return rejected('browser_error');
  if(result.ok&&mode==='actor'&&(result.state!=='actor_verified'||result.actorId!==ACTOR))return rejected('account_mismatch');
  if(result.ok&&mode!=='actor'&&!relationshipStates.has(result.state)&&!(mode==='click'&&result.state==='clicked'))return rejected('browser_error');
  return result;
}
async function navigate(job,targetUrl){
  await assertAdmin(job);
  if(!job.facebookTabId){const tab=await chrome.tabs.create({url:'about:blank',active:false});assertActive(job);job.facebookTabId=tab.id;}
  await chrome.tabs.update(job.facebookTabId,{url:targetUrl,active:false});
  for(let i=0;i<60;i++){
    await delay(250);await assertAdmin(job);const tab=await chrome.tabs.get(job.facebookTabId);
    if(tab.status==='complete')return;
  }
  throw Object.assign(Error('browser_error'),{code:'browser_error'});
}
async function waitForPage(job,targetUrl,mode){
  // Hydration reads may wait; an authentication mismatch or restriction never does.
  const deadline=Date.now()+8000;
  for(let attempt=0;attempt<=16;attempt++){
    const state=await runDom(job,targetUrl,mode);
    if(state.ok||!temporaryErrors.has(state.code)||Date.now()>=deadline||attempt===16)return state;
    await delay(Math.min(500,Math.max(0,deadline-Date.now())));
  }
}
function start(job,confirmed){
  if(confirmed!==true||job.started||job.running||job.terminalError||job.index||job.results.length)return rejected('not_confirmed');
  job.started=true;job.running=true;return {ok:true};
}
async function step(job,expectedIndex){
  if(!job.running||job.busy||expectedIndex!==job.index||job.index>=job.profiles.length)return rejected('not_confirmed');
  job.busy=true;const targetUrl=job.profiles[job.index];
  try{
    // Re-resolve the current acting Page before EVERY selected target. A stored
    // token/Page ID or previously visited profile is not browser actor evidence.
    await navigate(job,actorUrl);
    const actor=await waitForPage(job,actorUrl,'actor');
    if(!actor.ok)throw Object.assign(Error(actor.code),{code:actor.code});
    await navigate(job,targetUrl);
    const before=await waitForPage(job,targetUrl,'inspect');
    if(!before.ok)throw Object.assign(Error(before.code),{code:before.code});
    let state=before.state;
    if(state==='follow'){
      // DOM code rechecks the current acting Page and target before one click.
      const clicked=await runDom(job,targetUrl,'click');
      if(!clicked.ok)throw Object.assign(Error(clicked.code),{code:clicked.code});
      if(clicked.state==='clicked'){
        state='uncertain';const deadline=Date.now()+8000;
        for(let attempt=0;attempt<16;attempt++){
          await delay(Math.min(500,Math.max(0,deadline-Date.now())));
          const after=await runDom(job,targetUrl,'inspect');
          if(!after.ok&&!temporaryErrors.has(after.code))throw Object.assign(Error(after.code),{code:after.code});
          if(after.ok&&after.state==='following'){state='followed';break;}
          if(Date.now()>=deadline)break;
        }
        if(state==='uncertain')throw Object.assign(Error('uncertain'),{code:'uncertain'});
      }else state=clicked.state;
    }
    if(!['followed','following'].includes(state))throw Object.assign(Error('uncertain'),{code:'uncertain'});
    assertActive(job);job.results.push({index:job.index,state});job.index++;if(job.index===job.profiles.length)job.running=false;
    return {ok:true};
  }catch(error){job.running=false;job.terminalError=error.code||'browser_error';return rejected(job.terminalError);}
  finally{job.busy=false;}
}
async function handle(message,sender){
  jobs.expire();
  if(message?.kind!=='ADMIN_MESSAGE'||!sender.tab?.id||sender.frameId!==0||!isAdminUrl(sender.url)||!isAdminUrl(sender.tab.url))return rejected('invalid_message');
  const m=message.message;
  if(!m||m.source!==SOURCE||typeof m.requestId!=='string'||!/^[A-Za-z0-9_-]{8,80}$/.test(m.requestId))return rejected('invalid_message');
  if(m.type==='PREPARE'){const prepared=jobs.prepare(m,sender.tab.id);return prepared.ok?{ok:true,job:jobView(prepared.job)}:prepared;}
  const valid=validateAdminCommand(m);if(!valid.ok)return valid;
  if(m.type==='PING')return {ok:true};
  const job=jobs.getAdmin(sender.tab.id,m.requestId);if(!job)return rejected('job_lost');
  if(m.type==='CANCEL'){jobs.cancel(job.capability);return {ok:true};}
  await assertAdmin(job);
  if(m.type==='STATUS')return {ok:true,job:jobView(job)};
  const result=m.type==='START'?start(job,m.confirmed):await step(job,m.index);
  if(!result.ok)return result;assertActive(job);return {ok:true,job:jobView(job)};
}
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  handle(message,sender).then(sendResponse).catch(error=>sendResponse(rejected(['job_lost','cancelled'].includes(error?.code)?error.code:'browser_error')));return true;
});
chrome.tabs.onRemoved.addListener(tabId=>{for(const job of [...jobs.jobs.values()])if([job.adminTabId,job.facebookTabId].includes(tabId))jobs.cancel(job.capability);});
chrome.tabs.onUpdated.addListener((tabId,change)=>{if(change.url&&!isAdminUrl(change.url))jobs.cancelAdmin(tabId);});
