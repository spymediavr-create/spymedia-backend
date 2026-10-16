import {EphemeralJobs,isAdminUrl,ACTOR,validateAdminCommand} from './core.mjs';
import {inspectInstagramPage} from './dom-agent.mjs';

const jobs = new EphemeralJobs();
const runnerUrl = chrome.runtime.getURL('runner.html');
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
const rejected = code => ({ok:false,code});
const jobView = job => ({expectedAccount:job.expectedAccount,profiles:[...job.profiles],expiresAt:job.expiresAt,index:job.index,started:job.started,running:job.running,terminalError:job.terminalError,results:job.results.map(result=>({...result}))});
const runnerView = job => ({requestId:job.requestId,...jobView(job)});

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
    const tab = await chrome.tabs.create({url:'about:blank',active:false});
    assertActive(job); job.instagramTabId = tab.id;
  }
  await chrome.tabs.update(job.instagramTabId,{url:targetUrl,active:false});
  for (let i=0;i<60;i++) {
    await delay(250); await assertAdmin(job);
    const tab = await chrome.tabs.get(job.instagramTabId);
    if (tab.status === 'complete') return;
  }
  throw Object.assign(new Error('browser_error'),{code:'browser_error'});
}

async function waitForProfile(job,targetUrl) {
  // Read-only hydration wait. Authentication failures and identity mismatches stop immediately.
  // This does not repeat a click or retry a completed/failed STEP.
  const deadline = Date.now() + 8000;
  for (let attempt=0;attempt<=16;attempt++) {
    const before = await runDom(job,targetUrl,'inspect');
    if (before.ok || !['account_unverified','ambiguous_profile'].includes(before.code) || Date.now() >= deadline || attempt === 16) return before;
    await delay(Math.min(500,Math.max(0,deadline-Date.now())));
  }
}

function start(job,confirmed) {
  if (confirmed !== true || job.started || job.running || job.terminalError || job.index || job.results.length) return rejected('not_confirmed');
  job.started = true; job.running = true; return {ok:true};
}

async function step(job, expectedIndex) {
  if (!job.running || job.busy || expectedIndex !== job.index || job.index >= job.profiles.length) return rejected('not_confirmed');
  job.busy = true;
  const targetUrl = job.profiles[job.index];
  try {
    await navigate(job,targetUrl);
    const before = await waitForProfile(job,targetUrl);
    if (!before.ok) throw Object.assign(new Error(before.code),{code:before.code});
    let state = before.state;
    if (state === 'follow') {
      // The DOM script revalidates both identities immediately before this one permitted click.
      const clicked = await runDom(job,targetUrl,'click');
      if (!clicked.ok) throw Object.assign(new Error(clicked.code),{code:clicked.code});
      if (clicked.state === 'clicked') {
        state = 'uncertain';
        const resultDeadline = Date.now() + 8000;
        for (let i=0;i<16;i++) {
          await delay(Math.min(500,Math.max(0,resultDeadline-Date.now())));
          const after = await runDom(job,targetUrl,'inspect');
          // React can replace the profile/button immediately after the single click.
          // Read through that transient state; never click again to verify a result.
          if (!after.ok && !['ambiguous_profile','account_unverified'].includes(after.code)) throw Object.assign(new Error(after.code),{code:after.code});
          if (after.ok && ['following','requested'].includes(after.state)) { state = after.state === 'following' ? 'followed' : 'request_sent'; break; }
          if (Date.now() >= resultDeadline) break;
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
    if (!m || m.source !== 'spymedia-admin-follow' || typeof m.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(m.requestId)) return rejected('invalid_message');
    if (m.type !== 'PREPARE') {
      const valid = validateAdminCommand(m);
      if (!valid.ok) return valid;
      if (m.type === 'PING') return {ok:true};
      const job = jobs.getAdmin(sender.tab.id,m.requestId);
      if (!job) return rejected('job_lost');
      if (m.type === 'CANCEL') { jobs.cancel(job.capability); return {ok:true}; }
      if (job.control !== 'admin') return rejected('invalid_message');
      await assertAdmin(job);
      if (m.type === 'STATUS') return {ok:true,job:jobView(job)};
      const result = m.type === 'START' ? start(job,m.confirmed) : await step(job,m.index);
      if (!result.ok) return result;
      assertActive(job);
      return {ok:true,job:jobView(job)};
    }
    const prepared = jobs.prepare(m,sender.tab.id);
    if (!prepared.ok) return prepared;
    if (prepared.job.control === 'admin') return {ok:true,job:jobView(prepared.job)};
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
    return start(job,message.confirmed);
  }
  if (message.kind === 'RUNNER_STEP') return step(job,message.index);
  return rejected('invalid_message');
}

chrome.runtime.onMessage.addListener((message,sender,sendResponse) => {
  handle(message,sender).then(sendResponse).catch(error=>sendResponse(rejected(['job_lost','cancelled'].includes(error?.code)?error.code:'browser_error'))); return true;
});
chrome.tabs.onRemoved.addListener(tabId => {
  for (const job of [...jobs.jobs.values()]) if ([job.adminTabId,job.runnerTabId,job.instagramTabId].includes(tabId)) jobs.cancel(job.capability);
});
chrome.tabs.onUpdated.addListener((tabId,change) => {
  if (change.url && !isAdminUrl(change.url)) jobs.cancelAdmin(tabId);
});
