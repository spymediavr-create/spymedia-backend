import {EphemeralJobs,isAdminUrl,ACTOR,ACTOR_NAME,SOURCE,NAVER_ORIGIN,validateAdminCommand} from './core.mjs';
import {resolveNaverContent,inspectNaverPage,inspectNaverDialog} from './dom-agent.mjs';

const jobs=new EphemeralJobs();
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const rejected=code=>({ok:false,code});
const fault=code=>Object.assign(Error(code),{code});
const jobView=job=>({expectedAccount:job.expectedAccount,expectedName:job.expectedName,profiles:[...job.profiles],expiresAt:job.expiresAt,index:job.index,started:job.started,running:job.running,terminalError:job.terminalError,results:job.results.map(result=>({...result}))});
const contentPaths=new Set(['/PostList.naver','/PostView.naver','/prologue/PrologueList.naver']);
function assertActive(job){if(!job||jobs.get(job.capability)!==job||job.cancelled)throw fault('job_lost');}
async function assertAdmin(job){
  assertActive(job);const tab=await chrome.tabs.get(job.adminTabId);
  if(!isAdminUrl(tab.url)){jobs.cancel(job.capability);throw fault('cancelled');}assertActive(job);
}
function onNaver(value){try{const u=new URL(value);return u.origin===NAVER_ORIGIN&&!u.username&&!u.password;}catch{return false;}}
function popupMatches(value,targetUrl,initial=false){
  try{const u=new URL(value),id=new URL(targetUrl).pathname.slice(1),ids=u.searchParams.getAll('blogId');return onNaver(value)&&u.pathname==='/BuddyAdd.naver'&&ids.length<=1&&(!ids.length&&!initial||ids.length===1&&ids[0]===id);}catch{return false;}
}
async function tabReady(job,id){
  for(let n=0;n<60;n++){
    await assertAdmin(job);const tab=await chrome.tabs.get(id);
    if(tab.status==='complete'){
      if(!onNaver(tab.url))throw fault(tab.url?.startsWith('https://nid.naver.com/')?'login_required':'browser_error');return tab;
    }await delay(250);
  }throw fault('browser_error');
}
async function navigate(job,key,url){
  await assertAdmin(job);
  if(!job[key]){
    const tab=await chrome.tabs.create({url:'about:blank',active:false});
    if(jobs.get(job.capability)!==job||job.cancelled){await chrome.tabs.remove(tab.id).catch(()=>{});throw fault('job_lost');}job[key]=tab.id;
  }
  await chrome.tabs.update(job[key],{url,active:false});await tabReady(job,job[key]);return job[key];
}
async function execute(job,tabId,func,args,documentId){
  await assertAdmin(job);const tab=await chrome.tabs.get(tabId);
  if(!onNaver(tab.url))throw fault(tab.url?.startsWith('https://nid.naver.com/')?'login_required':'browser_error');
  const records=await chrome.scripting.executeScript({target:documentId?{tabId,documentIds:[documentId]}:{tabId,frameIds:[0]},func,args:[args]});
  assertActive(job);
  if(records.length!==1||records[0].frameId!==0||documentId&&records[0].documentId!==documentId||!records[0].result||typeof records[0].result.ok!=='boolean')throw fault('browser_error');
  return records[0];
}
async function contentPage(job,key,targetUrl){
  const tabId=await navigate(job,key,targetUrl);
  const record=await execute(job,tabId,resolveNaverContent,{targetUrl});
  if(!record.result.ok)throw fault(record.result.code);
  const resolved=new URL(record.result.url),id=new URL(targetUrl).pathname.slice(1);
  if(!onNaver(resolved.href)||!contentPaths.has(resolved.pathname)||resolved.searchParams.getAll('blogId').length!==1||resolved.searchParams.get('blogId')!==id)throw fault('wrong_profile');
  if((await chrome.tabs.get(tabId)).url!==resolved.href)await navigate(job,key,resolved.href);
  return tabId;
}
async function readProfile(job,tabId,targetUrl,mode,actorLabel){
  const deadline=Date.now()+8000;
  for(let n=0;n<17;n++){
    const r=await execute(job,tabId,inspectNaverPage,{expectedAccount:ACTOR,expectedName:ACTOR_NAME,targetUrl,mode,actorLabel});
    if(r.result.ok||!['ambiguous_profile','account_unverified'].includes(r.result.code)||Date.now()>=deadline)return r;
    await delay(500);
  }throw fault('ambiguous_profile');
}
async function verifyActor(job){
  const url=NAVER_ORIGIN+'/'+ACTOR,tabId=await contentPage(job,'actorTabId',url);
  const r=(await readProfile(job,tabId,url,'actor')).result;
  if(!r.ok)throw fault(r.code);
  if(r.state!=='actor_verified'||r.actorId!==ACTOR||typeof r.actorLabel!=='string'||!r.actorLabel)throw fault('account_unverified');
  return r.actorLabel;
}
async function openPopup(job,targetUrl,actorLabel,targetName){
  // Watch only newly opened tabs owned by this one reviewed profile. Never
  // collect or control existing unrelated Naver windows.
  job.pendingPopupTarget=targetUrl;job.popupCandidates=new Set();
  const r=await execute(job,job.naverTabId,inspectNaverPage,{expectedAccount:ACTOR,expectedName:ACTOR_NAME,targetUrl,mode:'open',actorLabel});
  if(!r.result.ok)throw fault(r.result.code);
  if(r.result.state==='existing')return null;
  if(r.result.state!=='opened'||r.result.targetName!==targetName)throw fault('wrong_profile');
  for(let n=0;n<60;n++){
    await assertAdmin(job);
    const found=[];
    for(const id of job.popupCandidates){
      const tab=await chrome.tabs.get(id).catch(()=>null);
      if(!tab||tab.openerTabId!==job.naverTabId)continue;
      if(popupMatches(tab.url,targetUrl,true))found.push(tab);
      else if(tab.status==='complete'&&tab.url&&tab.url!=='about:blank')throw fault('popup_binding');
    }
    if(found.length>1)throw fault('popup_binding');
    if(found.length===1&&found[0].status==='complete'){
      const tab=found[0];job.popupTabIds.add(tab.id);job.activePopupId=tab.id;job.pendingPopupTarget=null;return tab.id;
    }await delay(250);
  }throw fault('popup_not_found');
}
async function popupRecord(job,popupId,targetUrl,targetName,stage,mode,documentId){
  await assertAdmin(job);const tab=await chrome.tabs.get(popupId);
  if(!job.popupTabIds.has(popupId)||job.activePopupId!==popupId||tab.openerTabId!==job.naverTabId||!popupMatches(tab.url,targetUrl,stage==='choice'))throw fault('popup_binding');
  return execute(job,popupId,inspectNaverDialog,{targetUrl,targetName,stage,mode,groupName:'광고업체'},documentId);
}
async function waitPopup(job,popupId,targetUrl,targetName,stage,{documentId,ready=()=>true}={}){
  const deadline=Date.now()+10000;
  for(let n=0;n<21;n++){
    const r=await popupRecord(job,popupId,targetUrl,targetName,stage,'inspect',documentId);
    if(r.result.ok&&ready(r.result)||!r.result.ok&&!['ambiguous_dialog','uncertain'].includes(r.result.code))return r;
    if(Date.now()>=deadline)throw fault('uncertain');
    await delay(500);
  }throw fault('uncertain');
}
async function clickStage(job,popupId,targetUrl,targetName,stage,mode,record,expected){
  if(!record.documentId)throw fault('browser_error');
  const r=await popupRecord(job,popupId,targetUrl,targetName,stage,mode,record.documentId);
  if(!r.result.ok)throw fault(r.result.code);
  if(r.result.state!==expected)throw fault('uncertain');return r;
}
function start(job,confirmed){
  if(confirmed!==true||job.started||job.running||job.terminalError||job.index||job.results.length)return rejected('not_confirmed');
  job.started=true;job.running=true;return {ok:true};
}
async function step(job,index){
  if(!job.running||job.busy||index!==job.index||index>=job.profiles.length)return rejected('not_confirmed');
  job.busy=true;const targetUrl=job.profiles[index];let popupStage='';
  try{
    const actorLabel=await verifyActor(job);
    const tabId=await contentPage(job,'naverTabId',targetUrl);
    const before=(await readProfile(job,tabId,targetUrl,'inspect',actorLabel)).result;
    if(!before.ok)throw fault(before.code);
    if(!['add','existing'].includes(before.state))throw fault('ambiguous_profile');
    let state='existing';
    if(before.state==='add'){
      if(typeof before.targetName!=='string'||!before.targetName.trim()||before.targetName.length>200)throw fault('ambiguous_profile');
      const targetName=before.targetName,popupId=await openPopup(job,targetUrl,actorLabel,targetName);
      if(popupId!==null){
        popupStage='choice';
        const choice=await waitPopup(job,popupId,targetUrl,targetName,'choice');
        if(!choice.result.ok)throw fault(choice.result.code);
        if(choice.result.state!=='choice')throw fault('ambiguous_dialog');
        await clickStage(job,popupId,targetUrl,targetName,'choice','next',choice,'advanced');
        popupStage='group';
        let group=await waitPopup(job,popupId,targetUrl,targetName,'group');
        if(!group.result.ok)throw fault(group.result.code);
        if(group.result.state!=='group')throw fault('ambiguous_dialog');
        if(!['native','custom'].includes(group.result.kind))throw fault('ambiguous_dialog');
        if(group.result.kind==='custom'){
          if(!group.result.expanded)await clickStage(job,popupId,targetUrl,targetName,'group','expand',group,'expanded');
          group=await waitPopup(job,popupId,targetUrl,targetName,'group',{documentId:group.documentId,ready:r=>r.state==='group'&&r.kind==='custom'&&r.expanded===true});
          if(!group.result.ok)throw fault(group.result.code);
        }
        await clickStage(job,popupId,targetUrl,targetName,'group','select',group,'selected');
        // UI effects may settle asynchronously. Poll only observations, never
        // repeat a click, and stay on the same document that received it.
        const selected=await waitPopup(job,popupId,targetUrl,targetName,'group',{documentId:group.documentId,ready:r=>r.state==='group'&&r.kind===group.result.kind&&r.selected===true});
        if(!selected.result.ok)throw fault(selected.result.code);
        // Recheck current ownership immediately before the single final submit.
        if(await verifyActor(job)!==actorLabel)throw fault('account_mismatch');
        await clickStage(job,popupId,targetUrl,targetName,'group','submit',selected,'submitted');
        popupStage='result';
        const result=await waitPopup(job,popupId,targetUrl,targetName,'result');
        if(!result.result.ok||result.result.state!=='added')throw fault(result.result.code||'uncertain');
        state='added';job.activePopupId=null;job.popupTabIds.delete(popupId);
        await chrome.tabs.remove(popupId).catch(()=>{});
      }
    }
    assertActive(job);job.results.push({index:job.index,state});job.index++;if(job.index===job.profiles.length)job.running=false;
    return {ok:true};
  }catch(error){
    job.running=false;
    const stageCode={choice:'choice_unrecognized',group:'group_unrecognized',result:'result_unconfirmed'}[popupStage];
    job.terminalError=stageCode&&['ambiguous_dialog','uncertain'].includes(error.code)?stageCode:error.code||'browser_error';
    return rejected(job.terminalError);
  }
  finally{job.busy=false;job.pendingPopupTarget=null;job.popupCandidates?.clear();}
}
async function handle(message,sender){
  jobs.expire();
  if(message?.kind!=='ADMIN_MESSAGE'||!sender.tab?.id||sender.frameId!==0||!isAdminUrl(sender.url)||!isAdminUrl(sender.tab.url))return rejected('invalid_message');
  const m=message.message;
  if(!m||m.source!==SOURCE||typeof m.requestId!=='string'||!/^[A-Za-z0-9_-]{8,80}$/.test(m.requestId))return rejected('invalid_message');
  if(m.type==='PREPARE'){const p=jobs.prepare(m,sender.tab.id);return p.ok?{ok:true,job:jobView(p.job)}:p;}
  const valid=validateAdminCommand(m);if(!valid.ok)return valid;
  if(m.type==='PING')return {ok:true};
  const job=jobs.getAdmin(sender.tab.id,m.requestId);if(!job)return rejected('job_lost');
  if(m.type==='CANCEL'){jobs.cancel(job.capability);return {ok:true};}
  await assertAdmin(job);if(m.type==='STATUS')return {ok:true,job:jobView(job)};
  const result=m.type==='START'?start(job,m.confirmed):await step(job,m.index);
  if(!result.ok)return result;assertActive(job);return {ok:true,job:jobView(job)};
}
chrome.runtime.onMessage.addListener((m,sender,respond)=>{handle(m,sender).then(respond).catch(e=>respond(rejected(['job_lost','cancelled'].includes(e?.code)?e.code:'browser_error')));return true;});
chrome.tabs.onCreated.addListener(tab=>{for(const job of jobs.jobs.values())if(job.pendingPopupTarget&&tab.openerTabId===job.naverTabId)job.popupCandidates.add(tab.id);});
chrome.tabs.onRemoved.addListener(id=>{for(const job of [...jobs.jobs.values()])if([job.adminTabId,job.actorTabId,job.naverTabId,job.activePopupId].includes(id))jobs.cancel(job.capability);});
chrome.tabs.onUpdated.addListener((id,change)=>{if(change.url&&!isAdminUrl(change.url))jobs.cancelAdmin(id);});
