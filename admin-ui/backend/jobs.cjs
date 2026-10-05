const crypto = require('node:crypto');
const {error} = require('./errors.cjs');
const {caption,xLength} = require('./connectors.cjs');
const CHANNELS = ['youtube','instagram','x','facebook','blog'];
const now = () => new Date().toISOString();
function input(body) {
  if(!body||typeof body.title!=='string'||typeof body.description!=='string'||!body.title.trim()||!body.description.trim()||body.title.length>200||body.description.length>5000||!Array.isArray(body.tags)||body.tags.length>30||body.tags.some(t=>typeof t!=='string'||!t||t.length>60||/[\s#<>\x00-\x1f]/.test(t)))throw error(400,'invalid_draft');
  if(!Array.isArray(body.channels)||!body.channels.length||body.channels.length>5||body.channels.some(c=>!CHANNELS.includes(c))||new Set(body.channels).size!==body.channels.length)throw error(400,'invalid_channel');
  if(!Array.isArray(body.mediaIds)||!body.mediaIds.length||body.mediaIds.length>10||new Set(body.mediaIds).size!==body.mediaIds.length||body.mediaIds.some(id=>typeof id!=='string'))throw error(400,'invalid_media_selection');
  const result={title:body.title.trim(),description:body.description.trim(),tags:[...new Set(body.tags)],youtubePrivacy:body.youtubePrivacy||'private',madeForKids:body.madeForKids};
  if(!['private','unlisted','public'].includes(result.youtubePrivacy)||body.channels.includes('youtube')&&typeof result.madeForKids!=='boolean')throw error(400,'youtube_settings_required');
  return result;
}
class Jobs {
  constructor(settings,store,media,connectors) {this.settings=settings;this.store=store;this.media=media;this.connectors=connectors;this.tail=Promise.resolve();}
  enqueue(fn) {this.tail=this.tail.then(fn).catch(()=>{});}
  async create(body) {
    const content=input(body);const originals=await Promise.all(body.mediaIds.map(id=>this.store.media(id)));
    const kinds=new Set(originals.map(m=>m.kind));if(kinds.size!==1)throw error(400,'choose_video_or_images');
    if(originals[0].kind==='video'&&originals.length!==1)throw error(400,'choose_one_video');
    for(const channel of body.channels) {
      if(channel==='youtube'&&(originals[0].kind!=='video'||content.title.length>100||content.description.length>4500))throw error(400,'youtube_content_limits');
      if(channel==='instagram'&&(caption(content).length>2200||originals[0].kind==='video'&&(originals[0].duration<3||originals[0].duration>900)))throw error(400,'instagram_content_limits');
      if(channel==='x'&&(xLength(caption(content))>280||originals.length>4||originals[0].kind==='video'&&originals[0].duration>1200))throw error(400,'x_content_limits');
    }
    const jobs=await this.store.transaction(state=>body.channels.map(channel=>{
      const key=crypto.createHash('sha256').update(JSON.stringify({version:1,channel,input:content,media:originals.map(m=>m.sha256)})).digest('hex');
      const existing=Object.values(state.jobs).find(j=>j.key===key);if(existing)return {...existing};
      const job={id:crypto.randomUUID(),key,channel,input:content,mediaIds:originals.map(m=>m.id),status:channel==='blog'&&originals[0].kind==='image'?'prepared':'converting',assets:[],createdAt:now(),updatedAt:now(),publicationAttempted:false};
      if(channel==='blog')job.manuscript=caption(content);
      state.jobs[job.id]=job;return {...job};
    }));
    for(const job of jobs)if(job.status==='converting')this.enqueue(()=>this.prepare(job.id));
    return jobs.map(j=>this.view(j));
  }
  async prepare(id) {
    const job=await this.store.job(id);if(job.status!=='converting'||job.preparationStarted)return;
    await this.store.transaction(s=>{s.jobs[id].preparationStarted=true;});
    try{
      const assets=[...job.assets];
      for(const mediaId of job.mediaIds.slice(assets.length)){const original=await this.store.media(mediaId);assets.push(await this.media.convert(job.channel==='blog'&&original.kind==='video'?{...original,kind:'image'}:original,job.channel));await this.store.transaction(s=>{s.jobs[id].assets=[...assets];});}
      await this.store.transaction(s=>{Object.assign(s.jobs[id],{status:'prepared',updatedAt:now()});});
    }catch(e){await this.store.transaction(s=>{Object.assign(s.jobs[id],{status:'failed',error:e.code||'conversion_failed',updatedAt:now()});});}
  }
  async start(ids) {
    if(!this.settings.publishingEnabled)throw error(503,'publishing_disabled');
    if(!Array.isArray(ids)||!ids.length||ids.length>4||new Set(ids).size!==ids.length)throw error(400,'invalid_job_selection');
    await this.store.transaction(state=>{
      for(const id of ids){const job=state.jobs[id];if(!job||job.channel==='blog'||job.status!=='prepared'||job.publicationAttempted)throw error(409,'job_not_ready');if(!this.connectors.availability()[job.channel])throw error(503,'channel_not_configured');}
      for(const id of ids)Object.assign(state.jobs[id],{status:'queued',approvedAt:now(),updatedAt:now()});
    });
    for(const id of ids)this.enqueue(()=>this.execute(id));return this.list();
  }
  async execute(id) {
    const job=await this.store.job(id);if(job.status!=='queued')return;
    await this.store.transaction(state=>{Object.assign(state.jobs[id],{status:'publishing',updatedAt:now()});});
    const checkpoint=async values=>this.store.transaction(state=>{Object.assign(state.jobs[id],values,{updatedAt:now()});});
    try {
      const result=await this.connectors.publish(job,{assetPath:asset=>this.store.file(asset.id,true),checkpoint,beforePublication:values=>checkpoint({...values,publicationAttempted:true})});
      await checkpoint({status:'succeeded',result});
    }catch(e){await checkpoint({status:job.publicationAttempted||e.uncertain?'unknown':'failed',error:e.code||'channel_request_failed'});}
  }
  async retry(id) {
    await this.store.transaction(state=>{
      const job=state.jobs[id];if(!job||job.status!=='failed'||job.publicationAttempted)throw error(409,'check_channel_before_retry');
      Object.assign(job,{status:job.assets.length===job.mediaIds.length?'prepared':'converting',preparationStarted:false,error:null,updatedAt:now()});
    });
    if((await this.store.job(id)).status==='converting')this.enqueue(()=>this.prepare(id));
    return this.list();
  }
  view(job) {
    return {id:job.id,channel:job.channel,status:job.status,error:job.error||null,canRetry:job.status==='failed'&&!job.publicationAttempted,title:job.input.title,caption:caption(job.input),createdAt:job.createdAt,updatedAt:job.updatedAt,result:job.result||null,assets:job.assets.map(a=>({id:a.id,kind:a.kind,type:a.type,size:a.size,width:a.width,height:a.height,duration:a.duration,preview:'/api/admin/media/'+a.id+'?converted=1'})),originals:job.channel==='blog'?job.mediaIds.map(id=>({id,download:'/api/admin/media/'+id})):[],manuscript:job.manuscript||null,youtubePrivacy:job.channel==='youtube'?job.input.youtubePrivacy:null,madeForKids:job.channel==='youtube'?job.input.madeForKids:null};
  }
  async list() {await this.store.init();return Object.values(this.store.state.jobs).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,100).map(j=>this.view(j));}
}
module.exports={Jobs,input};
