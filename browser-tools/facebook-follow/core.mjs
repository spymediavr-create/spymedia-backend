export const ADMIN_ORIGIN='https://spymedia-backend.onrender.com';
export const FACEBOOK_ORIGIN='https://www.facebook.com';
export const ACTOR='61594869881531';
export const ACTOR_NAME='스파이미디어';
export const SOURCE='spymedia-admin-facebook-follow';
export const MAX_PROFILES=10;
export const MAX_TTL=15*60*1000;
export const VERSION='0.1.0';
export const RESERVED=new Set(['me','l.php','home.php','profile.php','login','login.php','logout.php','sharer','sharer.php','share.php','dialog','watch','reel','reels','stories','groups','pages','events','marketplace','gaming','help','privacy','settings','photo.php','permalink.php','story.php','recover','checkpoint','friends','notifications','messages','search','business','ads','policies','terms']);

export function isAdminUrl(value){
  try{const u=new URL(value);return u.origin===ADMIN_ORIGIN&&u.pathname==='/admin'&&!u.username&&!u.password;}catch{return false;}
}

// Accept only the exact canonical profile URLs produced by the administrator.
// A post, group, redirect or tracking URL is never guessed to be a profile.
export function canonicalProfile(value){
  if(typeof value!=='string'||value.length>160||/[\s\\]/.test(value))return null;
  try{
    const u=new URL(value);
    if(u.origin!==FACEBOOK_ORIGIN||u.username||u.password||u.hash)return null;
    if(u.pathname==='/profile.php'&&/^\?id=\d{1,30}$/.test(u.search)){
      const canonical=FACEBOOK_ORIGIN+'/profile.php?id='+u.searchParams.get('id');
      return value===canonical?canonical:null;
    }
    const match=u.pathname.match(/^\/([a-z0-9.]{1,100})$/);
    if(!match||u.search||RESERVED.has(match[1])||/^\d+$/.test(match[1])||/^\.+$/.test(match[1]))return null;
    const canonical=FACEBOOK_ORIGIN+'/'+match[1];
    return value===canonical?canonical:null;
  }catch{return null;}
}

export function validatePreparation(message,now=Date.now()){
  const reject=code=>({ok:false,code});
  if(!message||typeof message!=='object'||Array.isArray(message))return reject('invalid_message');
  const keys=['source','type','requestId','platform','expectedAccount','profiles','expiresAt','control'];
  if(Object.keys(message).some(key=>!keys.includes(key)))return reject('invalid_message');
  if(message.source!==SOURCE||message.type!=='PREPARE'||message.platform!=='facebook'||message.expectedAccount!==ACTOR||message.control!=='admin')return reject('invalid_message');
  if(typeof message.requestId!=='string'||!/^[A-Za-z0-9_-]{8,80}$/.test(message.requestId))return reject('invalid_request');
  if(!Number.isSafeInteger(message.expiresAt)||message.expiresAt<=now||message.expiresAt>now+MAX_TTL)return reject('expired');
  if(!Array.isArray(message.profiles)||!message.profiles.length||message.profiles.length>MAX_PROFILES)return reject('selection_limit');
  const profiles=message.profiles.map(canonicalProfile);
  if(profiles.some(value=>!value)||new Set(profiles).size!==profiles.length||profiles.includes(FACEBOOK_ORIGIN+'/profile.php?id='+ACTOR))return reject('invalid_profile');
  return {ok:true,value:{requestId:message.requestId,expectedAccount:ACTOR,expectedName:ACTOR_NAME,profiles,expiresAt:message.expiresAt,control:'admin'}};
}

export function validateAdminCommand(message){
  if(!message||typeof message!=='object'||Array.isArray(message)||message.source!==SOURCE||typeof message.type!=='string'||typeof message.requestId!=='string'||!/^[A-Za-z0-9_-]{8,80}$/.test(message.requestId))return {ok:false,code:'invalid_message'};
  const commands={PING:[],CANCEL:[],STATUS:[],START:['confirmed'],STEP:['index']};
  if(!Object.hasOwn(commands,message.type)||Object.keys(message).some(key=>!['source','type','requestId',...commands[message.type]].includes(key)))return {ok:false,code:'invalid_message'};
  if(message.type==='START'&&message.confirmed!==true)return {ok:false,code:'not_confirmed'};
  if(message.type==='STEP'&&(!Number.isSafeInteger(message.index)||message.index<0||message.index>=MAX_PROFILES))return {ok:false,code:'invalid_message'};
  return {ok:true};
}

// No storage API: closing the owner or restarting the worker destroys the job.
export class EphemeralJobs{
  constructor({now=Date.now,token=()=>crypto.randomUUID()}={}){this.now=now;this.token=token;this.jobs=new Map();}
  prepare(message,adminTabId){
    this.expire();const parsed=validatePreparation(message,this.now());if(!parsed.ok)return parsed;
    if(this.jobs.size)return {ok:false,code:'job_exists'};
    const capability=this.token(),job={...parsed.value,capability,adminTabId,facebookTabId:null,index:0,started:false,running:false,busy:false,cancelled:false,terminalError:null,results:[]};
    this.jobs.set(capability,job);return {ok:true,job};
  }
  get(capability){this.expire();return this.jobs.get(capability)||null;}
  getAdmin(adminTabId,requestId){this.expire();return [...this.jobs.values()].find(job=>job.adminTabId===adminTabId&&job.requestId===requestId)||null;}
  cancelAdmin(adminTabId,requestId){for(const [key,job]of this.jobs)if(job.adminTabId===adminTabId&&(!requestId||job.requestId===requestId)){job.cancelled=true;job.profiles.length=0;job.results.length=0;this.jobs.delete(key);}}
  cancel(capability){const job=this.jobs.get(capability);if(job)this.cancelAdmin(job.adminTabId,job.requestId);}
  expire(){for(const [key,job]of this.jobs)if(job.expiresAt<=this.now())this.cancel(key);}
}
