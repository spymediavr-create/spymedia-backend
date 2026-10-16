(() => {
  'use strict';
  const origin = 'https://spymedia-backend.onrender.com';
  if (location.origin !== origin || location.pathname !== '/admin' || window.top !== window) return;
  const pending = new Set();
  const reply = (type, requestId, code) => window.postMessage({source:'spymedia-follow-extension',type,requestId,...(code ? {code}:{}),version:'0.1.0'},origin);
  window.addEventListener('message', async event => {
    if (event.source !== window || event.origin !== origin || location.pathname !== '/admin') return;
    const m = event.data;
    if (!m || m.source !== 'spymedia-admin-follow' || !['PING','PREPARE','CANCEL'].includes(m.type) || !/^[A-Za-z0-9_-]{8,80}$/.test(m.requestId || '')) return;
    if (m.type !== 'PREPARE' && Object.keys(m).some(k=>!['source','type','requestId'].includes(k))) return;
    if (m.type === 'PREPARE' && (!Array.isArray(m.profiles) || m.profiles.length > 10 || JSON.stringify(m).length > 4096)) { reply('ERROR',m.requestId,'invalid_message'); return; }
    try {
      const result = await chrome.runtime.sendMessage({kind:'ADMIN_MESSAGE',message:m});
      if (!result?.ok) { reply('ERROR',m.requestId,result?.code || 'job_lost'); return; }
      if (m.type === 'PREPARE') pending.add(m.requestId);
      if (m.type === 'CANCEL') pending.delete(m.requestId);
      reply(m.type === 'PING' ? 'READY' : 'ACCEPTED',m.requestId);
    } catch { reply('ERROR',m.requestId,'job_lost'); }
  });
  window.addEventListener('pagehide', () => {
    for (const requestId of pending) chrome.runtime.sendMessage({kind:'ADMIN_MESSAGE',message:{source:'spymedia-admin-follow',type:'CANCEL',requestId}}).catch(()=>{});
    pending.clear();
  });
})();
