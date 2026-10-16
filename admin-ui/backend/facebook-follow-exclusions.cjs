const {error}=require('./errors.cjs');
const urls=import('../public/search-result-url.js');
const ACCOUNT='61594869881531',KEY='facebookFollowExclusions',MAX_RECORDS=10000;
// Keep profile acceptance aligned with the dedicated Facebook follow tool.
const RESERVED=new Set(['me','l.php','home.php','profile.php','login','login.php','logout.php','sharer','sharer.php','share.php','dialog','watch','reel','reels','stories','groups','pages','events','marketplace','gaming','help','privacy','settings','photo.php','permalink.php','story.php','recover','checkpoint','friends','notifications','messages','search','business','ads','policies','terms']);
const own=(object,key)=>Object.hasOwn(object,key);
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
function input(value,keys){
  if(!object(value)||Object.keys(value).length!==keys.length||keys.some(key=>!own(value,key)))throw error(400,'invalid_follow_exclusion');
}
function storedProfile(value){
  if(typeof value!=='string'||value.length>160)return false;
  const number=value.match(/^https:\/\/www\.facebook\.com\/profile\.php\?id=(\d{1,30})$/);
  if(number)return number[1]!==ACCOUNT;
  const name=value.match(/^https:\/\/www\.facebook\.com\/([a-z0-9.]{1,100})$/)?.[1];
  return !!name&&!RESERVED.has(name)&&!/^\d+$/.test(name)&&!/^\.+$/.test(name);
}
async function profileUrl(value){
  if(typeof value!=='string'||value.length>2048||/[\x00-\x1f\x7f]/.test(value))throw error(400,'invalid_follow_exclusion');
  const {searchResultUrl}=await urls,target=searchResultUrl('facebook',value);
  if(!target||target.kind!=='profile'||!storedProfile(target.url))throw error(400,'invalid_follow_exclusion');
  return target.url;
}
function collection(state){
  if(!own(state,KEY))return {};
  const root=state[KEY],records=object(root)&&own(root,ACCOUNT)?root[ACCOUNT]:null;
  if(!object(root)||!object(records)||Object.keys(records).length>MAX_RECORDS)throw error(503,'storage_unavailable');
  for(const [key,item]of Object.entries(records)){
    if(!storedProfile(key)||!object(item)||Object.keys(item).length!==3||!own(item,'profileUrl')||!own(item,'state')||!own(item,'confirmedAt')||item.profileUrl!==key||item.state!=='following'||typeof item.confirmedAt!=='string'||!Number.isFinite(Date.parse(item.confirmedAt)))throw error(503,'storage_unavailable');
  }
  return records;
}
class FacebookFollowExclusions{
  constructor(store,options={}){this.store=store;this.now=options.now||(()=>new Date().toISOString());}
  async ready(){await this.store.init();await this.store.tail;collection(this.store.state);}
  transaction(fn){
    let present=false,previous,started=false;
    return this.store.transaction(state=>{
      const records=collection(state);present=own(state,KEY);previous=state[KEY];started=true;
      const next=Object.assign(Object.create(null),records);state[KEY]={...(previous||{}),[ACCOUNT]:next};
      return fn(next);
    },state=>{if(started){if(present)state[KEY]=previous;else delete state[KEY];}});
  }
  async save(body){
    input(body,['account','items']);
    if(body.account!==ACCOUNT||!Array.isArray(body.items)||body.items.length<1||body.items.length>10)throw error(400,'invalid_follow_exclusion');
    const profiles=new Set();
    for(const item of body.items){
      input(item,['profileUrl','state']);
      if(typeof item.state!=='string'||!['followed','following'].includes(item.state))throw error(400,'invalid_follow_exclusion');
      profiles.add(await profileUrl(item.profileUrl));
    }
    return this.transaction(records=>{
      const additions=[...profiles].filter(url=>!own(records,url)).length;
      if(Object.keys(records).length+additions>MAX_RECORDS)throw error(409,'follow_exclusion_limit');
      for(const url of profiles){
        // A repeated confirmation never changes the original confirmation date.
        if(own(records,url))continue;
        records[url]={profileUrl:url,state:'following',confirmedAt:this.now()};
      }
      return {saved:profiles.size};
    });
  }
  async list(){
    await this.ready();
    const items=Object.values(collection(this.store.state)).map(({profileUrl,state,confirmedAt})=>({profileUrl,state,confirmedAt})).sort((a,b)=>b.confirmedAt.localeCompare(a.confirmedAt)||a.profileUrl.localeCompare(b.profileUrl));
    return {account:ACCOUNT,items};
  }
  async remove(body){
    input(body,['account','profileUrl']);
    if(body.account!==ACCOUNT)throw error(400,'invalid_follow_exclusion');
    const url=await profileUrl(body.profileUrl);
    return this.transaction(records=>{const removed=own(records,url);delete records[url];return {removed};});
  }
  async filter(platform,result){
    if(platform!=='facebook')return {...result,excludedCount:0};
    await this.ready();
    const records=collection(this.store.state),{searchResultUrl}=await urls;
    const items=result.items.filter(item=>{
      const target=searchResultUrl('facebook',item.url);
      return !target||target.kind!=='profile'||!own(records,target.url);
    });
    // Preserve the provider page and hasMore without buying a refill query.
    return {...result,items,excludedCount:result.items.length-items.length};
  }
}
module.exports={FacebookFollowExclusions,ACCOUNT,KEY,MAX_RECORDS};
