import {EphemeralJobs,isAdminUrl,ACTOR} from './core.mjs';
import {inspectInstagramPage} from './dom-agent.mjs';

const jobs = new EphemeralJobs();
const runnerUrl = chrome.runtime.getURL('runner.html');
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
const rejected = code => ({ok:false,code});
const runnerView = job => ({requestId:job.requestId,expectedAccount:job.expectedAccount,profiles:job.profiles,expiresAt:job.expiresAt,index:job.index,started:job.started,running:job.running,terminalError:job.terminalError,results:job.results});

function assertActive(job) {
  if (!job || jobs.get(job.capability) !== job || job.cancelled) throw Object.assign(new Error('job_lost'),{code:'job_lost'});
}
async function assertAdmin(job) {
  assertActive(job);
  const tab = await chrome.tabs.get(job.adminTabId);
  if (!isAdminUrl(tab.url)) { jobs.cancel(job.capability); throw Object.assign(new Error('cancelled'),{code:'cancelled'}); }
  assertActive(job);
}
async function runDom(job, targetUrl, mode) {
  await assertAdmin(job);
  const records = await chrome.scripting.executeScript({target:{tabId:job.instagramTabId,frameIds:[0]},func:inspectInstagramPage,args:[{expectedAccount:ACTOR,targetUrl,mode}]});
  assertActive(job);
  if (records.length !== 1 || !records[0].result) return rejected('browser_error');
  return records[0].result;
}
async function navigate(job,targetUrl) {
  await assertAdmin(job);
  if (!job.instagramTabId) {
    const tab = await chrome.tabs.create({url:'about:blank',active:true});
    assertActive(job); job.instagramTabId = tab.id;
  }
  await chrome.tabs.update(job.instagramTabId,{url:targetUrl,active:true});
  for (let i=0;i<60;i++) {
    await delay(250); await assertAdmin(job);
    const tab = await chrome.tabs.get(job.instagramTabId);
    if (tab.status === 'complete') { await delay(1000); return; }
  }
  throw Object.assign(new Error('browser_error'),{code:'browser_error'});
}

async function step(job, expectedIndex) {
  if (!job.running || job.busy || expectedIndex !== job.index || job.index >= job.profiles.length) return rejected('not_confirmed');
  job.busy = true;
  const targetUrl = job.profiles[job.index];
  try {
    await navigate(job,targetUrl);
    const before = await runDom(job,targetUrl,'inspect');
    if (!before.ok) throw Object.assign(new Error(before.code),{code:before.code});
    let state = before.state;
    if (state === 'follow') {
      // The DOM script revalidates both identities immediately before this one permitted click.
      const clicked = await runDom(job,targetUrl,'click');
      if (!clicked.ok) throw Object.assign(new Error(clicked.code),{code:clicked.code});
      if (clicked.state === 'clicked') {
        state = 'uncertain';
        for (let i=0;i<8;i++) {
          await delay(500);
          const after = await runDom(job,targetUrl,'inspect');
          if (!after.ok) throw Object.assign(new Error(after.code),{code:after.code});
          if (['following','requested'].includes(after.state)) { state = after.state === 'following' ? 'followed' : 'request_sent'; break; }
        }
        if (state === 'uncertain') throw Object.assign(new Error('uncertain'),{code:'uncertain'});
      } else state = clicked.state;
    }
    assertActive(job);
    const result = {index:job.index,state};
    job.results.push(result); job.index++;
    if (job.index === job.profiles.length) job.running = false;
    return {ok:true,result,done:job.index === job.profiles.length};
  } catch(error) {
    job.running = false;
    job.terminalError = error.code || 'browser_error';
    return rejected(job.terminalError);
  } finally { job.busy = false; }
}

async function handle(message,sender) {
  jobs.expire();
  if (message?.kind === 'ADMIN_MESSAGE') {
    if (!sender.tab?.id || sender.frameId !== 0 || !isAdminUrl(sender.url) || !isAdminUrl(sender.tab.url)) return rejected('invalid_message');
    const m = message.message;
    if (!m || m.source !== 'spymedia-admin-follow' || !/^[A-Za-z0-9_-]{8,80}$/.test(m.requestId || '')) return rejected('invalid_message');
    if (m.type === 'PING' || m.type === 'CANCEL') {
      if (Object.keys(m).some(k=>!['source','type','requestId'].includes(k))) return rejected('invalid_message');
      if (m.type === 'CANCEL') jobs.cancelAdmin(sender.tab.id,m.requestId);
      return {ok:true};
    }
    const prepared = jobs.prepare(m,sender.tab.id);
    if (!prepared.ok) return prepared;
    try {
      const tab = await chrome.tabs.create({url:'about:blank',active:true});
      prepared.job.runnerTabId = tab.id;
      await chrome.tabs.update(tab.id,{url:runnerUrl});
      return {ok:true};
    } catch { jobs.cancel(prepared.job.capability); return rejected('browser_error'); }
  }
  if (sender.url !== runnerUrl || !sender.tab?.id) return rejected('invalid_message');
  const job = [...jobs.jobs.values()].find(j=>j.runnerTabId === sender.tab.id);
  if (!job) return rejected('job_lost');
  if (message.kind === 'RUNNER_HELLO') return {ok:true,capability:job.capability,job:runnerView(job)};
  if (message.capability !== job.capability) return rejected('invalid_message');
  if (message.kind === 'RUNNER_STOP') { jobs.cancel(job.capability); return {ok:true}; }
  await assertAdmin(job);
  if (message.kind === 'RUNNER_PING') return {ok:true};
  if (message.kind === 'RUNNER_START') {
    if (message.confirmed !== true || job.started || job.running || job.terminalError || job.index || job.results.length) return rejected('not_confirmed');
    job.started = true; job.running = true; return {ok:true};
  }
  if (message.kind === 'RUNNER_STEP') return step(job,message.index);
  return rejected('invalid_message');
}

chrome.runtime.onMessage.addListener((message,sender,sendResponse) => {
  handle(message,sender).then(sendResponse).catch(()=>sendResponse(rejected('browser_error'))); return true;
});
chrome.tabs.onRemoved.addListener(tabId => {
  for (const job of [...jobs.jobs.values()]) if ([job.adminTabId,job.runnerTabId,job.instagramTabId].includes(tabId)) jobs.cancel(job.capability);
});
chrome.tabs.onUpdated.addListener((tabId,change) => {
  if (change.url && !isAdminUrl(change.url)) jobs.cancelAdmin(tabId);
});
