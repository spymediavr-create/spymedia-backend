// Serialized by chrome.scripting.executeScript. No private API, remote scripts or hidden state.
// Deliberately narrow DOM contract: unsupported or changed Instagram markup stops the job.
export function inspectInstagramPage({expectedAccount, targetUrl, mode = 'inspect'}) {
  const fail = code => ({ok:false, code});
  const text = node => String(node?.innerText ?? node?.textContent ?? '').replace(/\s+/g,' ').trim();
  const visible = node => !!node && !node.hidden && node.getAttribute('aria-hidden') !== 'true' && node.getClientRects().length > 0;
  const current = new URL(location.href);
  if (current.origin !== 'https://www.instagram.com') return fail('wrong_profile');
  if (/^\/accounts\/(login|signup)/.test(current.pathname)) return fail('login_required');
  if (/^\/(challenge|checkpoint)/.test(current.pathname)) return fail('challenge');
  const body = text(document.body);
  if (/(try again later|we restrict certain activity|action blocked|confirm it.s you|suspicious login|잠시 후 다시 시도|나중에 다시 시도|일부 활동을 제한|활동이 차단|본인 확인|의심스러운 로그인)/i.test(body)) return fail('challenge');
  if (document.querySelector('input[name="username"], input[name="password"]')) return fail('login_required');
  if (current.href !== targetUrl) return fail('wrong_profile');
  const target = current.pathname.split('/')[1];
  // A sidebar/navigation Profile link identifies the acting account independently of target header.
  const identities = new Set();
  for (const a of document.querySelectorAll('nav a[href], aside a[href], [role="navigation"] a[href]')) {
    if (!visible(a)) continue;
    const label = [text(a), a.getAttribute('aria-label'), ...Array.from(a.querySelectorAll('img')).map(img=>img.getAttribute('alt'))].filter(Boolean);
    if (!label.some(s => /^(profile|프로필)$/i.test(s))) continue;
    try { const u = new URL(a.getAttribute('href'),location.origin), m = u.pathname.match(/^\/([A-Za-z0-9._]{1,30})\/?$/); if (u.origin === current.origin && m) identities.add(m[1].toLowerCase()); } catch {}
  }
  if (identities.size !== 1) return fail('account_unverified');
  if (![...identities].every(name=>name === expectedAccount)) return fail('account_mismatch');
  const headers = [...document.querySelectorAll('main header')].filter(h => visible(h) && [...h.querySelectorAll('h1,h2')].some(n=>visible(n) && text(n).toLowerCase() === target));
  if (headers.length !== 1) return fail('ambiguous_profile');
  const controls = [...headers[0].querySelectorAll('button,[role="button"]')].filter(visible);
  const following = controls.filter(n=>['Following','팔로잉'].includes(text(n)));
  const requested = controls.filter(n=>['Requested','요청됨'].includes(text(n)));
  const follow = controls.filter(n=>['Follow','팔로우'].includes(text(n)));
  if (following.length + requested.length + follow.length !== 1) return fail(controls.length ? 'ambiguous_profile' : 'unsupported_language');
  if (following.length) return {ok:true,state:'following'};
  if (requested.length) return {ok:true,state:'requested'};
  const button = follow[0];
  if (button.disabled || button.getAttribute('aria-disabled') === 'true') return fail('ambiguous_profile');
  if (mode !== 'click') return {ok:true,state:'follow'};
  button.click();
  return {ok:true,state:'clicked'};
}
