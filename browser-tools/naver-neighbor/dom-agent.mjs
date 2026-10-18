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
export function inspectNaverDialog({targetUrl,targetName,stage,mode='inspect',groupName='광고업체'}){
  const fail=code=>({ok:false,code});
  const text=node=>String(node?.innerText??node?.textContent??'').replace(/\s+/g,' ').trim();
  const visible=(node,headingOnly=false)=>{
    if(!node||!node.getClientRects().length)return false;
    for(let p=node;p&&p!==document;p=p.parentElement){
      // Naver's observed popup title is rendered but aria-hidden to avoid
      // repeating its fieldset legend. This exception never permits actions.
      const duplicatedTitle=headingOnly===true&&p===node&&p.matches('.popup_heading > h1.title[aria-hidden="true"]');
      if(p.hidden||p.getAttribute('aria-hidden')==='true'&&!duplicatedTitle||p.hasAttribute('inert'))return false;
      const style=getComputedStyle(p);if(style.display==='none'||style.visibility==='hidden')return false;
    }return true;
  };
  const enabled=node=>visible(node)&&!node.disabled&&!node.hasAttribute('disabled')&&node.getAttribute('aria-disabled')!=='true';
  const visibleText=node=>{
    const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT),parts=[];
    for(let child=walker.nextNode();child;child=walker.nextNode())if(visible(child.parentElement))parts.push(child.textContent);
    return parts.join('').replace(/\s+/g,' ').trim();
  };
  // Match a complete rendered statement and its exact name, not a suffix
  // anywhere in body text. aria-hidden decoys do not establish a target.
  const statements=pattern=>{
    const matches=[document.body,...document.body.querySelectorAll('*')].filter(visible).map(node=>({node,match:visibleText(node).match(pattern)})).filter(item=>item.match);
    return matches.filter(item=>!matches.some(other=>other!==item&&item.node.contains(other.node)));
  };
  let target,current;try{target=new URL(targetUrl);current=new URL(location.href);}catch{return fail('wrong_profile');}
  if(target.origin!=='https://blog.naver.com'||target.username||target.password||target.search||target.hash||!/^\/[a-z0-9_-]{1,50}$/.test(target.pathname)||target.pathname==='/spymedia')return fail('wrong_profile');
  if(current.origin!==target.origin||current.username||current.password||current.hash||current.pathname!=='/BuddyAdd.naver')return fail('ambiguous_dialog');
  const ids=current.searchParams.getAll('blogId');
  if(ids.length>1||ids.length===1&&ids[0]!==target.pathname.slice(1)||stage==='choice'&&ids.length!==1)return fail('wrong_profile');
  if(typeof targetName!=='string'||!targetName.trim()||targetName.length>200||targetName!==targetName.replace(/\s+/g,' ').trim()||groupName!=='광고업체')return fail('wrong_profile');
  if(!['choice','group','result'].includes(stage)||!['inspect','next','expand','select','submit'].includes(mode))return fail('invalid_message');
  const body=text(document.body),headings=[...document.querySelectorAll('h1,h2,[role="heading"]')].filter(n=>visible(n,true)&&text(n)==='이웃추가');
  if([...document.querySelectorAll('input[type="password"],a[href*="nid.naver.com/nidlogin"]')].some(visible))return fail('login_required');
  if(/보안[ ]?(?:확인|인증)|본인[ ]?인증|자동[ ]?입력|이용[ ]?제한|잠시[ ]?후|하루.{0,20}(?:초과|제한)|captcha/i.test(body))return fail('challenge');
  if(headings.length!==1||[...document.querySelectorAll('textarea,iframe,[role="alertdialog"],[role="dialog"],[role="alert"]')].some(visible))return fail('ambiguous_dialog');
  const controls=[...document.querySelectorAll('button,a,input[type="button"],input[type="submit"],[role="button"]')].filter(visible);
  const label=node=>node.matches('input')?String(node.value||'').trim():text(node);
  const nexts=controls.filter(n=>label(n)==='다음');
  const next=nexts.length===1&&enabled(nexts[0])?nexts[0]:null;
  const radios=[...document.querySelectorAll('input[type="radio"]')].filter(visible);
  const selects=[...document.querySelectorAll('select')].filter(visible);
  const dropdowns=[...document.querySelectorAll('.area_dropdown[data-set="popup_buddy_group"]')].filter(visible);
  if(stage==='result'){
    const completed=statements(/^(.*?)님의\s*블로그를\s*이웃으로\s*추가하였습니다\.$/);
    if(mode!=='inspect'||radios.length||selects.length||dropdowns.length||nexts.length||completed.length!==1||completed[0].match[1].trim()!==targetName)return fail('uncertain');
    const closes=controls.filter(n=>label(n)==='닫기');
    return closes.length===1&&enabled(closes[0])?{ok:true,state:'added'}:fail('uncertain');
  }
  if(!next)return fail('ambiguous_dialog');
  if(stage==='choice'){
    const readChoice=()=>{
      // Naver renders clipped native radios through visible labels. Source
      // indentation also separates the mutual label from the suffix span.
      const choices=statements(/^(.*?)님을\s*이웃\s*서로이웃\s*으로\s*(추가|신청)합니다\.$/);
      const currentRadios=[...document.querySelectorAll('input[type="radio"]')].filter(visible);
      if(choices.length!==1||choices[0].match[1].trim()!==targetName||currentRadios.length!==2)return null;
      const statement=choices[0].node;
      const pairs=currentRadios.map(r=>({radio:r,labels:[...(r.labels||[])].filter(visible)}));
      if(pairs.some(p=>p.labels.length!==1||!statement.contains(p.radio)||!statement.contains(p.labels[0])))return null;
      const ordinary=pairs.filter(p=>text(p.labels[0])==='이웃'),mutual=pairs.filter(p=>text(p.labels[0])==='서로이웃');
      if(ordinary.length!==1||mutual.length!==1||!enabled(ordinary[0].radio)||ordinary[0].radio.classList.contains('disabled')||!enabled(ordinary[0].labels[0]))return null;
      if(statement.matches('p.text_buddy_add')){
        const names=[...statement.querySelectorAll(':scope > strong.name_buddy')].filter(visible);
        if(names.length!==1||visibleText(names[0])!==targetName)return null;
      }
      return {ordinary:ordinary[0].radio,mutual:mutual[0].radio,label:ordinary[0].labels[0],action:choices[0].match[2]};
    };
    if(selects.length||dropdowns.length||radios.length!==2)return fail('ambiguous_dialog');
    const choice=readChoice();if(!choice)return fail('ambiguous_dialog');
    if(mode==='inspect')return {ok:true,state:'choice'};
    if(mode!=='next')return fail('invalid_message');
    if(!choice.ordinary.checked)choice.label.click();
    const checked=readChoice();
    if(!checked||checked.ordinary!==choice.ordinary||checked.mutual!==choice.mutual||!checked.ordinary.checked||checked.mutual.checked||checked.action!=='추가')return fail('mutual_only');
    const currentNexts=[...document.querySelectorAll('button,a,input[type="button"],input[type="submit"],[role="button"]')].filter(n=>visible(n)&&label(n)==='다음');
    if(currentNexts.length!==1||currentNexts[0]!==next||!enabled(next))return fail('ambiguous_dialog');
    next.click();return {ok:true,state:'advanced'};
  }
  const groups=statements(/^(.*?)님을\s*추가할\s*그룹을\s*선택해주세요\.$/);
  if(radios.length||groups.length!==1||groups[0].match[1].trim()!==targetName)return fail('ambiguous_dialog');
  if([...document.querySelectorAll('.group_name._newGroup')].some(visible))return fail('group_ambiguous');
  if(dropdowns.length){
    if(dropdowns.length!==1||selects.length)return fail('group_ambiguous');
    const dropdown=dropdowns[0];
    const statement=groups[0].node,buddyState=dropdown.closest('.buddy_state');
    const targetNames=[...statement.querySelectorAll(':scope > strong.name_buddy')].filter(visible);
    if(!statement.matches('p.text_buddy_add')||!visible(buddyState)||!buddyState.contains(statement)||targetNames.length!==1||visibleText(targetNames[0])!==targetName)return fail('wrong_profile');
    const triggers=[...dropdown.querySelectorAll(':scope > a.present_selected._selectedGroup')].filter(visible);
    const menus=[...dropdown.querySelectorAll(':scope > div.dropdown_select._groupList')];
    if(triggers.length!==1||menus.length!==1)return fail('group_ambiguous');
    const trigger=triggers[0],menu=menus[0];
    const names=[...trigger.querySelectorAll(':scope > strong._selectedGroupName')].filter(visible);
    if(!enabled(trigger)||trigger.getAttribute('href')!=='#'||trigger.getAttribute('role')!=='button'||trigger.getAttribute('aria-haspopup')!=='true'||names.length!==1||!text(names[0]))return fail('group_ambiguous');
    const expandedAttribute=trigger.getAttribute('aria-expanded'),hiddenAttribute=menu.getAttribute('aria-hidden');
    if(!['true','false'].includes(expandedAttribute)||!['true','false'].includes(hiddenAttribute))return fail('group_ambiguous');
    const expanded=expandedAttribute==='true'&&hiddenAttribute==='false'&&visible(menu);
    const collapsed=expandedAttribute==='false'&&hiddenAttribute==='true'&&!visible(menu);
    const selected=collapsed&&text(names[0])===groupName;
    let option;
    if(expanded){
      // Read labels only after the user-visible dropdown has opened. Hidden
      // form fields and the page's groupId/groupName attributes are not used.
      const options=[...menu.querySelectorAll('a.item._selectGroup')].filter(visible);
      if(!options.length||options.some(n=>n.getAttribute('href')!=='#'||!['true','false'].includes(n.getAttribute('aria-selected'))))return fail('group_ambiguous');
      const chosen=options.filter(n=>n.getAttribute('aria-selected')==='true');
      if(chosen.length!==1||text(chosen[0])!==text(names[0]))return fail('group_ambiguous');
      const matches=options.filter(n=>text(n)===groupName);
      if(!matches.length)return fail('group_missing');
      if(matches.length!==1||!enabled(matches[0]))return fail('group_ambiguous');
      option=matches[0];
    }
    if(mode==='inspect')return {ok:true,state:'group',kind:'custom',expanded,selected};
    if(mode==='expand'){
      if(expanded)return {ok:true,state:'expanded'};
      if(!collapsed)return fail('group_ambiguous');
      trigger.click();return {ok:true,state:'expanded'};
    }
    if(mode==='select'){
      if(!expanded||!option)return fail('group_ambiguous');
      option.click();return {ok:true,state:'selected'};
    }
    if(mode!=='submit')return fail('invalid_message');
    if(!selected)return fail('group_ambiguous');
    next.click();return {ok:true,state:'submitted'};
  }
  if(selects.length!==1)return fail('ambiguous_dialog');
  const select=selects[0];if(!enabled(select)||select.multiple)return fail('group_ambiguous');
  const matches=[...select.options].filter(o=>text(o)===groupName);
  if(!matches.length)return fail('group_missing');
  if(matches.length!==1||matches[0].disabled||matches[0].parentElement?.disabled)return fail('group_ambiguous');
  const option=matches[0];
  if(mode==='inspect')return {ok:true,state:'group',kind:'native',selected:select.selectedOptions.length===1&&select.selectedOptions[0]===option};
  if(mode==='select'){
    select.selectedIndex=option.index;select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));
    return select.selectedOptions.length===1&&select.selectedOptions[0]===option?{ok:true,state:'selected'}:fail('group_ambiguous');
  }
  if(mode!=='submit')return fail('invalid_message');
  if(select.selectedOptions.length!==1||select.selectedOptions[0]!==option)return fail('group_ambiguous');
  next.click();return {ok:true,state:'submitted'};
}
