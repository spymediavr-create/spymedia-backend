(() => {
  'use strict';
  const origin='https://spymedia-backend.onrender.com';
  const source='spymedia-admin-naver-neighbor';
  if(location.origin!==origin||location.pathname!=='/admin'||window.top!==window)return;
  const pending=new Set();
  const reply=(type,requestId,action,detail={})=>window.postMessage({source:'spymedia-naver-neighbor-extension',type,requestId,action,...detail,version:'0.1.1'},origin);
  const commandKeys={PING:[],CANCEL:[],STATUS:[],START:['confirmed'],STEP:['index'],PREPARE:['platform','expectedAccount','profiles','expiresAt','control']};
  window.addEventListener('message',async event=>{
    if(event.source!==window||event.origin!==origin||location.pathname!=='/admin')return;
    const m=event.data;
    if(!m||typeof m!=='object'||Array.isArray(m)||m.source!==source||typeof m.type!=='string'||!Object.hasOwn(commandKeys,m.type)||typeof m.requestId!=='string'||!/^[A-Za-z0-9_-]{8,80}$/.test(m.requestId))return;
    let size;try{size=JSON.stringify(m).length;}catch{reply('ERROR',m.requestId,m.type,{code:'invalid_message'});return;}
    const keys=['source','type','requestId',...commandKeys[m.type]];
    if(Object.keys(m).length!==keys.length||keys.some(key=>!Object.hasOwn(m,key))||size>4096){reply('ERROR',m.requestId,m.type,{code:'invalid_message'});return;}
    if(m.type==='PREPARE'&&(m.platform!=='blog'||m.expectedAccount!=='spymedia'||m.control!=='admin'||!Number.isSafeInteger(m.expiresAt)||!Array.isArray(m.profiles)||!m.profiles.length||m.profiles.length>10)){reply('ERROR',m.requestId,m.type,{code:'invalid_message'});return;}
    if(m.type==='START'&&m.confirmed!==true){reply('ERROR',m.requestId,m.type,{code:'not_confirmed'});return;}
    if(m.type==='STEP'&&(!Number.isSafeInteger(m.index)||m.index<0||m.index>=10)){reply('ERROR',m.requestId,m.type,{code:'invalid_message'});return;}
    try{
      const result=await chrome.runtime.sendMessage({kind:'ADMIN_MESSAGE',message:m});
      if(!result?.ok){reply('ERROR',m.requestId,m.type,{code:result?.code||'job_lost'});return;}
      if(m.type==='PREPARE')pending.add(m.requestId);
      if(m.type==='CANCEL')pending.delete(m.requestId);
      reply(m.type==='PING'?'READY':result.job?'STATE':'ACCEPTED',m.requestId,m.type,result.job?{job:result.job}:{});
    }catch{reply('ERROR',m.requestId,m.type,{code:'job_lost'});}
  });
  window.addEventListener('pagehide',()=>{
    for(const requestId of pending)chrome.runtime.sendMessage({kind:'ADMIN_MESSAGE',message:{source,type:'CANCEL',requestId}}).catch(()=>{});
    pending.clear();
  });
})();
