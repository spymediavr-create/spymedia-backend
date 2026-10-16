const axios=require('axios');
const {error}=require('./errors.cjs');
const modules=Promise.all([import('../public/search-result-url.js'),import('../public/candidate-regions.js')]);
const ENDPOINT='https://api.search.brave.com/res/v1/web/search';
const DOMAINS={instagram:'site:instagram.com',facebook:'site:facebook.com',x:'(site:x.com OR site:twitter.com)',blog:'site:blog.naver.com'};
const PAGE_SIZE=10,RESULTS_PER_REQUEST=20,MAX_PAGES=10,TIMEOUT=8000,MAX_BYTES=1024*1024;
function input(body){
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['platform','keyword','region','page'].includes(key))||!Object.hasOwn(DOMAINS,body.platform)||typeof body.keyword!=='string'||body.keyword.length>200||!body.keyword.trim()||typeof body.region!=='string'||body.region.length>100||/[\x00-\x1f\x7f]/.test(body.keyword+body.region)||!Number.isSafeInteger(body.page)||body.page<0||body.page>=MAX_PAGES)throw error(400,'invalid_temporary_search');
  return {platform:body.platform,keyword:body.keyword.trim(),region:body.region.trim(),page:body.page};
}
const plain=(value,max)=>typeof value==='string'?value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'').slice(0,max):'';
class TemporarySearch {
  constructor(settings,options={}){
    this.settings=settings;this.get=options.get||axios.get;this.now=options.now||Date.now;
    // Only rate counters are retained. No query/result/cache/store references survive a call.
    this.busy=false;this.nextAt=0;this.windowAt=0;this.count=0;
  }
  describe(){
    const key=this.settings.env.BRAVE_SEARCH_API_KEY;
    const configured=typeof key==='string'&&key.length>=8&&key.length<=512&&!/[\s\x00-\x1f\x7f]/.test(key),enabled=this.settings.env.BRAVE_SEARCH_ENABLED==='true';
    return {provider:'brave',configured,enabled,ready:configured&&enabled,pageSize:PAGE_SIZE,resultsPerRequest:RESULTS_PER_REQUEST,maxProviderPages:MAX_PAGES};
  }
  async search(body){
    const {platform,keyword,region,page}=input(body),[{searchResultUrl},{externalRegionTerms}]=await modules;
    if(!this.describe().ready)throw error(503,'temporary_search_unconfigured');
    const query=[keyword,externalRegionTerms(region),DOMAINS[platform]].filter(Boolean).join(' ');
    if(query.length>400||query.split(/\s+/).length>50)throw error(400,'invalid_temporary_search');
    const now=this.now();
    if(now-this.windowAt>=60000){this.windowAt=now;this.count=0;}
    const retry=this.count>=20?Math.max(1,Math.ceil((this.windowAt+60000-now)/1000)):Math.max(1,Math.ceil((this.nextAt-now)/1000));
    if(this.busy||now<this.nextAt||this.count>=20)throw Object.assign(error(429,'temporary_search_rate_limited'),{retryAfter:Math.min(60,retry)});
    this.busy=true;this.nextAt=now+2000;this.count++;
    try{
      let response;
      try{response=await this.get(ENDPOINT,{headers:{Accept:'application/json','X-Subscription-Token':this.settings.env.BRAVE_SEARCH_API_KEY,'Cache-Control':'no-cache'},params:{q:query,count:RESULTS_PER_REQUEST,offset:page,result_filter:'web',country:'KR',search_lang:'ko',ui_lang:'ko-KR',safesearch:'moderate',text_decorations:false,spellcheck:false},timeout:TIMEOUT,maxRedirects:0,maxContentLength:MAX_BYTES,maxBodyLength:MAX_BYTES,responseType:'json',validateStatus:()=>true});}
      catch(e){throw error(e?.code==='ECONNABORTED'||e?.code==='ETIMEDOUT'?504:502,e?.code==='ECONNABORTED'||e?.code==='ETIMEDOUT'?'temporary_search_timeout':'temporary_search_failed');}
      if([401,403].includes(response?.status))throw error(503,'temporary_search_access');
      if(response?.status===429){this.nextAt=Math.max(this.nextAt,now+60000);throw Object.assign(error(429,'temporary_search_provider_limit'),{retryAfter:60});}
      if(response?.status===402)throw error(503,'temporary_search_quota');
      if(response?.status!==200)throw error(502,'temporary_search_failed');
      const data=response.data;
      if(!data||typeof data!=='object'||Array.isArray(data)||data.error||data.type!==undefined&&data.type!=='search'||data.query!=null&&(typeof data.query!=='object'||Array.isArray(data.query))||data.web!=null&&!Array.isArray(data.web?.results)||!data.query&&!data.web&&data.type!=='search')throw error(502,'temporary_search_invalid_response');
      const more=data.query?.more_results_available;
      if(more!=null&&typeof more!=='boolean')throw error(502,'temporary_search_invalid_response');
      const raw=data.web?.results||[];
      if(raw.length>RESULTS_PER_REQUEST)throw error(502,'temporary_search_invalid_response');
      const seen=new Set(),items=[];
      for(const entry of raw){
        const target=searchResultUrl(platform,entry?.url);
        if(!target||seen.has(target.url))continue;
        seen.add(target.url);items.push({...target,title:plain(entry.title,200)||target.url,snippet:plain(entry.description,600)});
      }
      return {items,page,pageSize:PAGE_SIZE,resultsPerRequest:RESULTS_PER_REQUEST,maxProviderPages:MAX_PAGES,hasMore:page<MAX_PAGES-1&&more===true,paginationKnown:typeof more==='boolean',limitReached:page===MAX_PAGES-1,omitted:raw.length-items.length,regionVerified:false};
    }finally{this.busy=false;}
  }
}
module.exports={TemporarySearch,ENDPOINT,PAGE_SIZE,RESULTS_PER_REQUEST,MAX_PAGES,TIMEOUT,MAX_BYTES};
