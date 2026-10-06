const crypto=require('node:crypto');
const fs=require('node:fs/promises');
const path=require('node:path');
const {error}=require('./errors.cjs');
const OAUTH1_KEYS=['X_API_KEY','X_API_SECRET','X_ACCESS_TOKEN','X_ACCESS_TOKEN_SECRET'];
const SCOPES=['tweet.read','users.read','tweet.write'];
const secret=value=>typeof value==='string'&&value.length>0&&value.length<=8192&&!/[\r\n\0]/.test(value);
const encode=value=>encodeURIComponent(value).replace(/[!'()*]/g,ch=>'%'+ch.charCodeAt(0).toString(16).toUpperCase());
function oauth1Header(method,url,credentials,options={}){
  const parsed=new URL(url),oauth={oauth_consumer_key:credentials.apiKey,oauth_token:credentials.accessToken,oauth_signature_method:'HMAC-SHA1',oauth_timestamp:String(options.timestamp??Math.floor(Date.now()/1000)),oauth_nonce:options.nonce??crypto.randomBytes(24).toString('hex')};
  if(options.version!==false)oauth.oauth_version='1.0';
  const pairs=[...parsed.searchParams,...Object.entries(oauth),...Object.entries(options.form||{})].map(([k,v])=>[encode(k),encode(v)]);
  pairs.sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:a[1]<b[1]?-1:a[1]>b[1]?1:0);
  const normalized=pairs.map(([k,v])=>k+'='+v).join('&'),base=[method.toUpperCase(),parsed.origin+parsed.pathname,normalized].map(encode).join('&');
  oauth.oauth_signature=crypto.createHmac('sha1',encode(credentials.apiSecret)+'&'+encode(credentials.accessTokenSecret)).update(base).digest('base64');
  return 'OAuth '+Object.keys(oauth).sort().map(k=>encode(k)+'="'+encode(oauth[k])+'"').join(', ');
}
class XTokenVault{
  constructor(settings){this.settings=settings;this.file=path.join(settings.dataDir||'', 'x-oauth2.enc.json');}
  key(){const value=this.settings.env.X_TOKEN_ENCRYPTION_KEY;if(!/^[a-f0-9]{64}$/i.test(value||''))throw error(503,'x_token_storage_unavailable');return Buffer.from(value,'hex');}
  async root(){
    try{this.settings.requireStorage();await fs.mkdir(this.settings.dataDir,{recursive:true,mode:0o700});if((await fs.lstat(this.settings.dataDir)).isSymbolicLink())throw Error();}
    catch{throw error(503,'x_token_storage_unavailable');}
  }
  async load(clientId){
    await this.root();
    try{
      const stat=await fs.lstat(this.file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)throw Error();
      const value=JSON.parse(await fs.readFile(this.file,'utf8'));
      if(value.version!==1||!/^[a-f0-9]{24}$/.test(value.iv)||!/^[a-f0-9]{32}$/.test(value.tag)||typeof value.data!=='string'||!/^[a-f0-9]+$/.test(value.data))throw Error();
      const cipher=crypto.createDecipheriv('aes-256-gcm',this.key(),Buffer.from(value.iv,'hex'));
      cipher.setAAD(Buffer.from('spymedia-x-oauth2:v1:'+clientId));cipher.setAuthTag(Buffer.from(value.tag,'hex'));
      const state=JSON.parse(Buffer.concat([cipher.update(Buffer.from(value.data,'hex')),cipher.final()]).toString('utf8'));
      if(state.clientId!==clientId||!secret(state.refreshToken)||state.accessToken!==null&&!secret(state.accessToken)||!Number.isSafeInteger(state.expiresAt)||state.expiresAt<0||typeof state.refreshPending!=='boolean')throw Error();
      return state;
    }catch(e){if(e.code==='ENOENT')return null;throw error(503,'x_token_storage_unavailable');}
  }
  async save(state){
    await this.root();
    const temp=path.join(this.settings.dataDir,'x-oauth2-'+crypto.randomUUID()+'.tmp');
    try{
      try{const stat=await fs.lstat(this.file);if(!stat.isFile()||stat.isSymbolicLink())throw Error();}catch(e){if(e.code!=='ENOENT')throw e;}
      const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',this.key(),iv);cipher.setAAD(Buffer.from('spymedia-x-oauth2:v1:'+state.clientId));
      const encrypted=Buffer.concat([cipher.update(JSON.stringify(state),'utf8'),cipher.final()]);
      const handle=await fs.open(temp,'wx',0o600);
      try{await handle.writeFile(JSON.stringify({version:1,iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),data:encrypted.toString('hex')}));await handle.sync();}finally{await handle.close();}
      for(let attempt=0;;attempt++){
        try{await fs.rename(temp,this.file);break;}catch(e){if(process.platform!=='win32'||!['EPERM','EACCES','EBUSY'].includes(e.code)||attempt>=9)throw e;await new Promise(resolve=>setTimeout(resolve,(attempt+1)*10));}
      }
    }catch{throw error(503,'x_token_storage_unavailable');}
    finally{await fs.unlink(temp).catch(()=>{});}
  }
}
class XAuth{
  constructor(settings,request,options={}){this.settings=settings;this.env=settings.env;this.request=request;this.now=options.now||Date.now;this.vault=options.vault||new XTokenVault(settings);this.loaded=null;this.state=null;this.refreshPromise=null;}
  mode(){
    const e=this.env,one=OAUTH1_KEYS.some(k=>!!e[k]),two=!!(e.X_USER_ACCESS_TOKEN||e.X_OAUTH_REFRESH_TOKEN);
    if(e.X_AUTH_MODE)return ['oauth1','oauth2'].includes(e.X_AUTH_MODE)?e.X_AUTH_MODE:null;
    if(one&&two)return null;return one?'oauth1':two?'oauth2':null;
  }
  refreshConfigured(){return secret(this.env.X_OAUTH_CLIENT_ID)&&secret(this.env.X_OAUTH_REFRESH_TOKEN)&&/^[a-f0-9]{64}$/i.test(this.env.X_TOKEN_ENCRYPTION_KEY||'')&&this.settings.storageConfigured===true&&(!this.env.X_OAUTH_CLIENT_SECRET||secret(this.env.X_OAUTH_CLIENT_SECRET));}
  configured(){
    if(this.mode()==='oauth1')return OAUTH1_KEYS.every(k=>secret(this.env[k]));
    if(this.mode()!=='oauth2')return false;
    const hasRefresh=!!(this.env.X_OAUTH_CLIENT_ID||this.env.X_OAUTH_REFRESH_TOKEN||this.env.X_OAUTH_CLIENT_SECRET||this.env.X_TOKEN_ENCRYPTION_KEY);
    return hasRefresh?this.refreshConfigured():secret(this.env.X_USER_ACCESS_TOKEN);
  }
  describe(){return {authMode:this.mode(),credentialsConfigured:this.configured(),refreshConfigured:this.mode()==='oauth2'&&this.refreshConfigured(),costAcknowledged:this.env.X_COST_LIMIT_ACKNOWLEDGED==='true',publishingPermissionsVerified:false};}
  async load(){
    if(!this.loaded)this.loaded=(async()=>{
      if(!this.configured())throw error(503,'x_auth_configuration');
      if(this.mode()!=='oauth2')return;
      const stored=this.refreshConfigured()?await this.vault.load(this.env.X_OAUTH_CLIENT_ID):null;
      const expires=this.env.X_USER_ACCESS_TOKEN_EXPIRES_AT?Date.parse(this.env.X_USER_ACCESS_TOKEN_EXPIRES_AT):0;
      if(!Number.isSafeInteger(expires)||expires<0)throw error(503,'x_auth_configuration');
      this.state=stored||{clientId:this.env.X_OAUTH_CLIENT_ID||'',accessToken:secret(this.env.X_USER_ACCESS_TOKEN)?this.env.X_USER_ACCESS_TOKEN:null,refreshToken:this.env.X_OAUTH_REFRESH_TOKEN||'',expiresAt:expires,refreshPending:false};
    })();
    return this.loaded;
  }
  async refresh(observedToken){
    await this.load();if(!this.refreshConfigured())throw error(409,'x_auth_expired');
    if(this.refreshPromise)return this.refreshPromise;
    if(this.state.refreshPending)throw error(409,'x_refresh_reauthorization_required');
    if(observedToken!==undefined&&this.state.accessToken!==observedToken&&this.state.expiresAt>this.now()+60000)return;
    this.refreshPromise=(async()=>{
      // Persist intent before a rotating refresh token is sent. A crash/uncertain response must not reuse it.
      this.state={...this.state,refreshPending:true};await this.vault.save(this.state);
      try{
        const body=new URLSearchParams({grant_type:'refresh_token',refresh_token:this.state.refreshToken}),headers={'Content-Type':'application/x-www-form-urlencoded'};
        if(this.env.X_OAUTH_CLIENT_SECRET)headers.Authorization='Basic '+Buffer.from(encode(this.env.X_OAUTH_CLIENT_ID)+':'+encode(this.env.X_OAUTH_CLIENT_SECRET)).toString('base64');
        else body.set('client_id',this.env.X_OAUTH_CLIENT_ID);
        const response=(await this.request('POST','https://api.x.com/2/oauth2/token',null,body.toString(),headers)).data;
        if(!secret(response?.access_token)||!secret(response?.refresh_token)||response.token_type?.toLowerCase()!=='bearer'||!Number.isInteger(response.expires_in)||response.expires_in<=0||response.expires_in>31536000)throw error(502,'invalid_channel_response');
        if(response.scope!==undefined&&(typeof response.scope!=='string'||!SCOPES.every(s=>response.scope.split(' ').includes(s))))throw error(409,'x_scope_missing');
        const next={clientId:this.state.clientId,accessToken:response.access_token,refreshToken:response.refresh_token,expiresAt:this.now()+response.expires_in*1000,refreshPending:false};
        await this.vault.save(next);this.state=next;
      }catch(e){
        const failure=error(e.status||409,'x_refresh_reauthorization_required');failure.providerDetails=e.providerDetails;failure.phase='x_token_refresh';throw failure;
      }
    })();
    try{await this.refreshPromise;}finally{this.refreshPromise=null;}
  }
  async call(method,url,body,{allowRefresh=false}={}){
    const parsed=new URL(url);if(parsed.origin!=='https://api.x.com'||parsed.username||parsed.password||!parsed.pathname.startsWith('/2/')||parsed.pathname==='/2/oauth2/token')throw error(500,'invalid_api_endpoint');
    await this.load();
    if(this.mode()==='oauth1')return this.request(method,url,null,body,{Authorization:oauth1Header(method,url,{apiKey:this.env.X_API_KEY,apiSecret:this.env.X_API_SECRET,accessToken:this.env.X_ACCESS_TOKEN,accessTokenSecret:this.env.X_ACCESS_TOKEN_SECRET})});
    if(this.state.refreshPending)throw error(409,'x_refresh_reauthorization_required');
    if(!this.state.accessToken||this.state.expiresAt&&this.state.expiresAt<=this.now()+60000){if(!allowRefresh)throw error(409,'x_auth_expired');await this.refresh(this.state.accessToken);}
    const token=this.state.accessToken;
    try{return await this.request(method,url,token,body);}catch(e){
      // Only an identity GET can be repeated after renewal; a post is never replayed.
      if(allowRefresh&&method==='GET'&&e.providerDetails?.httpStatus===401&&this.refreshConfigured()){await this.refresh(token);return this.request(method,url,this.state.accessToken,body);}
      throw e;
    }
  }
}
module.exports={XAuth,XTokenVault,oauth1Header,SCOPES};
