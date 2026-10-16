import {messages} from './core.mjs';
const ui = Object.fromEntries(['targets','confirmed','start','stop','status','expiry'].map(id=>[id,document.getElementById(id)]));
let capability, job, stopped = false, active = false, halted = false, heartbeat, expiryTimer;
const labels = {followed:'팔로우 완료',request_sent:'팔로우 요청 전송',following:'이미 팔로우 중 · 건너뜀',requested:'이미 요청됨 · 건너뜀'};
const say = value => { ui.status.textContent = value; };
const request = async (kind,extra={}) => {
  try { return await chrome.runtime.sendMessage({kind,capability,...extra}); } catch { return {ok:false,code:'job_lost'}; }
};
function clearLocal(code) {
  stopped = true; active = false; clearInterval(heartbeat); clearTimeout(expiryTimer);
  capability = null; if (job) job.profiles.length = 0; job = null;
  ui.targets.replaceChildren(); ui.confirmed.checked = false; ui.confirmed.disabled = true; ui.start.disabled = true; ui.stop.disabled = true; ui.expiry.textContent = '';
  say(messages[code] || messages.job_lost);
}
async function stop(code='cancelled') { const pending = request('RUNNER_STOP'); clearLocal(code); await pending; }
function halt(code,index) {
  halted = true; active = false; ui.start.disabled = true; ui.confirmed.disabled = true;
  if (Number.isInteger(index) && ui.targets.children[index]) ui.targets.children[index].querySelector('span').textContent = '확인 필요 · 자동 재시도 안 함';
  say(messages[code] || messages.browser_error);
}
ui.confirmed.addEventListener('change',()=>{ ui.start.disabled = !ui.confirmed.checked || active || stopped || halted; });
ui.stop.addEventListener('click',()=>void stop());
window.addEventListener('pagehide',()=>{ void request('RUNNER_STOP'); clearLocal('cancelled'); });
ui.start.addEventListener('click',async()=>{
  if (!job || stopped || active || halted || !ui.confirmed.checked) return;
  active = true; ui.start.disabled = true; ui.confirmed.disabled = true;
  const started = await request('RUNNER_START',{confirmed:true});
  if (!started?.ok) { halt(started?.code || 'job_lost'); return; }
  for (let index=0;job && index<job.profiles.length && !stopped;index++) {
    say(`${index+1} / ${job.profiles.length} 계정을 확인하고 있습니다. Instagram 탭에서 로그인·추가 인증 화면이 나오면 이 작업을 중지하세요.`);
    const result = await request('RUNNER_STEP',{index});
    if (stopped) return;
    if (!result?.ok) { halt(result?.code || 'browser_error',index); return; }
    ui.targets.children[index].querySelector('span').textContent = labels[result.result.state] || '확인 필요';
  }
  if (!stopped) { active = false; halted = true; say('선택한 계정 처리를 마쳤습니다. 결과를 확인한 뒤 이 창을 닫아 주세요.'); }
});

const initial = await request('RUNNER_HELLO');
if (!initial?.ok) clearLocal(initial?.code || 'job_lost');
else {
  capability = initial.capability; job = initial.job;
  for (const [index,url] of job.profiles.entries()) {
    const li = document.createElement('li'), label = document.createElement('strong'), state = document.createElement('span');
    label.textContent = '@'+new URL(url).pathname.split('/')[1]; state.textContent = labels[job.results?.find(r=>r.index === index)?.state] || '실행 전'; li.append(label,state); ui.targets.append(li);
  }
  ui.confirmed.disabled = false; ui.stop.disabled = false;
  ui.expiry.textContent = `작업 만료: ${new Date(job.expiresAt).toLocaleTimeString('ko-KR')}`;
  say('아직 팔로우를 실행하지 않았습니다. 위 계정을 확인한 뒤 시작해 주세요.');
  if (job.started) halt(job.terminalError || 'not_confirmed',job.index < job.profiles.length ? job.index : undefined);
  expiryTimer = setTimeout(()=>void stop('expired'),Math.max(0,job.expiresAt-Date.now()));
  heartbeat = setInterval(async()=>{
    const ping = await request('RUNNER_PING');
    if (!ping?.ok && !stopped) clearLocal(ping?.code || 'job_lost');
  },5000);
}
