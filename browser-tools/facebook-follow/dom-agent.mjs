// Serialized by chrome.scripting.executeScript. Visible DOM only: no cookies,
// hidden React state, private API calls, credentials or remote scripts.
export function inspectFacebookPage({expectedAccount, expectedName, targetUrl, mode = 'inspect'}) {
  const fail = code => ({ok:false, code});
  const origin = 'https://www.facebook.com';
  const text = node => String(node?.innerText ?? node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const visible = node => {
    if (!node || !node.getClientRects().length) return false;
    for (let p=node; p && p!==document; p=p.parentElement) {
      if (p.hidden || p.getAttribute('aria-hidden')==='true' || p.hasAttribute('inert')) return false;
      const style=getComputedStyle(p);
      if (style.display==='none' || style.visibility==='hidden') return false;
    }
    return true;
  };
  const url = value => { try { const u=new URL(value, origin); return u.origin===origin && !u.username && !u.password ? u : null; } catch { return null; } };
  const identity = u => {
    if (!u) return null;
    if (u.pathname==='/profile.php' && /^\d{1,30}$/.test(u.searchParams.get('id')||'')) return 'id:'+u.searchParams.get('id');
    const numeric=u.pathname.match(/^\/(?:people\/[^/]+\/)?(\d{1,30})\/?$/);
    if (numeric) return 'id:'+numeric[1];
    const vanity=u.pathname.match(/^\/([a-z0-9.]{1,100})\/?$/i);
    const reserved=/^(me|login|login.php|checkpoint|recover|search|groups|pages|events|reels?|watch|friends|notifications|messages|settings|help|business|marketplace|gaming|photo.php|profile.php)$/i;
    return vanity && !reserved.test(vanity[1]) ? 'name:'+vanity[1].toLowerCase() : null;
  };
  const counter = anchor => {
    const u=url(anchor.getAttribute('href'));
    if (!u) return null;
    if (['followers','following'].includes(u.searchParams.get('sk'))) return {identity:identity(u),kind:u.searchParams.get('sk')};
    const m=u.pathname.match(/\/(followers|following)\/?$/);
    if (!m) return null;
    u.pathname=u.pathname.slice(0,m.index)||'/';
    return {identity:identity(u),kind:m[1]};
  };
  const current=url(location.href);
  if (!current) return fail('wrong_profile');
  if (/^\/(login|login.php|recover)(\/|$)/.test(current.pathname)) return fail('login_required');
  if (/^\/(checkpoint|challenge)(\/|$)/.test(current.pathname)) return fail('challenge');
  if ([...document.querySelectorAll('input[name="email"],input[name="pass"],input[type="password"]')].some(visible)) return fail('login_required');
  const notices=[...document.querySelectorAll('[role="alert"],[role="dialog"],[role="alertdialog"]')].filter(visible);
  if (notices.some(n=>/(try again later|temporarily blocked|confirm your identity|suspicious|잠시 후 다시|나중에 다시|일시적으로 차단|활동.*제한|본인 확인)/i.test(text(n)))) return fail('challenge');
  if (notices.some(n=>n.matches('[role="dialog"],[role="alertdialog"]'))) return fail('ambiguous_profile');
  if (expectedAccount!=='61594869881531' || expectedName!=='스파이미디어' || !['actor','inspect','click'].includes(mode)) return fail('account_mismatch');

  // The Page being viewed is NOT the acting account. Only the global Facebook
  // navigation's Page-specific Ad Center destination identifies the actor.
  // The owned Page sidebar can also exist in personal mode and is never used.
  const actors=new Set();
  for (const a of document.querySelectorAll('[role="navigation"][aria-label="Facebook"] a[href]')) {
    if (!visible(a) || a.closest('main,[role="main"],article,[role="dialog"]')) continue;
    const u=url(a.getAttribute('href')), m=u?.pathname.match(/^\/(\d{1,30})\/ad_center\/?$/);
    const label=String(a.getAttribute('aria-label') || text(a)).trim();
    if (m && /^(광고 센터|Ad Cent(?:er|re))$/i.test(label)) actors.add(m[1]);
  }
  if (actors.size!==1) return fail('account_unverified');
  if (!actors.has(expectedAccount)) return fail('account_mismatch');
  const targetIdentity=mode==='actor' ? 'id:'+expectedAccount : identity(url(targetUrl));
  if (!targetIdentity || identity(current)!==targetIdentity) return fail(mode==='actor'?'account_mismatch':'wrong_profile');
  if (mode!=='actor' && targetIdentity==='id:'+expectedAccount) return fail('wrong_profile');

  const links=[...document.querySelectorAll('a[href]')].filter(visible);
  const stats=links.filter(a=>counter(a)?.identity===targetIdentity);
  const followers=stats.filter(a=>counter(a).kind==='followers');
  if (!followers.length || !stats.some(a=>counter(a).kind==='following')) return fail('ambiguous_profile');
  const actionLabel = node => {
    const aria=String(node.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim(), rendered=text(node);
    const labels=['Follow','팔로우','Following','팔로잉'];
    // An unrelated accessibility label must not inherit descendant Follow text.
    if (aria && !labels.includes(aria)) return null;
    if (aria && rendered && rendered!==aria) return null;
    return labels.includes(aria||rendered) ? (aria||rendered) : null;
  };
  const foreignProfile = a => {
    const u=url(a.getAttribute('href')), id=counter(a)?.identity || identity(u);
    return !!id && id!==targetIdentity;
  };
  const boundaries='article,[role="article"],[role="feed"],[role="dialog"],[role="list"],[role="listitem"],ul,ol,li,[role="menu"],[role="menuitem"]';
  const hasFeed = node => !!node.querySelector('article,[role="article"],[role="feed"]') || [...node.querySelectorAll('a[href]')].some(a=>{
    const u=url(a.getAttribute('href'));
    return u && (/\/(posts|videos|reels?|photos)\//.test(u.pathname) || /^\/(story|permalink)\.php$/.test(u.pathname));
  });
  const isTargetControl = (node,header) => {
    for (let p=node;p && p!==header;p=p.parentElement) {
      if (p.matches(boundaries)) return false;
      if (p.matches('a[href]') && foreignProfile(p)) return false;
      // Biography or mutual-follow links elsewhere in the header are allowed;
      // a button in a separate recommendation card is not a profile control.
      if (p!==node && stats.some(a=>p.contains(a))) break;
      if ([...p.querySelectorAll('a[href]')].filter(visible).some(foreignProfile)) return false;
    }
    return true;
  };
  const headers=[];
  for (const anchor of followers) {
    for (let p=anchor.parentElement,depth=0;p && p!==document.body && depth<14;p=p.parentElement,depth++) {
      if (p.matches(boundaries) || hasFeed(p)) break;
      if (!stats.some(a=>counter(a).kind==='following' && p.contains(a))) continue;
      const controls=[...p.querySelectorAll('button,[role="button"]')].filter(n=>visible(n) && isTargetControl(n,p));
      if (mode==='actor') {
        const hasName=[...p.querySelectorAll('h1,h2,[role="heading"],button,[role="button"]')].some(n=>visible(n) && text(n)===expectedName);
        const edit=[...p.querySelectorAll('a[href]')].some(a=>visible(a) && identity(url(a.getAttribute('href')))===targetIdentity && /^(프로필 편집|Edit profile)$/i.test(a.getAttribute('aria-label')||text(a)));
        if (hasName && edit) { headers.push(p); break; }
      } else if (controls.some(actionLabel)) { headers.push(p); break; }
    }
  }
  const unique=[...new Set(headers)];
  if (unique.length!==1) return fail('ambiguous_profile');
  const header=unique[0];
  if ([...header.querySelectorAll('a[href]')].filter(visible).some(a=>counter(a)?.identity && counter(a).identity!==targetIdentity)) return fail('ambiguous_profile');
  if (mode==='actor') return {ok:true,state:'actor_verified',actorId:expectedAccount};
  const candidates=[...header.querySelectorAll('button,[role="button"]')].filter(n=>visible(n) && isTargetControl(n,header) && actionLabel(n));
  const actions=[...new Set(candidates.map(n=>{
    const nested=candidates.filter(other=>n.contains(other)||other.contains(n));
    const native=nested.filter(other=>other.tagName==='BUTTON');
    return native.length===1 && nested.every(other=>actionLabel(other)===actionLabel(n) && (native[0].contains(other)||other.contains(native[0]))) ? native[0] : n;
  }))];
  if (actions.length!==1) return fail('ambiguous_profile');
  const button=actions[0];
  if (['Following','팔로잉'].includes(actionLabel(button))) return {ok:true,state:'following'};
  if (button.disabled || button.getAttribute('aria-disabled')==='true') return fail('ambiguous_profile');
  if (mode!=='click') return {ok:true,state:'follow'};
  button.click();
  return {ok:true,state:'clicked'};
}
