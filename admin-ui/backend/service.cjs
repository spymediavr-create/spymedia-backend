const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const {config} = require('./config.cjs');
const {Store} = require('./store.cjs');
const {Media} = require('./media.cjs');
const {Jobs} = require('./jobs.cjs');
const {Connectors} = require('./connectors.cjs');
const {Catalog} = require('./catalog.cjs');
const {Photos}=require('./photos.cjs');
const {YouTubeSource}=require('./youtube-source.cjs');
const {error} = require('./errors.cjs');
class Service {
  constructor(options={}) {
    this.settings=options.settings||config();this.store=options.store||new Store(this.settings);this.media=options.media||new Media(this.settings,this.store);
    this.connectors=options.connectors||new Connectors(this.settings,{mediaUrl:asset=>this.signedUrl(asset)});
    this.jobs=new Jobs(this.settings,this.store,this.media,this.connectors);
    this.catalog=new Catalog(this.store,this.jobs);
    this.photos=options.photos||new Photos(this.store);
    this.youtubeSource=options.youtubeSource||new YouTubeSource(this.settings,this.photos);
    this.diagnosticNow=options.diagnosticNow||Date.now;this.facebookCheckBusy=false;this.facebookCheckNextAt=0;this.xCheckBusy=false;this.xCheckNextAt=0;
    this.instagramCheckBusy=false;this.instagramCheckNextAt=0;
  }
  async checkInstagramConnection(){
    const now=this.diagnosticNow();
    if(this.instagramCheckBusy||now<this.instagramCheckNextAt)throw Object.assign(error(429,'instagram_check_rate_limited'),{retryAfter:Math.max(1,Math.min(60,Math.ceil((this.instagramCheckNextAt-now)/1000)))});
    this.instagramCheckNextAt=now+60000;this.instagramCheckBusy=true;
    try{
      const result=await this.connectors.checkInstagramConnection();
      if(result?.identityVerified!==true||result.username!=='spymedia_kr'||typeof result.userId!=='string'||!/^\d{1,30}$/.test(result.userId))throw error(409,'account_mismatch');
      return {userId:result.userId,username:'spymedia_kr',identityVerified:true,publishingPermissionsVerified:false,mediaDeliveryConfigured:result.mediaDeliveryConfigured===true,publishingEnabled:result.publishingEnabled===true};
    }finally{this.instagramCheckBusy=false;}
  }
  async checkFacebookConnection(){
    const now=this.diagnosticNow();
    if(this.facebookCheckBusy||now<this.facebookCheckNextAt)throw Object.assign(error(429,'facebook_check_rate_limited'),{retryAfter:Math.max(1,Math.ceil((this.facebookCheckNextAt-now)/1000))});
    // One shared server credential: throttle across all administrator sessions, including failed checks.
    this.facebookCheckNextAt=now+60000;this.facebookCheckBusy=true;
    try{
      const result=await this.connectors.checkFacebookConnection();
      if(result?.identityVerified!==true||result.pageId!=='1387247911137772')throw error(409,'account_mismatch');
      return {pageId:'1387247911137772',pageName:'스파이미디어',identityVerified:true,publishingPermissionsVerified:false,publishingEnabled:result.publishingEnabled===true};
    }finally{this.facebookCheckBusy=false;}
  }
  async checkXConnection(){
    const now=this.diagnosticNow();
    if(this.xCheckBusy||now<this.xCheckNextAt)throw Object.assign(error(429,'x_check_rate_limited'),{retryAfter:Math.max(1,Math.ceil((this.xCheckNextAt-now)/1000))});
    this.xCheckNextAt=now+60000;this.xCheckBusy=true;
    try{
      const result=await this.connectors.checkXConnection();
      if(result?.identityVerified!==true||result.username!=='spymedia_kor'||typeof result.userId!=='string'||!/^\d{1,30}$/.test(result.userId))throw error(409,'account_mismatch');
      return {userId:result.userId,username:'spymedia_kor',identityVerified:true,publishingPermissionsVerified:false,authMode:['oauth1','oauth2'].includes(result.authMode)?result.authMode:null,refreshConfigured:result.refreshConfigured===true,publishingEnabled:result.publishingEnabled===true};
    }finally{this.xCheckBusy=false;}
  }
  async status() {
    let storage=false;try{if(this.settings.storageConfigured){await this.store.init();storage=true;}}catch{}
    return {uploadsConnected:storage,storageReady:storage,conversionReady:false,youtubeImportReady:!!this.settings.env.YOUTUBE_API_KEY,legacyPreparationDisabled:!this.settings.legacyPreparationEnabled,postingConnected:false,publishingEnabled:this.settings.publishingEnabled,instagramConnection:this.connectors.describeInstagramConnection?.()||{credentialsConfigured:false,mediaDeliveryConfigured:false,publishingEnabled:false,publishingPermissionsVerified:false},xConnection:this.connectors.xAuth?.describe()||{authMode:null,credentialsConfigured:false,refreshConfigured:false,costAcknowledged:false,publishingPermissionsVerified:false},channels:Object.fromEntries(Object.entries(this.connectors.availability()).map(([channel,configured])=>[channel,{configured,verified:false}]))};
  }
  signedUrl(asset) {
    if(!this.settings.mediaKey||!this.settings.origin)throw error(503,'media_delivery_unavailable');
    const expires=String(Math.floor(Date.now()/1000)+3600),payload=asset.id+':'+expires;
    const sig=crypto.createHmac('sha256',Buffer.from(this.settings.mediaKey,'hex')).update(payload).digest('hex');
    return this.settings.origin+'/sns-media/'+asset.id+'?expires='+expires+'&signature='+sig;
  }
  validSignature(url) {
    if(!this.settings.mediaKey)return false;
    const id=url.pathname.split('/').pop(),expires=url.searchParams.get('expires')||'',sig=url.searchParams.get('signature')||'';
    if(!/^\d{10}$/.test(expires)||!/^[a-f0-9-]{36}$/.test(id)||!/^[a-f0-9]{64}$/.test(sig)||Number(expires)<=Date.now()/1000||Number(expires)>Date.now()/1000+3605)return false;
    const expected=crypto.createHmac('sha256',Buffer.from(this.settings.mediaKey,'hex')).update(id+':'+expires).digest();
    return crypto.timingSafeEqual(expected,Buffer.from(sig,'hex'));
  }
  async sendMedia(req,res,url,publicRoute=false) {
    if(publicRoute&&!this.validSignature(url))throw error(403,'media_link_expired');
    const id=url.pathname.split('/').pop(),converted=publicRoute||url.searchParams.get('converted')==='1';await this.store.init();
    let item=converted?Object.values(this.store.state.jobs).flatMap(j=>j.assets).find(a=>a.id===id):this.store.state.media[id];
    if(!item)throw error(404,'not_found');const file=this.store.file(id,converted&&!item.original);const stat=await fsp.stat(file);
    let start=0,end=stat.size-1,status=200;const range=req.headers.range;
    if(range){const match=/^bytes=(\d+)-(\d*)$/.exec(range);if(!match)throw error(416,'invalid_range');start=Number(match[1]);end=match[2]?Number(match[2]):end;if(start>end||end>=stat.size)throw error(416,'invalid_range');status=206;}
    const extension={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','video/mp4':'mp4','video/webm':'webm','video/quicktime':'mov'}[item.type];
    res.writeHead(status,{'Content-Type':item.type,'Content-Length':end-start+1,'Accept-Ranges':'bytes','Content-Disposition':converted||url.searchParams.get('preview')==='1'?'inline':`attachment; filename="original.${extension}"; filename*=UTF-8''${encodeURIComponent(item.name)}`,...(status===206?{'Content-Range':`bytes ${start}-${end}/${stat.size}`}:{})});
    if(req.method==='HEAD'){res.end();return;}
    const stream=fs.createReadStream(file,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
  }
}
module.exports={Service};
