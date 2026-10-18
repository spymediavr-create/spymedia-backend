export const ADMIN_ORIGIN='https://spymedia-backend.onrender.com';
export const NAVER_ORIGIN='https://blog.naver.com';
export const ACTOR='spymedia';
// This is the verified blog ID, not an inferred Naver login ID or display name.
export const ACTOR_NAME=ACTOR;
export const SOURCE='spymedia-admin-naver-neighbor';
export const MAX_PROFILES=10;
export const MAX_TTL=15*60*1000;
export const VERSION='0.1.2';
export const RESERVED=new Set(['me','myblog','admin','login','logout','help','search','feed','postlist','postview','bloghome','blogpeople','neighbor','neighbors','buddy','buddyadd','manage','settings','write','section','service','notice']);

export function isAdminUrl(value){
  try{const u=new URL(value);return u.origin===ADMIN_ORIGIN&&u.pathname==='/admin'&&!u.username&&!u.password;}catch{return false;}
}

// The administrator explicitly reviews a canonical blog profile before handing
// it to this tool. Posts, redirects, tracking URLs and mobile aliases are not
// reinterpreted by the extension.
export function canonicalProfile(value){
  if(typeof value!=='string'||value.length>100||/[\s\\\x00-\x1f\x7f]/.test(value))return null;
  try{
    const u=new URL(value),match=u.pathname.match(/^\/([a-z0-9_-]{1,50})$/);
    if(u.origin!==NAVER_ORIGIN||u.username||u.password||u.search||u.hash||!match||RESERVED.has(match[1]))return null;
    const canonical=NAVER_ORIGIN+'/'+match[1];
    return value===canonical?canonical:null;
  }catch{return null;}
}

export function validatePreparation(message,now=Date.now()){
  const reject=code=>({ok:false,code});
  if(!message||typeof message!=='object'||Array.isArray(message))return reject('invalid_message');
  const keys=['source','type','requestId','platform','expectedAccount','profiles','expiresAt','control'];
  if(Object.keys(message).length!==keys.length||keys.some(key=>!Object.hasOwn(message,key)))return reject('invalid_message');
  if(message.source!==SOURCE||message.type!=='PREPARE'||message.platform!=='blog'||message.expectedAccount!==ACTOR||message.control!=='admin')return reject('invalid_message');
  if(typeof message.requestId!=='string'||!/^[A-Za-z0-9_-]{8,80}$/.test(message.requestId))return reject('invalid_request');
  if(!Number.isSafeInteger(message.expiresAt)||message.expiresAt<=now||message.expiresAt>now+MAX_TTL)return reject('expired');
  if(!Array.isArray(message.profiles)||!message.profiles.length||message.profiles.length>MAX_PROFILES)return reject('selection_limit');
  const profiles=Array.from(message.profiles,canonicalProfile);
  if(profiles.some(value=>!value)||new Set(profiles).size!==profiles.length||profiles.includes(NAVER_ORIGIN+'/'+ACTOR))return reject('invalid_profile');
  return {ok:true,value:{requestId:message.requestId,expectedAccount:ACTOR,expectedName:ACTOR_NAME,profiles,expiresAt:message.expiresAt,control:'admin'}};
}

export function validateAdminCommand(message){
  if(!message||typeof message!=='object'||Array.isArray(message)||message.source!==SOURCE||typeof message.type!=='string'||typeof message.requestId!=='string'||!/^[A-Za-z0-9_-]{8,80}$/.test(message.requestId))return {ok:false,code:'invalid_message'};
  const commands={PING:[],CANCEL:[],STATUS:[],START:['confirmed'],STEP:['index']};
  if(!Object.hasOwn(commands,message.type))return {ok:false,code:'invalid_message'};
  const keys=['source','type','requestId',...commands[message.type]];
  if(Object.keys(message).length!==keys.length||keys.some(key=>!Object.hasOwn(message,key)))return {ok:false,code:'invalid_message'};
  if(message.type==='START'&&message.confirmed!==true)return {ok:false,code:'not_confirmed'};
  if(message.type==='STEP'&&(!Number.isSafeInteger(message.index)||message.index<0||message.index>=MAX_PROFILES))return {ok:false,code:'invalid_message'};
  return {ok:true};
}

// No storage API: the list and progress belong to one administrator tab and
// disappear when it closes, expires or the service worker restarts.
export class EphemeralJobs{
  constructor({now=Date.now,token=()=>crypto.randomUUID()}={}){this.now=now;this.token=token;this.jobs=new Map();}
  prepare(message,adminTabId){
    this.expire();
    if(!Number.isSafeInteger(adminTabId)||adminTabId<1)return {ok:false,code:'invalid_message'};
    const parsed=validatePreparation(message,this.now());if(!parsed.ok)return parsed;
    if(this.jobs.size)return {ok:false,code:'job_exists'};
    const capability=this.token(),job={...parsed.value,capability,adminTabId,naverTabId:null,popupTabIds:new Set(),index:0,started:false,running:false,busy:false,cancelled:false,terminalError:null,results:[]};
    this.jobs.set(capability,job);return {ok:true,job};
  }
  get(capability){this.expire();return this.jobs.get(capability)||null;}
  getAdmin(adminTabId,requestId){this.expire();return [...this.jobs.values()].find(job=>job.adminTabId===adminTabId&&job.requestId===requestId)||null;}
  cancelAdmin(adminTabId,requestId){for(const [key,job]of this.jobs)if(job.adminTabId===adminTabId&&(!requestId||job.requestId===requestId)){job.cancelled=true;job.profiles.length=0;job.results.length=0;job.popupTabIds.clear();this.jobs.delete(key);}}
  cancel(capability){const job=this.jobs.get(capability);if(job)this.cancelAdmin(job.adminTabId,job.requestId);}
  expire(){for(const [key,job]of this.jobs)if(job.expiresAt<=this.now())this.cancel(key);}
}
