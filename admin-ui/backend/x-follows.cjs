const crypto = require('node:crypto');
const {error} = require('./errors.cjs');

const SOURCE_USERNAME = 'spymedia_kor';
const USER_ID = /^\d{1,19}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const TOKEN = /^[a-f0-9]{64}$/;
const STATUSES = new Set(['unknown','followed','requested','failed']);
const ERRORS = new Set(['x_follow_result_unknown','x_follow_auth_required','x_follow_permission_required','x_follow_cost_required','x_follow_rate_limited','x_follow_target_unavailable','x_follow_rejected','x_follow_not_completed']);
const TTL = 5 * 60 * 1000, PREPARE_INTERVAL = 5000, MAX_PREPARATIONS = 10, MAX_RECORDS = 2000;
const object = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
function username(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_]{1,15}$/.test(value)) throw error(400,'invalid_x_follow_input');
  return value.toLowerCase();
}
function keyFor(sourceId,targetId) { return crypto.createHash('sha256').update(sourceId+':'+targetId).digest('hex'); }
function result(record) {
  return {operationId:record.id,status:record.status,sourceUserId:record.sourceUserId,targetUserId:record.targetUserId,createdAt:record.createdAt,updatedAt:record.updatedAt,requestAttempted:true,...(record.errorCode ? {errorCode:record.errorCode} : {})};
}
function records(state) {
  if (state.xFollows === undefined) return {};
  const collection=state.xFollows;
  if (!object(collection,['version','records']) || collection.version!==1 || !collection.records || typeof collection.records!=='object' || Array.isArray(collection.records)) throw error(503,'x_follow_storage_unavailable');
  const entries=Object.entries(collection.records);
  if (entries.length>MAX_RECORDS) throw error(503,'x_follow_storage_unavailable');
  for (const [key,record] of entries) {
    if (!object(record,['id','sourceUserId','targetUserId','status','createdAt','updatedAt','errorCode']) || typeof record.id!=='string' || !UUID.test(record.id) || typeof record.sourceUserId!=='string' || !USER_ID.test(record.sourceUserId) || typeof record.targetUserId!=='string' || !USER_ID.test(record.targetUserId) || record.sourceUserId===record.targetUserId || key!==keyFor(record.sourceUserId,record.targetUserId) || !STATUSES.has(record.status) || typeof record.createdAt!=='string' || !Number.isFinite(Date.parse(record.createdAt)) || typeof record.updatedAt!=='string' || !Number.isFinite(Date.parse(record.updatedAt)) || record.errorCode!==undefined&&!ERRORS.has(record.errorCode)) throw error(503,'x_follow_storage_unavailable');
  }
  return collection.records;
}
function safeFailure(cause, duringPost=false) {
  // Never forward the provider body, request headers, URL, or error message.
  const status=cause?.providerDetails?.httpStatus ?? cause?.status;
  const codes={401:'x_follow_auth_required',402:'x_follow_cost_required',403:'x_follow_permission_required',404:'x_follow_target_unavailable',429:'x_follow_rate_limited',400:'x_follow_rejected'};
  if (codes[status]) return error([401,402,403].includes(status)?409:status,codes[status]);
  if (!duringPost && ['x_auth_expired','x_auth_configuration','x_refresh_reauthorization_required'].includes(cause?.code)) return error(409,'x_follow_auth_required');
  return error(502,duringPost?'x_follow_result_unknown':'x_follow_lookup_failed',duringPost);
}

// One reviewed account per operation. There is intentionally no batch, queue,
// scheduler, follow-back, unfollow, or automatic POST retry entry point.
class XFollows {
  constructor(settings,store,xAuth,options={}) {
    this.settings=settings;this.store=store;this.xAuth=xAuth;this.now=options.now||Date.now;
    this.preparations=new Map();this.busy=false;this.nextPrepareAt=0;
    this.schedule=options.schedule||((callback,delay)=>{const timer=setTimeout(callback,delay);timer.unref?.();return timer;});
  }
  status() {
    const enabled=this.settings.env.X_FOLLOW_ENABLED==='true';
    const credentialsConfigured=this.xAuth?.configured?.()===true;
    const costAcknowledged=this.settings.env.X_COST_LIMIT_ACKNOWLEDGED==='true';
    const storageConfigured=this.settings.storageConfigured===true;
    return {enabled,ready:enabled&&credentialsConfigured&&costAcknowledged&&storageConfigured,credentialsConfigured,costAcknowledged,storageConfigured,sourceUsername:SOURCE_USERNAME,mode:'single-reviewed-target',followPermissionsVerified:false,requiredOAuth2Scopes:['tweet.read','users.read','follows.write']};
  }
  requireReady() {
    const state=this.status();
    if (!state.enabled) throw error(503,'x_follow_disabled');
    if (!state.costAcknowledged) throw error(409,'x_cost_confirmation_required');
    if (!state.credentialsConfigured) throw error(503,'x_follow_auth_required');
    if (!state.storageConfigured) throw error(503,'x_follow_storage_unavailable');
  }
  acquire() { if (this.busy) throw error(409,'x_follow_busy');this.busy=true; }
  prune() { const now=this.now();for (const [id,prepared] of this.preparations) if (prepared.expiresAt<=now) this.preparations.delete(id); }
  async initialize() {
    try { await this.store.init();await this.store.tail;records(this.store.state); }
    catch { throw error(503,'x_follow_storage_unavailable'); }
  }
  async identity() {
    let data;
    try { data=(await this.xAuth.call('GET','https://api.x.com/2/users/me',undefined,{allowRefresh:false})).data?.data; }
    catch (e) { throw safeFailure(e); }
    if (data?.username!==SOURCE_USERNAME || typeof data.id!=='string' || !USER_ID.test(data.id)) throw error(409,'account_mismatch');
    return {userId:data.id,username:SOURCE_USERNAME};
  }
  async prepare(body) {
    if (!object(body,['username','selectionExpiresAt']) || !Object.hasOwn(body,'username')) throw error(400,'invalid_x_follow_input');
    if (body.selectionExpiresAt!==undefined && (!Number.isSafeInteger(body.selectionExpiresAt) || body.selectionExpiresAt>this.now()+15*60*1000)) throw error(400,'invalid_x_follow_input');
    if (body.selectionExpiresAt!==undefined && body.selectionExpiresAt<=this.now()) throw error(409,'x_follow_selection_expired');
    const requested=username(body.username);this.requireReady();this.acquire();
    try {
      const now=this.now();
      if (now<this.nextPrepareAt) throw Object.assign(error(429,'x_follow_prepare_rate_limited'),{retryAfter:Math.max(1,Math.ceil((this.nextPrepareAt-now)/1000))});
      this.nextPrepareAt=now+PREPARE_INTERVAL;this.prune();
      if (this.preparations.size>=MAX_PREPARATIONS) throw error(409,'x_follow_preparation_limit');
      await this.initialize();
      const source=await this.identity();
      let data;
      try { data=(await this.xAuth.call('GET','https://api.x.com/2/users/by/username/'+encodeURIComponent(requested),undefined,{allowRefresh:false})).data?.data; }
      catch (e) { throw safeFailure(e); }
      if (typeof data?.id!=='string' || !USER_ID.test(data.id) || typeof data.username!=='string' || !/^[a-zA-Z0-9_]{1,15}$/.test(data.username) || data.username.toLowerCase()!==requested) throw error(502,'x_follow_lookup_failed');
      if (data.id===source.userId || requested===SOURCE_USERNAME) throw error(400,'x_follow_self');
      const name=typeof data.name==='string' ? data.name.replace(/[\u0000-\u001f\u007f]/g,'').slice(0,120) : data.username;
      const target={userId:data.id,username:data.username,name,profileUrl:'https://x.com/'+data.username};
      const preparationId=crypto.randomUUID(),confirmationToken=crypto.randomBytes(32).toString('hex'),expiresAt=Math.min(this.now()+TTL,body.selectionExpiresAt??Infinity);
      if (expiresAt<=this.now()) throw error(409,'x_follow_selection_expired');
      const prepared={source,target,confirmationToken,expiresAt,key:keyFor(source.userId,target.userId)};
      this.preparations.set(preparationId,prepared);
      // Delete transient search-derived identity even when no further requests arrive.
      this.schedule(()=>this.preparations.delete(preparationId),Math.max(1,expiresAt-this.now()));
      const existing=records(this.store.state)[prepared.key];
      return {preparationId,confirmationToken,expiresAt:new Date(expiresAt).toISOString(),source,target,existingResult:existing?result(existing):null};
    } finally { this.busy=false; }
  }
  async transaction(fn) {
    let previous,present=false,started=false;
    return this.store.transaction(state=>{
      const current=records(state);present=Object.hasOwn(state,'xFollows');previous=state.xFollows;started=true;
      state.xFollows={version:1,records:{...current}};return fn(state.xFollows.records);
    },state=>{if(started){if(present)state.xFollows=previous;else delete state.xFollows;}});
  }
  async execute(body) {
    const allowed=['preparationId','confirmationToken','confirmUsername','confirmTargetUserId','confirmed'];
    if (!object(body,allowed) || allowed.some(key=>!Object.hasOwn(body,key)) || body.confirmed!==true || typeof body.preparationId!=='string' || !UUID.test(body.preparationId) || typeof body.confirmationToken!=='string' || !TOKEN.test(body.confirmationToken) || typeof body.confirmTargetUserId!=='string' || !USER_ID.test(body.confirmTargetUserId)) throw error(400,'invalid_x_follow_confirmation');
    const confirmedUsername=username(body.confirmUsername);this.requireReady();this.acquire();
    try {
      this.prune();const prepared=this.preparations.get(body.preparationId);
      if (!prepared) throw error(409,'x_follow_preparation_expired');
      if (!crypto.timingSafeEqual(Buffer.from(prepared.confirmationToken,'hex'),Buffer.from(body.confirmationToken,'hex')) || confirmedUsername!==prepared.target.username.toLowerCase() || body.confirmTargetUserId!==prepared.target.userId) throw error(409,'x_follow_confirmation_mismatch');
      await this.initialize();
      const existing=records(this.store.state)[prepared.key];
      if (existing) return {...result(existing),duplicatePrevented:true};
      const source=await this.identity();
      if (source.userId!==prepared.source.userId) throw error(409,'account_mismatch');
      if (prepared.expiresAt<=this.now()) throw error(409,'x_follow_preparation_expired');
      const stamp=new Date(this.now()).toISOString();
      const record={id:crypto.randomUUID(),sourceUserId:source.userId,targetUserId:prepared.target.userId,status:'unknown',errorCode:'x_follow_result_unknown',createdAt:stamp,updatedAt:stamp};
      let reserved;
      try {
        reserved=await this.transaction(items=>{
          if (items[prepared.key]) return {created:false,item:items[prepared.key]};
          if (Object.keys(items).length>=MAX_RECORDS) throw error(409,'x_follow_record_limit');
          items[prepared.key]=record;return {created:true,item:record};
        });
      } catch (e) { if(e.code==='x_follow_record_limit')throw e;throw error(503,'x_follow_storage_unavailable'); }
      if (!reserved.created) return {...result(reserved.item),duplicatePrevented:true};
      // The durable unknown record is saved BEFORE the one external write. If
      // the process dies or the response is uncertain, neither restart nor a new
      // preparation may repeat that write for the same verified account pair.
      let completed;
      try {
        const response=(await this.xAuth.call('POST','https://api.x.com/2/users/'+source.userId+'/following',{target_user_id:prepared.target.userId},{allowRefresh:false})).data?.data;
        if (typeof response?.following!=='boolean' || typeof response.pending_follow!=='boolean') throw error(502,'x_follow_result_unknown',true);
        completed={...record,status:response.pending_follow?'requested':response.following?'followed':'failed',updatedAt:new Date(this.now()).toISOString()};
        delete completed.errorCode;
        if (completed.status==='failed') completed.errorCode='x_follow_not_completed';
      } catch (cause) {
        const failure=safeFailure(cause,true);
        completed={...record,status:failure.uncertain?'unknown':'failed',errorCode:failure.code,updatedAt:new Date(this.now()).toISOString()};
      }
      try { await this.transaction(items=>{items[prepared.key]=completed;}); }
      catch { return {...result(record),resultPersistenceFailed:true}; }
      return result(completed);
    } finally { this.busy=false; }
  }
  async result(operationId) {
    if (typeof operationId!=='string' || !UUID.test(operationId)) throw error(404,'not_found');
    await this.initialize();
    const record=Object.values(records(this.store.state)).find(item=>item.id===operationId);
    if (!record) throw error(404,'not_found');
    return result(record);
  }
}
module.exports={XFollows,SOURCE_USERNAME,TTL,PREPARE_INTERVAL};
