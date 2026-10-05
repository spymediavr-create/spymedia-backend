const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const {error} = require('./errors.cjs');
const TYPES = new Map([['image/jpeg','image'],['image/png','image'],['image/webp','image'],['video/mp4','video'],['video/quicktime','video'],['video/webm','video']]);
function magic(buffer, type) {
  if (type==='image/jpeg') return buffer[0]===255 && buffer[1]===216 && buffer[2]===255;
  if (type==='image/png') return buffer.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'));
  if (type==='image/webp') return buffer.toString('ascii',0,4)==='RIFF' && buffer.toString('ascii',8,12)==='WEBP';
  if (type==='video/webm') return buffer.subarray(0,4).equals(Buffer.from('1a45dfa3','hex'));
  return buffer.toString('ascii',4,8)==='ftyp';
}
function run(command,args,timeout=30000) {
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{stdio:['ignore','pipe','ignore'],windowsHide:true,shell:false});
    let output='',settled=false;
    const finish=(err)=>{if(settled)return;settled=true;clearTimeout(timer);err?reject(err):resolve(output);};
    const timer=setTimeout(()=>{child.kill('SIGKILL');finish(error(422,'media_processing_timeout'));},timeout);
    child.stdout.on('data',chunk=>{output+=chunk; if(output.length>1024*1024){child.kill('SIGKILL');finish(error(422,'invalid_media'));}});
    child.on('error',()=>finish(error(503,'media_tools_unavailable')));
    child.on('close',code=>finish(code ? error(422,'invalid_media') : null));
  });
}
class Media {
  constructor(settings,store) { this.settings=settings;this.store=store;this.busy=false;this.available=null; }
  async tools() {
    if(this.available===null) this.available=Promise.all([run(this.settings.ffprobe,['-version']),run(this.settings.ffmpeg,['-version'])]).then(()=>true).catch(()=>false);
    return this.available;
  }
  async inspect(file,kind) {
    let data; try {data=JSON.parse(await run(this.settings.ffprobe,['-v','error','-protocol_whitelist','file,pipe','-show_streams','-show_format','-of','json',file]));}catch(e){throw e.code ? e : error(422,'invalid_media');}
    const video=data.streams?.find(s=>s.codec_type==='video');
    const duration=Number(data.format?.duration||video?.duration||0);
    if(!video || !video.width || !video.height || video.width*video.height>40_000_000 || kind==='video' && (!Number.isFinite(duration)||duration<=0||duration>14400)) throw error(422,'invalid_media');
    return {width:video.width,height:video.height,duration:kind==='video'?duration:0};
  }
  async upload(req) {
    this.settings.requireStorage(); if(!await this.tools())throw error(503,'media_tools_unavailable');
    if(this.busy)throw error(429,'upload_busy');this.busy=true;
    let target;
    try {
      const type=(req.headers['content-type']||'').split(';')[0];const kind=TYPES.get(type);if(!kind)throw error(415,'unsupported_media');
      const limit=kind==='video'?500*1024**2:20*1024**2;
      const size=Number(req.headers['content-length']);if(!Number.isSafeInteger(size)||size<=0||size>limit)throw error(413,'file_too_large');
      await this.store.init();if(await this.store.usedBytes()+size>this.settings.maxStorageBytes)throw error(507,'storage_full');
      let name;try{name=decodeURIComponent(req.headers['x-upload-name']||'');}catch{throw error(400,'invalid_filename');}
      if(!name||name.length>200||/[\x00-\x1f\x7f]/.test(name))throw error(400,'invalid_filename');
      const id=crypto.randomUUID();target=this.store.file(id);const file=await fs.open(target,'wx',0o600);let bytes=0,head=Buffer.alloc(0);const hash=crypto.createHash('sha256');
      try{for await(const chunk of req){bytes+=chunk.length;if(bytes>limit||bytes>size)throw error(413,'file_too_large');if(head.length<32)head=Buffer.concat([head,chunk]).subarray(0,32);hash.update(chunk);await file.writeFile(chunk);}await file.sync();}finally{await file.close();}
      if(bytes!==size||!magic(head,type))throw error(422,'invalid_media');
      const info=await this.inspect(target,kind);const sha256=hash.digest('hex');
      const duplicate=Object.values(this.store.state.media).find(m=>m.sha256===sha256&&m.type===type);
      if(duplicate){await fs.unlink(target);target=null;return duplicate;}
      const item={id,name,kind,type,size,sha256,...info,createdAt:new Date().toISOString()};
      await this.store.transaction(state=>{state.media[id]=item;});target=null;return item;
    }finally{this.busy=false;if(target)await fs.unlink(target).catch(()=>{});}
  }
  async convert(item,channel) {
    if(!await this.tools())throw error(503,'media_tools_unavailable');
    const id=crypto.randomUUID(),target=this.store.file(id,true);const input=this.store.file(item.id);
    const image=item.kind==='image';
    const filter=channel==='instagram' ? (image?'scale=1080:1350:force_original_aspect_ratio=decrease,pad=1080:1350:(ow-iw)/2:(oh-ih)/2:color=black':'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1') : "scale=w='max(2,trunc(iw*min(1,min(1920/iw,1080/ih))/2)*2)':h='max(2,trunc(ih*min(1,min(1920/iw,1080/ih))/2)*2)',setsar=1";
    const args=['-nostdin','-v','error','-protocol_whitelist','file,pipe','-i',input,'-map','0:v:0','-map_metadata','-1','-vf',filter,'-threads','2'];
    if(image)args.push('-frames:v','1','-c:v','mjpeg','-q:v','2','-f','image2');
    else args.push('-map','0:a:0?','-c:v','libx264','-preset','veryfast','-crf','23','-maxrate','25M','-bufsize','50M','-pix_fmt','yuv420p','-r','30','-c:a','aac','-b:a','128k','-ar','48000','-movflags','+faststart','-fs',String(500*1024**2),'-f','mp4');
    args.push(target);
    try {
      if(await this.store.usedBytes()+item.size*2>this.settings.maxStorageBytes)throw error(507,'storage_full');
      await run(this.settings.ffmpeg,args,image?60000:30*60*1000);await fs.chmod(target,0o600);
      const size=(await fs.stat(target)).size;if(size>(image?8*1024**2:500*1024**2))throw error(422,'converted_media_too_large');
      const info=await this.inspect(target,item.kind);return {id,kind:item.kind,type:image?'image/jpeg':'video/mp4',size,...info};
    }catch(e){await fs.unlink(target).catch(()=>{});throw e;}
  }
}
module.exports={Media,magic,run};
