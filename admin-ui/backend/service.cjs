const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const {config} = require('./config.cjs');
const {Store} = require('./store.cjs');
const {Media} = require('./media.cjs');
const {Jobs} = require('./jobs.cjs');
const {Connectors} = require('./connectors.cjs');
const {error} = require('./errors.cjs');
class Service {
  constructor(options={}) {
    this.settings=options.settings||config();this.store=options.store||new Store(this.settings);this.media=options.media||new Media(this.settings,this.store);
    this.connectors=options.connectors||new Connectors(this.settings,{mediaUrl:asset=>this.signedUrl(asset)});
    this.jobs=new Jobs(this.settings,this.store,this.media,this.connectors);
  }
  async status() {
    let storage=false;try{if(this.settings.storageConfigured){await this.store.init();storage=true;}}catch{}
    const tools=storage&&await this.media.tools();
    return {uploadsConnected:!!tools,storageReady:storage,conversionReady:!!tools,postingConnected:false,publishingEnabled:this.settings.publishingEnabled,channels:Object.fromEntries(Object.entries(this.connectors.availability()).map(([channel,configured])=>[channel,{configured,verified:false}]))};
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
    if(!item)throw error(404,'not_found');const file=this.store.file(id,converted);const stat=await fsp.stat(file);
    let start=0,end=stat.size-1,status=200;const range=req.headers.range;
    if(range){const match=/^bytes=(\d+)-(\d*)$/.exec(range);if(!match)throw error(416,'invalid_range');start=Number(match[1]);end=match[2]?Number(match[2]):end;if(start>end||end>=stat.size)throw error(416,'invalid_range');status=206;}
    const extension={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','video/mp4':'mp4','video/webm':'webm','video/quicktime':'mov'}[item.type];
    res.writeHead(status,{'Content-Type':item.type,'Content-Length':end-start+1,'Accept-Ranges':'bytes','Content-Disposition':converted?'inline':`attachment; filename="original.${extension}"; filename*=UTF-8''${encodeURIComponent(item.name)}`,...(status===206?{'Content-Range':`bytes ${start}-${end}/${stat.size}`}:{})});
    if(req.method==='HEAD'){res.end();return;}
    const stream=fs.createReadStream(file,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
  }
}
module.exports={Service};
