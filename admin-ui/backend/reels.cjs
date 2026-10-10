const fs=require('node:fs/promises');
const crypto=require('node:crypto');
const {run}=require('./media.cjs');
const {error}=require('./errors.cjs');
// Conservative application limit, not a claim about Meta's maximum file size.
const LIMIT=300_000_000;
const TYPES=new Set(['video/mp4','video/quicktime']);
function validateReelMetadata(m){
  const fail=code=>{throw error(422,code);};
  if(!m||m.kind!=='video'||!TYPES.has(m.type))fail('reel_type_required');
  if(!Number.isSafeInteger(m.size)||m.size<=0||m.size>LIMIT)fail('reel_too_large');
  if(!Number.isInteger(m.width)||!Number.isInteger(m.height)||m.width<1||m.width>1920||m.height<1||m.height>8192)fail('reel_dimensions');
  if(!Number.isFinite(m.duration)||m.duration<3||m.duration>900)fail('reel_duration');
  if(!['h264','hevc'].includes(m.videoCodec))fail('reel_video_codec');
  if(!Number.isFinite(m.frameRate)||m.frameRate<23||m.frameRate>60)fail('reel_frame_rate');
  if(!Number.isFinite(m.videoBitrate)||m.videoBitrate<=0||m.videoBitrate>25_000_000)fail('reel_video_bitrate');
  if(!['yuv420p','yuvj420p'].includes(m.pixelFormat))fail('reel_pixel_format');
  if(!['progressive','unknown'].includes(m.fieldOrder))fail('reel_interlaced');
  if(m.rotation!==0)fail('reel_rotation');
  if(m.fastStart!==true)fail('reel_fast_start');
  if(m.hasEditList!==false)fail('reel_edit_list');
  if(m.audioCodec!==null){
    if(m.audioCodec!=='aac')fail('reel_audio_codec');
    if(!Number.isInteger(m.audioSampleRate)||m.audioSampleRate<1||m.audioSampleRate>48000)fail('reel_audio_sample_rate');
    if(![1,2].includes(m.audioChannels))fail('reel_audio_channels');
    if(!Number.isFinite(m.audioBitrate)||m.audioBitrate<=0||m.audioBitrate>128_000)fail('reel_audio_bitrate');
  }
  return m;
}
function rate(value){
  if(typeof value!=='string'||!/^\d+(?:\/\d+)?$/.test(value))return NaN;
  const [n,d='1']=value.split('/').map(Number);return n/Number(d);
}
// Read only bounded box headers, never the mdat payload into memory.
async function containerInfo(file){
  const handle=await fs.open(file,'r');
  try{
    const size=(await handle.stat()).size;let count=0,moov=-1,mdat=-1,ftyp=false,hasEditList=false;
    async function boxes(start,end,depth){
      if(depth>8)throw error(422,'invalid_reel');
      for(let offset=start;offset<end;){
        if(++count>10000||end-offset<8)throw error(422,'invalid_reel');
        const head=Buffer.alloc(16),{bytesRead}=await handle.read(head,0,Math.min(16,end-offset),offset);
        if(bytesRead<8)throw error(422,'invalid_reel');
        let length=head.readUInt32BE(0),header=8;const type=head.toString('ascii',4,8);
        if(length===1){if(bytesRead<16)throw error(422,'invalid_reel');const big=head.readBigUInt64BE(8);if(big>BigInt(Number.MAX_SAFE_INTEGER))throw error(422,'invalid_reel');length=Number(big);header=16;}
        else if(length===0)length=end-offset;
        if(length<header||offset+length>end)throw error(422,'invalid_reel');
        if(depth===0){if(type==='ftyp')ftyp=true;if(type==='moov'){if(moov!==-1)throw error(422,'invalid_reel');moov=offset;}if(type==='mdat'&&mdat===-1)mdat=offset;}
        if(type==='elst')hasEditList=true;
        if(['moov','trak','edts'].includes(type))await boxes(offset+header,offset+length,depth+1);
        offset+=length;
      }
    }
    await boxes(0,size,0);
    if(!ftyp||moov===-1||mdat===-1)throw error(422,'invalid_reel');
    return {fastStart:moov<mdat,hasEditList};
  }finally{await handle.close();}
}
async function inspectReel(settings,file,execute=run){
  const layout=await containerInfo(file);let data;
  try{
    const text=await execute(settings.ffprobe,['-v','error','-max_alloc','67108864','-protocol_whitelist','file','-format_whitelist','mov','-f','mov','-enable_drefs','0','-probesize','8388608','-analyzeduration','5000000','-show_streams','-show_format','-of','json',file],30000);
    data=JSON.parse(text);
  }catch(e){throw error(e.code==='media_tools_unavailable'?503:422,e.code==='media_tools_unavailable'?'reel_probe_unavailable':'invalid_reel');}
  const streams=Array.isArray(data.streams)?data.streams:[],videos=streams.filter(s=>s.codec_type==='video'),audios=streams.filter(s=>s.codec_type==='audio');
  if(videos.length!==1||audios.length>1||streams.some(s=>!['video','audio','data'].includes(s.codec_type)))throw error(422,'invalid_reel');
  const v=videos[0],a=audios[0],side=(v.side_data_list||[]).find(s=>s.rotation!==undefined);
  return {width:Number(v.width),height:Number(v.height),duration:Number(data.format?.duration||v.duration),videoCodec:v.codec_name,
    frameRate:rate(v.avg_frame_rate),videoBitrate:Number(v.bit_rate||data.format?.bit_rate),pixelFormat:v.pix_fmt,fieldOrder:v.field_order,
    rotation:Number(side?.rotation??v.tags?.rotate??0),audioCodec:a?(a.codec_name||'unknown'):null,audioBitrate:a?Number(a.bit_rate):0,
    audioSampleRate:a?Number(a.sample_rate):0,audioChannels:a?Number(a.channels):0,...layout};
}
class Reels{
  constructor(settings,store,options={}){this.settings=settings;this.store=store;this.execute=options.execute||run;}
  async upload(req){
    this.settings.requireStorage();
    const type=(req.headers['content-type']||'').split(';')[0],size=Number(req.headers['content-length']);
    if(!TYPES.has(type))throw error(415,'reel_type_required');
    if(!Number.isSafeInteger(size)||size<=0||size>LIMIT)throw error(413,'reel_too_large');
    let name;try{name=decodeURIComponent(req.headers['x-upload-name']||'');}catch{throw error(400,'invalid_filename');}
    if(!name||name.length>200||/[\x00-\x1f\x7f]/.test(name))throw error(400,'invalid_filename');
    // Share the upload lock with photos so concurrent requests cannot overbook disk quota.
    if(this.store.uploadBusy)throw error(429,'upload_busy');this.store.uploadBusy=true;let target;
    try{
      await this.store.init();if(await this.store.usedBytes()+size>this.settings.maxStorageBytes)throw error(507,'storage_full');
      const id=crypto.randomUUID();target=this.store.file(id);const handle=await fs.open(target,'wx',0o600),hash=crypto.createHash('sha256');let bytes=0;
      try{for await(const chunk of req){bytes+=chunk.length;if(bytes>size||bytes>LIMIT)throw error(413,'reel_too_large');hash.update(chunk);await handle.writeFile(chunk);}await handle.sync();}finally{await handle.close();}
      if(bytes!==size)throw error(422,'invalid_reel');
      const info=await inspectReel(this.settings,target,this.execute),sha256=hash.digest('hex');
      const item={id,name,kind:'video',type,size,sha256,...info,profile:'instagram-reel-original',createdAt:new Date().toISOString()};
      validateReelMetadata(item);
      item.warnings=Math.abs(item.width/item.height-9/16)>.01?['reel_vertical_recommended']:[];
      const duplicate=Object.values(this.store.state.media).find(m=>m.sha256===sha256&&m.type===type&&m.profile===item.profile);
      if(duplicate){await fs.unlink(target);target=null;return duplicate;}
      await this.store.transaction(s=>{s.media[id]=item;});target=null;return item;
    }finally{this.store.uploadBusy=false;if(target)await fs.unlink(target).catch(()=>{});}
  }
}
module.exports={Reels,validateReelMetadata,inspectReel,containerInfo,LIMIT};
