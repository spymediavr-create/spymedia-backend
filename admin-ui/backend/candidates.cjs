const crypto = require('node:crypto');
const {ID} = require('./store.cjs');
const {error} = require('./errors.cjs');
const regions = import('../public/candidate-regions.js');
const PLATFORMS = ['instagram', 'facebook', 'x', 'blog'];
const STATUSES = ['pending', 'excluded', 'done'];
const LIMITS = {accountName:120, industry:100, region:100, reason:1000, note:2000};
const MAX_CANDIDATES = 2000;
const own = (object, key) => Object.hasOwn(object, key);
function object(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw error(400, 'invalid_candidate_input');
}
function text(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) || required && !value.trim()) throw error(400, 'invalid_candidate_input');
  return value.trim();
}
// Links are stored as profile-only HTTPS URLs. Never fetch or resolve a candidate URL.
function profileUrl(platform, value) {
  if (typeof value !== 'string' || value.length > 2048 || !/^https:\/\//i.test(value) || /[\s\\]/u.test(value)) throw error(400, 'invalid_candidate_url');
  let url;
  try { url = new URL(value); } catch { throw error(400, 'invalid_candidate_url'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw error(400, 'invalid_candidate_url');
  const host = url.hostname.toLowerCase(), path = url.pathname.replace(/\/$/, '');
  const single = /^\/([a-z0-9_.-]+)$/i.exec(path)?.[1];
  let account;
  if (platform === 'instagram' && ['instagram.com','www.instagram.com'].includes(host) && single && /^[a-z0-9_.]{1,30}$/i.test(single) && !['p','reel','reels','stories','explore','accounts','direct','about','developer','web'].includes(single.toLowerCase()) && !/^\.+$/.test(single)) {
    return 'https://www.instagram.com/' + single.toLowerCase() + '/';
  }
  if (platform === 'facebook' && ['facebook.com','www.facebook.com','m.facebook.com'].includes(host)) {
    if (path === '/profile.php' && /^\d{1,30}$/.test(url.searchParams.get('id') || '') && url.searchParams.getAll('id').length === 1) return 'https://www.facebook.com/profile.php?id=' + url.searchParams.get('id');
    // Numeric IDs from /people/name/ID and /ID share one duplicate key.
    const person = /^\/people\/[^/]{1,200}\/(\d{1,30})$/i.exec(path);
    account = person?.[1] || single;
    if (account && /^[a-z0-9.]{1,100}$/i.test(account) && !['l.php','home.php','profile.php','login','login.php','logout.php','sharer','sharer.php','share.php','dialog','watch','reel','reels','stories','groups','pages','events','marketplace','gaming','help','privacy','settings','photo.php','permalink.php','story.php','recover','checkpoint'].includes(account.toLowerCase()) && !/^\.+$/.test(account)) {
      return /^\d+$/.test(account) ? 'https://www.facebook.com/profile.php?id=' + account : 'https://www.facebook.com/' + account.toLowerCase();
    }
  }
  if (platform === 'x' && ['x.com','www.x.com','twitter.com','www.twitter.com','mobile.twitter.com'].includes(host) && single && /^[a-z0-9_]{1,15}$/i.test(single) && !['home','i','intent','settings','search','explore','messages','compose','notifications','login','logout','signup','share','tos','privacy'].includes(single.toLowerCase())) {
    return 'https://x.com/' + single.toLowerCase();
  }
  if (platform === 'blog' && ['blog.naver.com','m.blog.naver.com'].includes(host)) {
    account = path === '/PostList.naver' && url.searchParams.getAll('blogId').length === 1 ? url.searchParams.get('blogId') : single;
    if (account && /^[a-z0-9_-]{1,50}$/i.test(account)) return 'https://blog.naver.com/' + account.toLowerCase();
  }
  throw error(400, 'invalid_candidate_url');
}
function fields(body, previous) {
  const platform = own(body, 'platform') ? body.platform : previous?.platform;
  if (!PLATFORMS.includes(platform)) throw error(400, 'invalid_candidate_input');
  const result = {platform};
  for (const [key,max] of Object.entries(LIMITS)) result[key] = own(body,key) ? text(body[key],max,key === 'accountName') : previous?.[key] ?? '';
  if (!result.accountName) throw error(400,'invalid_candidate_input');
  result.profileUrl = profileUrl(platform, own(body,'profileUrl') ? body.profileUrl : previous?.profileUrl);
  return result;
}
function revision(value) { if (!Number.isSafeInteger(value) || value < 1) throw error(400,'invalid_candidate_input'); }
function changes(body) {
  object(body,['selected','status']);
  if (!Object.keys(body).length || own(body,'selected') && typeof body.selected !== 'boolean' || own(body,'status') && !STATUSES.includes(body.status)) throw error(400,'invalid_candidate_input');
  return body;
}
function apply(item, patch, now) {
  const next = {...item,...patch,updatedAt:now,revision:item.revision+1};
  if (own(patch,'status') && patch.status !== item.status) next.manualDoneAt = patch.status === 'done' ? now : null;
  return next;
}
class Candidates {
  constructor(store) { this.store = store; }
  transaction(fn) {
    let previous, present = false, started = false;
    return this.store.transaction(state => {
      present = own(state,'candidates'); previous = state.candidates; started = true;
      // Candidate writes replace records rather than mutating existing records.
      // Keep the prior collection so a failed disk save also rolls back memory.
      state.candidates = {...previous};
      return fn(state);
    }, state => {
      if (started) { if (present) state.candidates = previous; else delete state.candidates; }
    });
  }
  async list({platform='instagram',status='all',industry='',region='',q='',offset=0,limit=10}={}) {
    if (!PLATFORMS.includes(platform) || !['all',...STATUSES].includes(status) || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw error(400,'invalid_candidate_query');
    try {
      industry = text(industry,100).toLocaleLowerCase('ko');
      q = text(q,200).toLocaleLowerCase('ko');
      region = text(region,100).toLocaleLowerCase('ko');
    } catch { throw error(400,'invalid_candidate_query'); }
    await this.store.init();
    await this.store.tail;
    const {matchesRegion,matchesRegionKeyword}=await regions;
    const records = Object.values(this.store.state.candidates || {}).filter(item => item.platform === platform && (status === 'all' || item.status === status) && (!industry || item.industry.toLocaleLowerCase('ko') === industry) && matchesRegion(item.region,region) && (!q || (['accountName','industry','region','reason','note','profileUrl'].some(key => item[key].toLocaleLowerCase('ko').includes(q)) || matchesRegionKeyword(item.region,q)))).sort((a,b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    return {platform,status,industry,region,q,total:records.length,selectedCount:records.filter(item=>item.selected).length,offset,limit,items:records.slice(offset,offset+limit)};
  }
  async create(body) {
    object(body,['platform','profileUrl',...Object.keys(LIMITS)]);
    const input = fields(body);
    return this.transaction(state => {
      const records = Object.values(state.candidates || {});
      if (records.some(item => item.platform === input.platform && item.profileUrl === input.profileUrl)) throw error(409,'duplicate_candidate');
      if (records.length >= MAX_CANDIDATES) throw error(409,'candidate_limit');
      const now = new Date().toISOString();
      const item = {id:crypto.randomUUID(),...input,selected:false,status:'pending',manualDoneAt:null,revision:1,createdAt:now,updatedAt:now};
      (state.candidates ||= {})[item.id] = item;
      return item;
    });
  }
  async update(id, body) {
    if (typeof id !== 'string' || !ID.test(id)) throw error(404,'not_found');
    object(body,['revision','platform','profileUrl',...Object.keys(LIMITS),'selected','status']);
    revision(body.revision);
    if (Object.keys(body).length < 2) throw error(400,'invalid_candidate_input');
    const patch = {};
    for (const key of ['selected','status']) if (own(body,key)) patch[key] = body[key];
    if (Object.keys(patch).length) changes(patch);
    return this.transaction(state => {
      const previous = state.candidates?.[id];
      if (!previous) throw error(404,'not_found');
      if (previous.revision !== body.revision) throw error(409,'candidate_conflict');
      const input = fields(body,previous);
      if (Object.values(state.candidates).some(item => item.id !== id && item.platform === input.platform && item.profileUrl === input.profileUrl)) throw error(409,'duplicate_candidate');
      return state.candidates[id] = apply(previous,{...input,...patch},new Date().toISOString());
    });
  }
  async batch(body) {
    object(body,['items','changes']);
    if (!Array.isArray(body.items) || !body.items.length || body.items.length > 50) throw error(400,'invalid_candidate_selection');
    const ids = new Set();
    for (const entry of body.items) {
      object(entry,['id','revision']); revision(entry.revision);
      if (typeof entry.id !== 'string' || !ID.test(entry.id) || ids.has(entry.id)) throw error(400,'invalid_candidate_selection');
      ids.add(entry.id);
    }
    const patch = changes(body.changes);
    return this.transaction(state => {
      // Validate every record before mutating any of them.
      const records = body.items.map(entry => {
        const item = state.candidates?.[entry.id];
        if (!item) throw error(404,'not_found');
        if (entry.revision !== item.revision) throw error(409,'candidate_conflict');
        return item;
      });
      const now = new Date().toISOString();
      return records.map(item => state.candidates[item.id] = apply(item,patch,now));
    });
  }
}
module.exports = {Candidates, profileUrl};
