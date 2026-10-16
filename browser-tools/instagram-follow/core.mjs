export const ADMIN_ORIGIN = 'https://spymedia-backend.onrender.com';
export const ACTOR = 'spymedia_kr';
export const MAX_PROFILES = 10;
export const MAX_TTL = 15 * 60 * 1000;
export const RESERVED = new Set(['accounts','about','api','challenge','checkpoint','developer','developers','direct','directory','emails','explore','legal','oauth','p','press','privacy','reel','reels','reels_tab','settings','stories','terms','web','your_activity']);

export function isAdminUrl(value) {
  try { const u = new URL(value); return u.origin === ADMIN_ORIGIN && u.pathname === '/admin' && !u.username && !u.password; } catch { return false; }
}

export function canonicalProfile(value) {
  if (typeof value !== 'string' || value.length > 120 || /[\s\\]/.test(value)) return null;
  try {
    const u = new URL(value), match = u.pathname.match(/^\/([A-Za-z0-9._]{1,30})\/$/);
    if (u.origin !== 'https://www.instagram.com' || u.username || u.password || u.search || u.hash || !match) return null;
    const name = match[1].toLowerCase();
    if (RESERVED.has(name) || name.startsWith('.') || name.endsWith('.') || name.includes('..')) return null;
    const canonical = `https://www.instagram.com/${name}/`;
    return value === canonical ? canonical : null;
  } catch { return null; }
}

export function validatePreparation(message, now = Date.now()) {
  const reject = code => ({ok:false, code});
  if (!message || typeof message !== 'object' || Array.isArray(message)) return reject('invalid_message');
  const keys = ['source','type','requestId','platform','expectedAccount','profiles','expiresAt'];
  if (Object.keys(message).some(key => !keys.includes(key))) return reject('invalid_message');
  if (message.source !== 'spymedia-admin-follow' || message.type !== 'PREPARE' || message.platform !== 'instagram' || message.expectedAccount !== ACTOR) return reject('invalid_message');
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(message.requestId || '')) return reject('invalid_request');
  if (!Number.isSafeInteger(message.expiresAt) || message.expiresAt <= now || message.expiresAt > now + MAX_TTL) return reject('expired');
  if (!Array.isArray(message.profiles) || !message.profiles.length || message.profiles.length > MAX_PROFILES) return reject('selection_limit');
  const profiles = message.profiles.map(canonicalProfile);
  if (profiles.some(value => !value) || new Set(profiles).size !== profiles.length || profiles.includes(`https://www.instagram.com/${ACTOR}/`)) return reject('invalid_profile');
  return {ok:true, value:{requestId:message.requestId, expectedAccount:ACTOR, profiles, expiresAt:message.expiresAt}};
}

// Only memory is used. A service-worker restart loses the job and cannot resume it.
export class EphemeralJobs {
  constructor({now = Date.now, token = () => crypto.randomUUID()} = {}) { this.now = now; this.token = token; this.jobs = new Map(); }
  prepare(message, adminTabId) {
    this.expire();
    const parsed = validatePreparation(message, this.now());
    if (!parsed.ok) return parsed;
    if (this.jobs.size) return {ok:false,code:'job_exists'};
    const capability = this.token();
    const job = {...parsed.value, capability, adminTabId, runnerTabId:null, instagramTabId:null, index:0, started:false, running:false, busy:false, cancelled:false, terminalError:null, results:[]};
    this.jobs.set(capability, job); return {ok:true,job};
  }
  get(capability) { this.expire(); return this.jobs.get(capability) || null; }
  cancelAdmin(adminTabId, requestId) {
    for (const [key,j] of this.jobs) if (j.adminTabId === adminTabId && (!requestId || j.requestId === requestId)) { j.cancelled = true; j.profiles.length = 0; j.results.length = 0; this.jobs.delete(key); }
  }
  cancel(capability) { const j = this.jobs.get(capability); if (j) this.cancelAdmin(j.adminTabId,j.requestId); }
  expire() { for (const [key,j] of this.jobs) if (j.expiresAt <= this.now()) this.cancel(key); }
}

export const messages = {
  invalid_message:'전달된 작업 형식을 확인할 수 없습니다.', invalid_request:'작업 식별자가 올바르지 않습니다.', expired:'검색 작업의 유효 시간이 끝났습니다. 다시 검색해 주세요.',
  selection_limit:'한 번에 검토할 프로필은 1~10개입니다.', invalid_profile:'허용되지 않거나 중복된 프로필이 포함되어 있습니다.', job_exists:'이미 준비된 작업이 있습니다. 기존 작업을 종료해 주세요.',
  job_lost:'작업이 만료되거나 브라우저 확장 기능이 재시작됐습니다. 자동 재시도하지 않습니다.', cancelled:'작업이 중지되었습니다.',
  account_unverified:'로그인 계정을 화면에서 확인할 수 없어 중지했습니다.', account_mismatch:'로그인 계정이 spymedia_kr와 달라 중지했습니다.',
  login_required:'Instagram 로그인이 필요합니다. 로그인 후 새 작업을 준비해 주세요.', challenge:'Instagram 추가 인증 또는 활동 제한이 감지되어 중지했습니다.',
  wrong_profile:'열린 프로필이 선택한 대상과 달라 중지했습니다.', ambiguous_profile:'프로필 또는 팔로우 버튼을 명확히 확인할 수 없어 중지했습니다.',
  unsupported_language:'지원하는 팔로우 상태를 확인할 수 없습니다. 한국어·영어 화면만 지원합니다.',
  uncertain:'클릭 이후 결과를 확정할 수 없어 중지했습니다. Instagram에서 직접 확인하세요. 자동으로 다시 클릭하지 않습니다.',
  browser_error:'브라우저 동작을 확인할 수 없어 중지했습니다. 실제 계정의 상태를 직접 확인하세요.', not_confirmed:'실행 계정과 대상을 확인한 뒤 시작해 주세요.'
};
