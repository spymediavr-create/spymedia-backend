const fs=require('node:fs/promises');
const crypto=require('node:crypto');
const {error}=require('./errors.cjs');
const LIMIT=8*1024**2,HEAD_LIMIT=256*1024;
const TYPES=new Set(['image/jpeg','image/png','image/webp']);
function dimensions(b,type) {
  let width,height;
  if(type==='image/png'&&b.length>=33&&b.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))&&b.toString('ascii',12,16)==='IHDR'){
    width=b.readUInt32BE(16);height=b.readUInt32BE(20);
  }else if(type==='image/jpeg'&&b.length>=4&&b[0]===255&&b[1]===216){
    for(let i=2;i+4<=b.length;){
      if(b[i++]!==255)break;while(b[i]===255)i++;const marker=b[i++];if(marker===217||marker===218)break;
      if(marker===1||marker>=208&&marker<=215)continue;
      if(i+2>b.length)break;const size=b.readUInt16BE(i);if(size<2||i+size>b.length)break;
      if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&size>=8){height=b.readUInt16BE(i+3);width=b.readUInt16BE(i+5);break;}i+=size;
    }
  }else if(type==='image/webp'&&b.length>=30&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP'){
    const chunk=b.toString('ascii',12,16);
    if(chunk==='VP8X'){width=1+b.readUIntLE(24,3);height=1+b.readUIntLE(27,3);}
    else if(chunk==='VP8 '&&b[23]===157&&b[24]===1&&b[25]===42){width=b.readUInt16LE(26)&16383;height=b.readUInt16LE(28)&16383;}
    else if(chunk==='VP8L'&&b[20]===47){const bits=b.readUInt32LE(21);width=(bits&16383)+1;height=((bits>>>14)&16383)+1;}
  }
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>4096||height>4096||width*height>16_000_000)throw error(422,'invalid_photo_dimensions');
  return {width,height,duration:0};
}
class Photos {
  constructor(store){this.store=store;this.busy=false;}
  async upload(req) {
    const type=(req.headers['content-type']||'').split(';')[0],size=Number(req.headers['content-length']);
    if(!TYPES.has(type))throw error(415,'photo_only');
    if(!Number.isSafeInteger(size)||size<=0||size>LIMIT)throw error(413,'photo_too_large');
    let name;try{name=decodeURIComponent(req.headers['x-upload-name']||'');}catch{throw error(400,'invalid_filename');}
    if(!name||name.length>200||/[\x00-\x1f\x7f]/.test(name))throw error(400,'invalid_filename');
    if(this.store.uploadBusy)throw error(429,'upload_busy');this.store.uploadBusy=true;let target;
    try {
      await this.store.init();if(await this.store.usedBytes()+size>this.store.settings.maxStorageBytes)throw error(507,'storage_full');
      const id=crypto.randomUUID();target=this.store.file(id);const handle=await fs.open(target,'wx',0o600);let bytes=0,head=Buffer.alloc(0);const hash=crypto.createHash('sha256');
      try{for await(const chunk of req){bytes+=chunk.length;if(bytes>size||bytes>LIMIT)throw error(413,'photo_too_large');if(head.length<HEAD_LIMIT)head=Buffer.concat([head,chunk.subarray(0,HEAD_LIMIT-head.length)]);hash.update(chunk);await handle.writeFile(chunk);}await handle.sync();}finally{await handle.close();}
      if(bytes!==size)throw error(422,'invalid_media');
      const info=dimensions(head,type),sha256=hash.digest('hex');
      const duplicate=Object.values(this.store.state.media).find(m=>m.sha256===sha256&&m.type===type);
      if(duplicate){await fs.unlink(target);target=null;return duplicate;}
      const item={id,name,kind:'image',type,size,sha256,...info,profile:'link-photo',createdAt:new Date().toISOString()};
      await this.store.transaction(s=>{s.media[id]=item;});target=null;return item;
    }finally{this.store.uploadBusy=false;if(target)await fs.unlink(target).catch(()=>{});}
  }
}
module.exports={Photos,dimensions,LIMIT};
