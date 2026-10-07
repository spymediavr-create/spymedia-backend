const fs = require('node:fs');
const fsp = require('node:fs/promises');
const axios = require('axios');
const {error} = require('./errors.cjs');
const {providerFailure}=require('./diagnostics.cjs');
const {XAuth}=require('./x-auth.cjs');
const HOSTS = new Set(['graph.instagram.com','graph.facebook.com','graph-video.facebook.com','api.x.com','www.googleapis.com','oauth2.googleapis.com']);
const TARGETS = {instagram:'spymedia_kr',facebook:'1387247911137772',x:'spymedia_kor',youtube:'UCw7OnhgTIih0M5PoMkwCDug'};
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
const identifier = value => { if(typeof value!=='string'||!/^[-_a-zA-Z0-9]{1,160}$/.test(value))throw error(502,'invalid_channel_response',true);return value; };
async function request(method,url,token,body,headers={},transport=axios) {
  const parsed=new URL(url);if(parsed.protocol!=='https:'||!HOSTS.has(parsed.hostname)||parsed.username||parsed.password)throw error(500,'invalid_api_endpoint');
  try {
    const response=await transport({method,url,data:body,headers:{...(token?{Authorization:'Bearer '+token}:{}),...headers},timeout:120000,maxRedirects:0,maxContentLength:1024*1024,maxBodyLength:600*1024**2,validateStatus:()=>true});
    if(response.status<200||response.status>=300||response.data?.error||response.data?.errors?.length){const failure=providerFailure(response,method,parsed.hostname);throw Object.assign(error(failure.status,failure.code,failure.uncertain),{providerDetails:failure.providerDetails});}
    return {data:response.data,headers:response.headers};
  }catch(e){if(e.code&&e.status)throw e;throw error(502,'channel_network_failure',method!=='GET');}
}
function caption(input) {return typeof input.xText==='string'?[input.xText,input.youtubeUrl].filter(Boolean).join('\n\n'):[input.title,input.description,input.youtubeUrl,input.tags.map(tag=>'#'+tag).join(' ')].filter(Boolean).join('\n\n');}
function xLength(text) {return [...text.replace(/https?:\/\/\S+/g,'x'.repeat(23))].reduce((n,ch)=>n+(/[\u1100-\u11ff\u2e80-\ua4cf\uac00-\ud7af\uf900-\ufaff]/u.test(ch)||ch.codePointAt(0)>0xffff?2:1),0);}
class Connectors {
  constructor(settings,options={}) {this.settings=settings;this.env=settings.env;this.request=options.request||request;this.sleep=options.sleep||sleep;this.mediaUrl=options.mediaUrl;this.xAuth=options.xAuth||new XAuth(settings,this.request,options.xAuthOptions);}
  availability() {
    const e=this.env,v=/^v\d+\.\d+$/.test(e.META_GRAPH_VERSION||'');const urls=!!this.settings.origin&&!!this.settings.mediaKey;
    return {
      instagram:!!(v&&urls&&e.IG_USER_ID&&/^\d+$/.test(e.IG_USER_ID)&&e.IG_ACCESS_TOKEN&&e.IG_PUBLISH_ENABLED==='true'),
      facebook:!!(v&&e.FB_PAGE_ACCESS_TOKEN&&e.FB_PUBLISH_ENABLED==='true'&&(!e.FB_PAGE_ID||e.FB_PAGE_ID===TARGETS.facebook)),
      x:!!(this.xAuth.configured()&&e.X_PUBLISH_ENABLED==='true'&&e.X_COST_LIMIT_ACKNOWLEDGED==='true'),
      youtube:!!(e.YOUTUBE_OAUTH_CLIENT_ID&&e.YOUTUBE_OAUTH_CLIENT_SECRET&&e.YOUTUBE_OAUTH_REFRESH_TOKEN&&e.YOUTUBE_PUBLISH_ENABLED==='true'),blog:true
    };
  }
  describeInstagramConnection(){
    return {credentialsConfigured:!!(/^v\d+\.\d+$/.test(this.env.META_GRAPH_VERSION||'')&&/^\d{1,30}$/.test(this.env.IG_USER_ID||'')&&this.env.IG_ACCESS_TOKEN),mediaDeliveryConfigured:!!(this.settings.origin&&this.settings.mediaKey),publishingEnabled:this.settings.publishingEnabled===true&&this.env.IG_PUBLISH_ENABLED==='true',publishingPermissionsVerified:false};
  }
  async instagramIdentity(){
    try{
      if(!this.describeInstagramConnection().credentialsConfigured)throw error(503,'instagram_not_configured');
      const identity=(await this.request('GET','https://graph.instagram.com/'+this.env.META_GRAPH_VERSION+'/'+this.env.IG_USER_ID+'?fields=id,username',this.env.IG_ACCESS_TOKEN)).data;
      if(typeof identity?.id!=='string'||!/^\d{1,30}$/.test(identity.id)||typeof identity.username!=='string')throw error(502,'invalid_channel_response');
      if(identity.id!==this.env.IG_USER_ID||identity.username!==TARGETS.instagram){
        const userIdPresent=Object.hasOwn(identity,'user_id'),userIdUsable=typeof identity.user_id==='string'&&/^\d{1,30}$/.test(identity.user_id);
        // Compare only; never forward the identity, identifier values or provider payload.
        throw Object.assign(error(409,'account_mismatch'),{identityComparison:{usernameMatches:identity.username===TARGETS.instagram,idMatches:identity.id===this.env.IG_USER_ID,userIdPresent,...(userIdUsable?{userIdMatchesConfigured:identity.user_id===this.env.IG_USER_ID,idMatchesUserId:identity.id===identity.user_id}:{})}});
      }
      return {userId:identity.id,username:TARGETS.instagram,identityVerified:true};
    }catch(e){e.phase='instagram_identity';throw e;}
  }
  async checkInstagramConnection(){return {...await this.instagramIdentity(),...this.describeInstagramConnection()};}
  async facebookIdentity(){
    const root='https://graph.facebook.com/'+this.env.META_GRAPH_VERSION;
    try{
      const identity=(await this.request('GET',root+'/me?fields=id,name',this.env.FB_PAGE_ACCESS_TOKEN)).data;
      if(!identity||typeof identity!=='object'||typeof identity.id!=='string')throw error(502,'invalid_channel_response');
      if(identity.id!==TARGETS.facebook)throw error(409,'account_mismatch');
      return identity;
    }catch(e){e.phase='facebook_identity';throw e;}
  }
  async checkFacebookConnection(){
    const publishingEnabled=this.settings.publishingEnabled&&this.env.FB_PUBLISH_ENABLED==='true';
    if(!/^v\d+\.\d+$/.test(this.env.META_GRAPH_VERSION||'')||!this.env.FB_PAGE_ACCESS_TOKEN)throw error(503,'channel_not_configured');
    if(this.env.FB_PAGE_ID&&this.env.FB_PAGE_ID!==TARGETS.facebook)throw error(409,'account_mismatch');
    const identity=await this.facebookIdentity();
    return {pageId:identity.id,pageName:identity.name=== '스파이미디어'?identity.name:'스파이미디어 Page',identityVerified:true,publishingPermissionsVerified:false,publishingEnabled};
  }
  async xIdentity(allowRefresh=false){
    try{
      const identity=(await this.xAuth.call('GET','https://api.x.com/2/users/me',undefined,{allowRefresh})).data?.data;
      if(identity?.username!==TARGETS.x)throw error(409,'account_mismatch');
      return identity;
    }catch(e){if(!e.phase)e.phase='x_identity';throw e;}
  }
  async checkXConnection(){
    if(this.env.X_COST_LIMIT_ACKNOWLEDGED!=='true')throw error(409,'x_cost_confirmation_required');
    const identity=await this.xIdentity(false);
    if(typeof identity.id!=='string'||!/^\d{1,30}$/.test(identity.id))throw Object.assign(error(502,'invalid_channel_response'),{phase:'x_identity'});
    return {userId:identity.id,username:TARGETS.x,identityVerified:true,publishingPermissionsVerified:false,authMode:this.xAuth.mode(),refreshConfigured:this.xAuth.describe().refreshConfigured,publishingEnabled:this.settings.publishingEnabled&&this.availability().x};
  }
  async publish(job,context) {
    if(!this.settings.publishingEnabled||!this.availability()[job.channel])throw error(503,'channel_not_configured');
    return this[job.channel](job,context);
  }
  async instagram(job,ctx) {
    const root='https://graph.instagram.com/'+this.env.META_GRAPH_VERSION;const id=this.env.IG_USER_ID,token=this.env.IG_ACCESS_TOKEN;
    const call=async(method,route,body)=>this.request(method,root+'/'+route,token,body);
    await this.instagramIdentity();
    if(job.type==='instagram-photo'){
      if(job.assets.length!==1||job.assets[0].kind!=='image'||job.assets[0].type!=='image/jpeg'||job.assets[0].original!==true)throw error(422,'instagram_photo_only');
      let container,mediaId;
      try{container=identifier((await call('POST',id+'/media',{image_url:this.mediaUrl(job.assets[0]),caption:caption(job.input)})).data?.id);await ctx.checkpoint({containerId:container});}catch(e){e.phase='instagram_photo_create';throw e;}
      try{await this.waitInstagram(call,container,{interval:2000});}catch(e){e.phase='instagram_photo_prepare';throw e;}
      try{await ctx.beforePublication({containerId:container});mediaId=identifier((await call('POST',id+'/media_publish',{creation_id:container})).data?.id);await ctx.checkpoint({externalId:mediaId});}catch(e){e.phase='instagram_photo_publish';throw e;}
      try{
        const result=(await call('GET',mediaId+'?fields=id,permalink')).data;
        if(result?.id!==mediaId)throw error(502,'verify_publication',true);
        let url=null;
        try{const u=new URL(result.permalink);if(u.protocol==='https:'&&['instagram.com','www.instagram.com'].includes(u.hostname)&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&/^\/(p|reel)\/[a-zA-Z0-9_-]+\/$/.test(u.pathname))url=u.href;}catch{}
        return {externalId:mediaId,url};
      }catch(e){e.phase='instagram_photo_verify';throw e;}
    }
    const assets=job.assets,children=[];
    for(const asset of assets) {
      const body=asset.kind==='video'?{media_type:'REELS',video_url:this.mediaUrl(asset),share_to_feed:true}:{image_url:this.mediaUrl(asset)};
      if(assets.length>1)body.is_carousel_item=true;else body.caption=caption(job.input);
      const created=identifier((await call('POST',id+'/media',body)).data.id);children.push(created);await ctx.checkpoint({containerIds:[...children]});
      await this.waitInstagram(call,created);
    }
    let container=children[0];
    if(children.length>1){container=identifier((await call('POST',id+'/media',{media_type:'CAROUSEL',children:children.join(','),caption:caption(job.input)})).data.id);await ctx.checkpoint({containerId:container});await this.waitInstagram(call,container);}
    await ctx.beforePublication({containerId:container});
    const mediaId=identifier((await call('POST',id+'/media_publish',{creation_id:container})).data.id);await ctx.checkpoint({externalId:mediaId});
    const result=(await call('GET',mediaId+'?fields=id,permalink')).data;
    if(result.id!==mediaId)throw error(502,'verify_publication',true);
    return {externalId:mediaId,url:result.permalink||null};
  }
  async waitInstagram(call,id,{interval=60000}={}) {
    for(let i=0;i<6;i++) {
      const state=(await call('GET',id+'?fields=status_code')).data.status_code;
      if(state==='FINISHED')return;
      if(['ERROR','EXPIRED','PUBLISHED'].includes(state))throw error(422,'channel_media_processing');
      if(i<5)await this.sleep(interval);
    }
    throw error(422,'channel_media_processing_timeout');
  }
  async facebook(job,ctx) {
    const root='https://graph.facebook.com/'+this.env.META_GRAPH_VERSION,id=TARGETS.facebook,token=this.env.FB_PAGE_ACCESS_TOKEN;
    const call=async(method,route,body,phase)=>{try{return await this.request(method,root+'/'+route,token,body);}catch(e){if(phase)e.phase=phase;throw e;}};
    await this.facebookIdentity();
    let postId;
    if(job.type==='link'){
      try{
        await ctx.beforePublication({});postId=identifier((await call('POST',id+'/feed',{message:caption(job.input),link:job.input.youtubeUrl},'facebook_link_create')).data?.id);
      }catch(e){e.phase='facebook_link_create';throw e;}
      await ctx.checkpoint({externalId:postId});
      try{
        const result=(await call('GET',postId+'?fields=id,permalink_url',undefined,'facebook_link_verify')).data;
        if(result?.id!==postId)throw error(502,'verify_publication',true);return {externalId:postId,url:result.permalink_url||null};
      }catch(e){e.phase='facebook_link_verify';throw e;}
    }
    if(job.assets[0].kind==='video') {
      await ctx.beforePublication({});
      const created=(await this.request('POST','https://graph-video.facebook.com/'+this.env.META_GRAPH_VERSION+'/'+id+'/videos',token,{file_url:this.mediaUrl(job.assets[0]),title:job.input.title,description:caption(job.input)})).data;
      postId=identifier(created.id);await ctx.checkpoint({externalId:postId});
      for(let i=0;i<20;i++) {
        const result=(await call('GET',postId+'?fields=id,status,published,permalink_url')).data;
        if(result.id===postId&&result.published===true&&result.status?.video_status==='ready')return {externalId:postId,url:result.permalink_url||null};
        if(result.status?.video_status==='error')throw error(422,'channel_media_processing',true);
        await this.sleep(15000);
      }
      throw error(502,'verify_publication',true);
    }
    if(job.assets.length===1) {
      await ctx.beforePublication({});const created=(await call('POST',id+'/photos',{url:this.mediaUrl(job.assets[0]),caption:caption(job.input),published:true})).data;
      postId=identifier(created.post_id||created.id);
    }else {
      const photos=[];
      for(const asset of job.assets){const created=identifier((await call('POST',id+'/photos',{url:this.mediaUrl(asset),published:false})).data.id);photos.push({media_fbid:created});await ctx.checkpoint({uploadedPhotoIds:photos.map(p=>p.media_fbid)});}
      await ctx.beforePublication({});postId=identifier((await call('POST',id+'/feed',{message:caption(job.input),attached_media:photos})).data.id);
    }
    await ctx.checkpoint({externalId:postId});const result=(await call('GET',postId+'?fields=id,permalink_url')).data;
    if(result.id!==postId)throw error(502,'verify_publication',true);return {externalId:postId,url:result.permalink_url||null};
  }
  async x(job,ctx) {
    const root='https://api.x.com/2',call=(method,route,body)=>this.xAuth.call(method,root+'/'+route,body);
    await this.xIdentity(true);
    if(job.type==='link'){
      let postId;
      try{await ctx.beforePublication({});postId=identifier((await call('POST','tweets',{text:caption(job.input)})).data?.data?.id);}
      catch(e){if(!e.phase)e.phase='x_link_create';throw e;}
      await ctx.checkpoint({externalId:postId});
      try{if((await call('GET','tweets/'+postId)).data?.data?.id!==postId)throw error(502,'verify_publication',true);}
      catch(e){if(!e.phase)e.phase='x_link_verify';throw e;}
      return {externalId:postId,url:'https://x.com/'+TARGETS.x+'/status/'+postId};
    }
    const ids=[];
    for(const asset of job.assets) {
      const uploaded=identifier((await call('POST','media/upload/initialize',{total_bytes:asset.size,media_type:asset.type,media_category:asset.kind==='video'?'tweet_video':'tweet_image'})).data.data?.id);ids.push(uploaded);await ctx.checkpoint({uploadedMediaIds:[...ids]});
      const handle=await fsp.open(ctx.assetPath(asset),'r');const buffer=Buffer.alloc(1024*1024);let index=0;
      try {for(;;){const {bytesRead}=await handle.read(buffer,0,buffer.length,null);if(!bytesRead)break;await call('POST',`media/upload/${uploaded}/append`,{segment_index:index++,media:buffer.subarray(0,bytesRead).toString('base64')});}}finally{await handle.close();}
      let data=(await call('POST',`media/upload/${uploaded}/finalize`)).data.data;
      for(let i=0;data?.processing_info&&data.processing_info.state!=='succeeded';i++) {
        if(i>=60||data.processing_info.state==='failed')throw error(422,'channel_media_processing');
        await this.sleep(Math.min(30000,Math.max(1000,Number(data.processing_info.check_after_secs||1)*1000)));
        data=(await call('GET',`media/upload?media_id=${uploaded}&command=STATUS`)).data.data;
      }
    }
    await ctx.beforePublication({});const postId=identifier((await call('POST','tweets',{text:caption(job.input),media:{media_ids:ids}})).data.data?.id);await ctx.checkpoint({externalId:postId});
    if((await call('GET','tweets/'+postId)).data.data?.id!==postId)throw error(502,'verify_publication',true);
    return {externalId:postId,url:'https://x.com/'+TARGETS.x+'/status/'+postId};
  }
  async youtube(job,ctx) {
    const tokenResponse=await this.request('POST','https://oauth2.googleapis.com/token',null,new URLSearchParams({grant_type:'refresh_token',client_id:this.env.YOUTUBE_OAUTH_CLIENT_ID,client_secret:this.env.YOUTUBE_OAUTH_CLIENT_SECRET,refresh_token:this.env.YOUTUBE_OAUTH_REFRESH_TOKEN}).toString(),{'Content-Type':'application/x-www-form-urlencoded'});
    const token=tokenResponse.data.access_token;if(!token)throw error(409,'channel_auth_or_permission');
    const channels=(await this.request('GET','https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',token)).data.items||[];
    if(channels.length!==1||channels[0].id!==TARGETS.youtube)throw error(409,'account_mismatch');
    const asset=job.assets[0];const metadata={snippet:{title:job.input.title,description:[job.input.description,job.input.tags.map(t=>'#'+t).join(' ')].filter(Boolean).join('\n\n'),tags:job.input.tags,categoryId:'22'},status:{privacyStatus:job.input.youtubePrivacy,selfDeclaredMadeForKids:job.input.madeForKids}};
    const initialized=await this.request('POST','https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',token,metadata,{'X-Upload-Content-Length':String(asset.size),'X-Upload-Content-Type':asset.type});
    let location;try{location=new URL(initialized.headers.location);}catch{throw error(502,'invalid_channel_response');}
    if(location.protocol!=='https:'||location.hostname!=='www.googleapis.com'||location.pathname!=='/upload/youtube/v3/videos')throw error(502,'invalid_api_endpoint');
    await ctx.beforePublication({});const created=(await this.request('PUT',location.href,token,fs.createReadStream(ctx.assetPath(asset)),{'Content-Type':asset.type,'Content-Length':String(asset.size)})).data;
    const postId=identifier(created.id);await ctx.checkpoint({externalId:postId});
    const result=(await this.request('GET','https://www.googleapis.com/youtube/v3/videos?part=status&id='+postId,token)).data.items?.[0];
    if(result?.id!==postId||['failed','rejected','deleted'].includes(result.status?.uploadStatus))throw error(502,'verify_publication',true);
    return {externalId:postId,url:'https://www.youtube.com/watch?v='+postId,privacyStatus:result.status?.privacyStatus,processing:result.status?.uploadStatus!=='processed'};
  }
}
module.exports={Connectors,request,TARGETS,caption,xLength};
