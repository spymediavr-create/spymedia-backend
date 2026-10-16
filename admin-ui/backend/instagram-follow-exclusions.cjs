const {error}=require('./errors.cjs');
const urls=import('../public/search-result-url.js');
const ACCOUNT='spymedia_kr',KEY='instagramFollowExclusions',MAX_RECORDS=10000;
const STATES={followed:'following',following:'following',request_sent:'requested',requested:'requested'};
const own=(object,key)=>Object.hasOwn(object,key);
function object(value,keys){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))throw error(400,'invalid_follow_exclusion');
}
async function username(value){
  if(typeof value!=='string'||value.length>2048||/[\x00-\x1f\x7f]/.test(value))throw error(400,'invalid_follow_exclusion');
  const input=value.trim(),isUrl=/^https:\/\//i.test(input),bare=input.replace(/^@/,'');
  if(!isUrl&&!/^[a-z0-9_.]{1,30}$/i.test(bare))throw error(400,'invalid_follow_exclusion');
  const {searchResultUrl}=await urls;
  const target=searchResultUrl('instagram',isUrl?input:'https://www.instagram.com/'+bare+'/');
  if(!target||target.kind!=='profile')throw error(400,'invalid_follow_exclusion');
  const name=new URL(target.url).pathname.split('/')[1];
  if(name===ACCOUNT)throw error(400,'invalid_follow_exclusion');
  return name;
}
function collection(state){
  if(!own(state,KEY))return {};
  const root=state[KEY],records=root?.[ACCOUNT];
  if(!root||typeof root!=='object'||Array.isArray(root)||!records||typeof records!=='object'||Array.isArray(records)||Object.keys(records).length>MAX_RECORDS)throw error(503,'storage_unavailable');
  for(const [key,item]of Object.entries(records)){
    if(!item||typeof item!=='object'||Array.isArray(item)||item.username!==key||!/^[a-z0-9_.]{1,30}$/.test(key)||!['following','requested'].includes(item.state)||typeof item.confirmedAt!=='string'||!Number.isFinite(Date.parse(item.confirmedAt)))throw error(503,'storage_unavailable');
  }
  return records;
}
class InstagramFollowExclusions{
  constructor(store,options={}){this.store=store;this.now=options.now||(()=>new Date().toISOString());}
  async ready(){await this.store.init();await this.store.tail;collection(this.store.state);}
  transaction(fn){
    let present=false,previous,started=false;
    return this.store.transaction(state=>{
      const records=collection(state);present=own(state,KEY);previous=state[KEY];started=true;
      const next=Object.assign(Object.create(null),records);state[KEY]={[ACCOUNT]:next};
      return fn(next);
    },state=>{if(started){if(present)state[KEY]=previous;else delete state[KEY];}});
  }
  async save(body){
    object(body,['account','items']);
    if(body.account!==ACCOUNT||!Array.isArray(body.items)||body.items.length<1||body.items.length>10)throw error(400,'invalid_follow_exclusion');
    const items=new Map();
    for(const item of body.items){
      object(item,['username','state']);
      if(!own(STATES,item.state))throw error(400,'invalid_follow_exclusion');
      const name=await username(item.username),state=STATES[item.state];
      if(items.get(name)!=='following')items.set(name,state);
    }
    return this.transaction(records=>{
      const additions=[...items.keys()].filter(name=>!own(records,name)).length;
      if(Object.keys(records).length+additions>MAX_RECORDS)throw error(409,'follow_exclusion_limit');
      for(const [name,state]of items){
        const previous=own(records,name)?records[name]:null;
        // Retrying the save cannot downgrade a confirmed follow or move its date.
        if(previous&&(previous.state===state||previous.state==='following'))continue;
        records[name]={username:name,state,confirmedAt:this.now()};
      }
      return {saved:items.size};
    });
  }
  async list(){
    await this.ready();
    const items=Object.values(collection(this.store.state)).map(({username,state,confirmedAt})=>({username,state,confirmedAt})).sort((a,b)=>b.confirmedAt.localeCompare(a.confirmedAt)||a.username.localeCompare(b.username));
    return {account:ACCOUNT,items};
  }
  async remove(body){
    object(body,['account','username']);
    if(body.account!==ACCOUNT)throw error(400,'invalid_follow_exclusion');
    const name=await username(body.username);
    return this.transaction(records=>{const removed=own(records,name);delete records[name];return {removed};});
  }
  async filter(platform,result){
    if(platform!=='instagram')return {...result,excludedCount:0};
    await this.ready();
    const records=collection(this.store.state),{searchResultUrl}=await urls;
    const items=result.items.filter(item=>{
      const target=searchResultUrl('instagram',item.url);
      if(!target||target.kind!=='profile')return true;
      const name=new URL(target.url).pathname.split('/')[1];
      return !own(records,name);
    });
    // Keep the provider page and hasMore; do not buy another query to fill gaps.
    return {...result,items,excludedCount:result.items.length-items.length};
  }
}
module.exports={InstagramFollowExclusions,ACCOUNT,KEY,MAX_RECORDS};
