// Serialized by chrome.scripting.executeScript. No private API, remote scripts or hidden state.
// Verify visible navigation and the selected profile; unsupported/ambiguous layouts stop the job.
export function inspectInstagramPage({expectedAccount, targetUrl, mode = 'inspect'}) {
  const fail = code => ({ok:false, code});
  const text = node => String(node?.innerText ?? node?.textContent ?? '').replace(/\s+/g,' ').trim();
  const visible = node => {
    if (!node || node.hidden || node.getAttribute('aria-hidden') === 'true' || !node.getClientRects().length) return false;
    if (typeof getComputedStyle === 'function') { const style = getComputedStyle(node); if (style.visibility === 'hidden' || style.display === 'none') return false; }
    return true;
  };
  const current = new URL(location.href);
  if (current.origin !== 'https://www.instagram.com') return fail('wrong_profile');
  if (/^\/accounts\/(login|signup)/.test(current.pathname)) return fail('login_required');
  if (/^\/(challenge|checkpoint)/.test(current.pathname)) return fail('challenge');
  const body = text(document.body);
  if (/(try again later|we restrict certain activity|action blocked|confirm it.s you|suspicious login|잠시 후 다시 시도|나중에 다시 시도|일부 활동을 제한|활동이 차단|본인 확인|의심스러운 로그인)/i.test(body)) return fail('challenge');
  if (document.querySelector('input[name="username"], input[name="password"]')) return fail('login_required');
  if (current.href !== targetUrl) return fail('wrong_profile');
  const target = current.pathname.split('/')[1];
  const profileName = anchor => {
    try { const u = new URL(anchor.getAttribute('href'),location.origin), m = u.pathname.match(/^\/([A-Za-z0-9._]{1,30})\/?$/); return u.origin === current.origin && !u.search && !u.hash && m ? m[1].toLowerCase() : null; } catch { return null; }
  };
  const profileLabel = (anchor,name) => {
    const labels = [text(anchor),anchor.getAttribute('aria-label'),anchor.getAttribute('title'),
      ...Array.from(anchor.querySelectorAll('img')).map(n=>n.getAttribute('alt')),
      ...Array.from(anchor.querySelectorAll('svg[aria-label],svg title')).map(n=>n.getAttribute('aria-label') || text(n))].filter(Boolean).map(s=>String(s).replace(/\s+/g,' ').trim());
    return labels.some(label=>{
      if (/^(profile|프로필)$/i.test(label)) return true;
      const m = label.match(/^@?([A-Za-z0-9._]{1,30})(?:['’]s profile picture|님의\s*프로필\s*사진)$/i);
      return m && m[1].toLowerCase() === name;
    });
  };
  const inContent = anchor => !!anchor.closest?.('main,[role="main"],article,[role="dialog"]');
  const navigationContext = anchor => {
    // New desktop layouts use divs for the icon rail. Require independent Home and
    // another navigation destination, outside profile content, rather than a matching href alone.
    for (let parent=anchor.parentElement,depth=0;parent && parent!==document.body && depth<12;parent=parent.parentElement,depth++) {
      if (parent.matches('main,[role="main"],article,[role="dialog"]') || parent.querySelector('main,[role="main"],article')) return false;
      const paths = new Set();
      for (const a of parent.querySelectorAll('a[href]')) {
        if (!visible(a)) continue;
        try { const u = new URL(a.getAttribute('href'),location.origin); if (u.origin===current.origin) paths.add(u.pathname.replace(/\/$/,'') || '/'); } catch {}
      }
      if (paths.has('/') && ['/direct/inbox','/explore','/reels','/reels_tab'].some(path=>paths.has(path))) return true;
    }
    return false;
  };
  // The acting account must come from navigation, independently of target content.
  const identities = new Set();
  for (const a of document.querySelectorAll('nav a[href], aside a[href], [role="navigation"] a[href]')) {
    const name = profileName(a);
    if (visible(a) && !inContent(a) && name && profileLabel(a,name)) identities.add(name);
  }
  for (const a of document.querySelectorAll('a[href]')) {
    if (!visible(a) || inContent(a)) continue;
    const name = profileName(a);
    if (name && profileLabel(a,name) && navigationContext(a)) identities.add(name);
  }
  if (identities.size !== 1) return fail('account_unverified');
  if (![...identities].every(name=>name === expectedAccount)) return fail('account_mismatch');
  let headers = [...document.querySelectorAll('main header')].filter(h => visible(h) && [...h.querySelectorAll('h1,h2')].some(n=>visible(n) && text(n).toLowerCase() === target));
  if (!headers.length) {
    const mains = [...document.querySelectorAll('main,[role="main"]')].filter(visible);
    if (mains.length !== 1) return fail('ambiguous_profile');
    const main = mains[0], names = [...main.querySelectorAll('h1,h2,[role="heading"]')].filter(n=>visible(n) && text(n).toLowerCase() === target);
    if (names.length !== 1) return fail('ambiguous_profile');
    for (let parent=names[0].parentElement;parent && parent!==main;parent=parent.parentElement) {
      // Never widen into posts/recommendations to find an unrelated Follow button.
      const containsPost = [...parent.querySelectorAll('a[href]')].some(a => {
        try { const u = new URL(a.getAttribute('href'),location.origin); return u.origin === current.origin && /^\/(p|reel|reels)\/[^/]+/.test(u.pathname); } catch { return false; }
      });
      if (parent.querySelector('article') || containsPost) break;
      const links = [...parent.querySelectorAll('a[href]')].filter(visible).map(a=>{try { const u=new URL(a.getAttribute('href'),location.origin); return u.origin===current.origin ? u.pathname.replace(/\/$/,'') : ''; } catch { return ''; }});
      const hasControls = [...parent.querySelectorAll('button,[role="button"]')].some(n=>visible(n) && ['Follow','팔로우','Following','팔로잉','Requested','요청됨'].includes(text(n)));
      if (hasControls && links.includes(`/${target}/followers`) && links.includes(`/${target}/following`)) { headers=[parent]; break; }
    }
  }
  if (headers.length !== 1) return fail('ambiguous_profile');
  const header = headers[0];
  const hasTargetHeading = node => [...node.querySelectorAll('h1,h2,[role="heading"]')].some(n=>visible(n) && text(n).toLowerCase() === target);
  const isProfileAction = node => {
    for (let parent=node;parent && parent!==header;parent=parent.parentElement) {
      // Instagram can append suggested accounts inside the same semantic header
      // after a follow. Those controls belong to other accounts, not this target.
      if (parent.matches?.('article,ul,ol,li,[role="list"],[role="listitem"],[role="menu"],[role="menuitem"],[role="dialog"]')) return false;
      if (parent.matches?.('a[href]') && profileName(parent) && profileName(parent)!==target) return false;
      // The wider profile also contains biography and mutual-follow links. Stop
      // at its verified heading rather than treating those links as a card.
      if (parent!==node && hasTargetHeading(parent)) break;
      if ([...parent.querySelectorAll('a[href]')].some(a=>visible(a) && profileName(a) && profileName(a)!==target)) return false;
    }
    return true;
  };
  const controls = [...header.querySelectorAll('button,[role="button"]')].filter(n=>visible(n) && isProfileAction(n));
  const labels = ['Following','팔로잉','Requested','요청됨','Follow','팔로우'];
  const candidates = controls.filter(n=>labels.includes(text(n)));
  const contains = (outer,inner) => outer===inner || !!outer.contains?.(inner);
  const actions = [...new Set(candidates.map(node=>{
    // A native button and a same-label accessibility wrapper describe one
    // control. Only collapse that unambiguous nesting; separate buttons and
    // pure role-button chains must still fail closed.
    const nested = candidates.filter(other=>contains(node,other) || contains(other,node));
    const buttons = nested.filter(other=>other.tagName?.toUpperCase()==='BUTTON');
    if (buttons.length===1 && nested.every(other=>text(other)===text(node) && (contains(buttons[0],other) || contains(other,buttons[0])))) return buttons[0];
    return node;
  }))];
  const following = actions.filter(n=>['Following','팔로잉'].includes(text(n)));
  const requested = actions.filter(n=>['Requested','요청됨'].includes(text(n)));
  const follow = actions.filter(n=>['Follow','팔로우'].includes(text(n)));
  if (following.length + requested.length + follow.length !== 1) return fail(controls.length ? 'ambiguous_profile' : 'unsupported_language');
  if (following.length) return {ok:true,state:'following'};
  if (requested.length) return {ok:true,state:'requested'};
  const button = follow[0];
  if (button.disabled || button.getAttribute('aria-disabled') === 'true') return fail('ambiguous_profile');
  if (mode !== 'click') return {ok:true,state:'follow'};
  button.click();
  return {ok:true,state:'clicked'};
}
