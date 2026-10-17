// Serialized into one explicitly selected Naver frame. No page scripts,
// credentials, private endpoints or hidden application state are accessed.
export function resolveNaverContent({targetUrl}){
  const fail=code=>({ok:false,code});
  let target,current;try{target=new URL(targetUrl);current=new URL(location.href);}catch{return fail('wrong_profile');}
  if(target.origin!=='https://blog.naver.com'||target.search||target.hash||target.username||target.password||!/^\/[a-z0-9_-]{1,50}$/.test(target.pathname)||current.origin!==target.origin)return fail('wrong_profile');
  const allowed=new Set(['/PostList.naver','/PostView.naver','/prologue/PrologueList.naver']);
  const matches=u=>u.origin===target.origin&&!u.username&&!u.password&&allowed.has(u.pathname)&&u.searchParams.getAll('blogId').length===1&&u.searchParams.get('blogId')===target.pathname.slice(1);
  if(matches(current))return {ok:true,url:current.href};
  if(current.pathname!==target.pathname&&current.pathname!==target.pathname+'/')return fail('wrong_profile');
  const frames=document.querySelectorAll('iframe#mainFrame');if(frames.length!==1)return fail('ambiguous_profile');
  let src;try{src=new URL(frames[0].getAttribute('src'),current);}catch{return fail('wrong_profile');}
  return matches(src)?{ok:true,url:src.href}:fail('wrong_profile');
}

export function inspectNaverPage({expectedAccount,expectedName,targetUrl,mode='inspect',actorLabel}){
  const fail=code=>({ok:false,code});
  const origin='https://blog.naver.com';
  const text=node=>String(node?.innerText??node?.textContent??'').replace(/\s+/g,' ').trim();
  const visible=node=>{
    if(!node||!node.getClientRects().length)return false;
    for(let p=node;p&&p!==document;p=p.parentElement){
      if(p.hidden||p.getAttribute('aria-hidden')==='true'||p.hasAttribute('inert'))return false;
      const style=getComputedStyle(p);if(style.display==='none'||style.visibility==='hidden')return false;
    }return true;
  };
  const url=value=>{try{const u=new URL(value,origin);return !u.username&&!u.password?u:null;}catch{return null;}};
  const current=url(location.href),target=url(targetUrl);
  if(expectedAccount!=='spymedia'||expectedName!=='spymedia')return fail('account_mismatch');
  if(!current||current.origin!==origin)return fail('wrong_profile');
  if(!target||target.origin!==origin||target.search||target.hash||!/^\/[a-z0-9_-]{1,50}$/.test(target.pathname))return fail('wrong_profile');
  const targetId=target.pathname.slice(1);
  if([...document.querySelectorAll('input[type="password"],a[href*="nid.naver.com/nidlogin"]')].some(n=>visible(n)&&(n.matches('input')||text(n)==='로그인')))return fail('login_required');
  const notices=[...document.querySelectorAll('[role="alert"],[role="dialog"],[role="alertdialog"]')].filter(visible);
  if(notices.some(n=>/보안|인증|제한|잠시 후|자동.*입력/.test(text(n))))return fail('challenge');
  if(notices.length)return fail('ambiguous_dialog');
  if(!['actor','inspect','open'].includes(mode))return fail('invalid_message');
  // The outer wrapper and advertisement frames are never action surfaces.
  const permittedPaths=new Set(['/PostList.naver','/PostView.naver','/prologue/PrologueList.naver']);
  if(!permittedPaths.has(current.pathname)||current.searchParams.getAll('blogId').length!==1||current.searchParams.get('blogId')!==targetId)return fail('wrong_profile');
  const profiles=[...document.querySelectorAll('#blog-profile')].filter(visible);
  if(profiles.length!==1)return fail('ambiguous_profile');
  const profile=profiles[0],links=[...profile.querySelectorAll('a[href]')].filter(visible);
  const profileIds=links.filter(a=>{const u=url(a.href);return text(a)==='프로필'&&u?.origin===origin&&u.pathname==='/profile/intro.naver'&&u.searchParams.getAll('blogId').length===1&&u.searchParams.get('blogId')===targetId;});
  if(profileIds.length!==1)return fail('ambiguous_profile');
  const globalActor=document.querySelector('#gnb_my'),label=visible(globalActor)?text(globalActor):'';
  if(!label||label.length>100)return fail('account_unverified');
  if(mode==='actor'){
    if(targetId!==expectedAccount)return fail('account_mismatch');
    const menu=document.querySelector('#myMenuLink');
    const write=links.filter(a=>text(a)==='글쓰기'&&a.href===origin+'/'+expectedAccount+'/postwrite');
    const manage=links.filter(a=>text(a)==='관리'&&a.href==='https://admin.blog.naver.com/'+expectedAccount);
    if(!visible(menu)||text(menu)!=='내 메뉴'||write.length!==1||manage.length!==1)return fail('account_unverified');
    return {ok:true,state:'actor_verified',actorId:expectedAccount,actorLabel:label};
  }
  if(targetId===expectedAccount)return fail('wrong_profile');
  // The label supplements the owner-only controls checked immediately before
  // this navigation. A target author's name is never an actor credential.
  if(typeof actorLabel!=='string'||!actorLabel||label!==actorLabel)return fail('account_mismatch');
  const controls=links.filter(a=>a.classList.contains('_addBuddyPop')&&a.getAttribute('target')==='_blank');
  if(controls.length!==1)return fail('ambiguous_profile');
  const control=controls[0],controlText=text(control),nameNode=profile.querySelector('#nickNameArea');
  const targetName=visible(nameNode)?text(nameNode):'';
  if(control.classList.contains('btn_nb')&&controlText==='이웃')return {ok:true,state:'existing',targetId,targetName};
  if(!control.classList.contains('btn_add_nb')||controlText!=='이웃추가')return fail('ambiguous_profile');
  if(mode==='open'){
    if(control.getAttribute('aria-disabled')==='true'||control.hasAttribute('disabled'))return fail('ambiguous_profile');
    control.click();return {ok:true,state:'opened',targetId,targetName};
  }
  return {ok:true,state:'add',targetId,targetName};
}

// Runs only in the specific BuddyAdd popup opened from the reviewed profile.
// The worker binds that popup by opener, initial blogId and ordered stages.
export function inspectNaverDialog({targetUrl,targetName,stage,mode='inspect',groupName='광고'}){
  const fail=code=>({ok:false,code});
  const text=node=>String(node?.innerText??node?.textContent??'').replace(/\s+/g,' ').trim();
  const visible=node=>{
    if(!node||!node.getClientRects().length)return false;
    for(let p=node;p&&p!==document;p=p.parentElement){
      if(p.hidden||p.getAttribute('aria-hidden')==='true'||p.hasAttribute('inert'))return false;
      const style=getComputedStyle(p);if(style.display==='none'||style.visibility==='hidden')return false;
    }return true;
  };
  const enabled=node=>visible(node)&&!node.disabled&&node.getAttribute('aria-disabled')!=='true';
  let target,current;try{target=new URL(targetUrl);current=new URL(location.href);}catch{return fail('wrong_profile');}
  if(target.origin!=='https://blog.naver.com'||target.username||target.password||target.search||target.hash||!/^\/[a-z0-9_-]{1,50}$/.test(target.pathname)||target.pathname==='/spymedia')return fail('wrong_profile');
  if(current.origin!==target.origin||current.username||current.password||current.hash||current.pathname!=='/BuddyAdd.naver')return fail('ambiguous_dialog');
  const ids=current.searchParams.getAll('blogId');
  if(ids.length>1||ids.length===1&&ids[0]!==target.pathname.slice(1)||stage==='choice'&&ids.length!==1)return fail('wrong_profile');
  if(typeof targetName!=='string'||!targetName.trim()||targetName.length>200||targetName!==targetName.replace(/\s+/g,' ').trim()||groupName!=='광고')return fail('wrong_profile');
  if(!['choice','group','result'].includes(stage)||!['inspect','next','select','submit'].includes(mode))return fail('invalid_message');
  const body=text(document.body),headings=[...document.querySelectorAll('h1,h2,[role="heading"]')].filter(n=>visible(n)&&text(n)==='이웃추가');
  if([...document.querySelectorAll('input[type="password"],a[href*="nid.naver.com/nidlogin"]')].some(visible))return fail('login_required');
  if(/보안[ ]?(?:확인|인증)|본인[ ]?인증|자동[ ]?입력|이용[ ]?제한|잠시[ ]?후|하루.{0,20}(?:초과|제한)|captcha/i.test(body))return fail('challenge');
  if(headings.length!==1||[...document.querySelectorAll('textarea,iframe,[role="alertdialog"],[role="dialog"],[role="alert"]')].some(visible))return fail('ambiguous_dialog');
  const compact=value=>value.replace(/\s+/g,'');
  const has=phrase=>compact(body).includes(compact(phrase));
  const controls=[...document.querySelectorAll('button,a,input[type="button"],input[type="submit"],[role="button"]')].filter(visible);
  const label=node=>node.matches('input')?String(node.value||'').trim():text(node);
  const nexts=controls.filter(n=>label(n)==='다음');
  const next=nexts.length===1&&enabled(nexts[0])?nexts[0]:null;
  const radios=[...document.querySelectorAll('input[type="radio"]')].filter(visible);
  const selects=[...document.querySelectorAll('select')].filter(visible);
  if(stage==='result'){
    if(mode!=='inspect'||radios.length||selects.length||nexts.length||compact(body).split('님의블로그를이웃으로추가하였습니다.').length!==2||!has(targetName+'님의 블로그를 이웃으로 추가하였습니다.'))return fail('uncertain');
    const closes=controls.filter(n=>label(n)==='닫기');
    return closes.length===1&&enabled(closes[0])?{ok:true,state:'added'}:fail('uncertain');
  }
  if(!next)return fail('ambiguous_dialog');
  if(stage==='choice'){
    if(selects.length||radios.length!==2||!has(targetName+'님을')||!has('서로이웃으로 추가합니다.'))return fail('ambiguous_dialog');
    const radioLabel=r=>{
      const labels=[...(r.labels||[])].filter(visible).map(text);
      if(labels.length===1)return labels[0];
      return String(r.getAttribute('aria-label')||'').trim();
    };
    const ordinary=radios.filter(r=>radioLabel(r)==='이웃'),mutual=radios.filter(r=>radioLabel(r)==='서로이웃');
    if(ordinary.length!==1||mutual.length!==1||!enabled(ordinary[0]))return fail('mutual_only');
    if(mode==='inspect')return {ok:true,state:'choice'};
    if(mode!=='next')return fail('invalid_message');
    if(!ordinary[0].checked)ordinary[0].click();
    if(!ordinary[0].checked||mutual[0].checked)return fail('mutual_only');
    next.click();return {ok:true,state:'advanced'};
  }
  if(radios.length||selects.length!==1||!has(targetName+'님을 추가할 그룹을 선택해주세요.'))return fail('ambiguous_dialog');
  const select=selects[0];if(!enabled(select)||select.multiple)return fail('group_ambiguous');
  const matches=[...select.options].filter(o=>text(o)===groupName);
  if(!matches.length)return fail('group_missing');
  if(matches.length!==1||matches[0].disabled||matches[0].parentElement?.disabled)return fail('group_ambiguous');
  const option=matches[0];
  if(mode==='inspect')return {ok:true,state:'group'};
  if(mode==='select'){
    select.selectedIndex=option.index;select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));
    return select.selectedOptions.length===1&&select.selectedOptions[0]===option?{ok:true,state:'selected'}:fail('group_ambiguous');
  }
  if(mode!=='submit')return fail('invalid_message');
  if(select.selectedOptions.length!==1||select.selectedOptions[0]!==option)return fail('group_ambiguous');
  next.click();return {ok:true,state:'submitted'};
}
