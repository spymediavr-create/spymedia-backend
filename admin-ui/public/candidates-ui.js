const PLATFORMS={instagram:'Instagram',facebook:'Facebook',x:'X',blog:'네이버 블로그'};
const STATUSES={pending:'검토 중',excluded:'제외',done:'팔로우 완료 (수동 기록)'};
const FIELDS=['platform','accountName','profileUrl','industry','region','reason','note'];
const SEARCH_DOMAINS={instagram:'instagram.com',facebook:'facebook.com',x:'x.com',blog:'blog.naver.com'};
export function externalSearchUrl(platform,keyword,region=''){
  if(!Object.hasOwn(SEARCH_DOMAINS,platform)||typeof keyword!=='string'||typeof region!=='string'||keyword.length>200||region.length>100||!keyword.trim())return null;
  const url=new URL('https://www.google.com/search');
  url.searchParams.set('q',[keyword.trim(),region.trim(),'site:'+SEARCH_DOMAINS[platform]].filter(Boolean).join(' '));
  return url.href;
}
const ERRORS={invalid_candidate_input:'계정/기관·업체명과 입력 길이를 확인하세요.',invalid_candidate_url:'선택한 SNS의 HTTPS 프로필 주소를 입력하세요. 게시물·로그인·단축 주소는 사용할 수 없습니다.',duplicate_candidate:'같은 SNS의 프로필이 이미 등록되어 있습니다. 기존 후보를 수정하세요.',candidate_conflict:'다른 화면에서 변경된 후보입니다. 목록을 새로고침한 뒤 해당 후보의 수정 버튼으로 다시 여세요. 현재 입력 내용은 유지됩니다.',candidate_limit:'후보는 최대 2,000개까지 보관할 수 있습니다.',invalid_candidate_query:'필터 값을 확인하세요.',storage_unavailable:'기존 영구 저장소 연결을 확인하세요.',authentication_required:'로그인이 만료됐습니다. 입력 내용은 이 화면에 유지됩니다. 다시 로그인하세요.',csrf_rejected:'로그인 상태를 다시 확인하세요. 입력 내용은 이 화면에 유지됩니다.',not_found:'후보를 찾을 수 없습니다. 목록을 새로고침하세요.'};
const node=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
// Defense in depth: only render canonical links returned by the server.
function safeLink(platform,value){
  const patterns={instagram:/^https:\/\/www\.instagram\.com\/[a-z0-9_.]{1,30}\/$/,facebook:/^https:\/\/www\.facebook\.com\/(?:[a-z0-9.]{1,100}|profile\.php\?id=\d{1,30})$/,x:/^https:\/\/x\.com\/[a-z0-9_]{1,15}$/,blog:/^https:\/\/blog\.naver\.com\/[a-z0-9_-]{1,50}$/};
  return typeof value==='string'&&patterns[platform]?.test(value)?value:null;
}
export function attachCandidates(status){
  const $=id=>document.getElementById(id),root=$('sns-candidates');
  if(!root)return;
  let platform='instagram',filter={status:'all',industry:'',region:'',q:''},offset=0,page={items:[],total:0,selectedCount:0},busy=false,expired=false,loaded=false,editing=null;
  const available=!!status.authenticated&&!!status.storageReady;
  function searchLink(){
    const value=externalSearchUrl(platform,$('candidates-query').value,$('candidates-region').value),link=$('candidates-external');
    link.hidden=!value;$('candidates-external-empty').hidden=!!value;
    if(value)link.href=value;else link.removeAttribute('href');
  }
  function controls(){
    root.querySelectorAll('button,input,select,textarea').forEach(item=>{item.disabled=!available||busy||expired;});
    const selected=page.items.filter(item=>item.selected).length,all=$('candidates-all');
    all.disabled=!available||busy||expired||!page.items.length;if(!busy){all.checked=!!page.items.length&&selected===page.items.length;all.indeterminate=selected>0&&selected<page.items.length;}
    for(const key of ['exclude','done','pending'])$('candidates-'+key).disabled=!available||busy||expired||!selected;
    $('candidates-prev').disabled=!available||busy||expired||offset===0;
    $('candidates-next').disabled=!available||busy||expired||offset+25>=page.total;
    searchLink();
    $('candidates-selection').textContent='이 페이지 '+selected+'개 선택';
  }
  function expire(){expired=true;$('candidates-login').hidden=false;$('candidates-feedback').textContent=ERRORS.authentication_required;controls();}
  window.addEventListener('sns-auth-expired',expire);
  async function api(route,method='GET',body){
    let response,data;
    try{
      response=await fetch('/api/admin/candidates'+route,{method,cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':status.csrfToken},body:body===undefined?undefined:JSON.stringify(body)});
      data=await response.json();
    }catch{throw Error('서버 응답을 받지 못했습니다. 저장 여부를 새로고침으로 확인하세요. 입력 내용은 유지됩니다.');}
    if(response.status===401||response.status===403&&data.error==='csrf_rejected'){expire();window.dispatchEvent(new Event('sns-auth-expired'));}
    if(!response.ok)throw Error(ERRORS[data.error]||'요청을 처리하지 못했습니다. 새로고침 후 확인하세요.');
    return data;
  }
  function render(){
    root.querySelectorAll('[data-candidate-platform]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.candidatePlatform===platform)));
    $('candidates-count').textContent=PLATFORMS[platform]+' · 필터 결과 '+page.total+'개 · 저장된 선택 '+page.selectedCount+'개';
    $('candidates-range').textContent=page.total?`${offset+1}–${Math.min(offset+25,page.total)} / ${page.total}`:'0개';
    $('candidates-list').replaceChildren(...page.items.map(item=>{
      const card=node('article',undefined,'candidate-card');card.dataset.candidateId=item.id;card.dataset.status=item.status;
      const header=node('div',undefined,'candidate-card-header'),label=node('label',undefined,'candidate-check'),check=node('input');
      check.type='checkbox';check.checked=item.selected;check.setAttribute('aria-label',item.accountName+' 선택');check.dataset.candidateSelect=item.id;
      check.addEventListener('change',()=>mutate(()=>api('/'+item.id,'PATCH',{revision:item.revision,selected:check.checked}),'선택 상태를 저장했습니다.'));
      label.append(check);header.append(label,node('h3',item.accountName),node('span',STATUSES[item.status],'candidate-status-label'));card.append(header);
      card.append(node('p','업종: '+(item.industry||'미분류')+' · 지역: '+(item.region||'미입력')));
      const link=safeLink(item.platform,item.profileUrl);
      if(link){const a=node('a','프로필 새 창에서 열기 ↗ · '+link);a.href=link;a.target='_blank';a.rel='noopener noreferrer';card.append(a);}
      const detail=node('details'),summary=node('summary','추천 이유·메모 보기');
      detail.append(summary,node('p','추천 이유: '+(item.reason||'미입력')),node('p','메모: '+(item.note||'미입력')));
      if(item.manualDoneAt)detail.append(node('p','사용자 수동 완료 기록: '+new Date(item.manualDoneAt).toLocaleString('ko-KR')+' · 실제 SNS 상태 미검증'));
      card.append(detail);
      const actions=node('div',undefined,'candidate-actions'),stateLabel=node('label','처리 상태 ', 'candidate-hint'),select=node('select');select.setAttribute('aria-label',item.accountName+' 처리 상태');
      for(const [value,title]of Object.entries(STATUSES)){const option=node('option',title);option.value=value;select.append(option);}select.value=item.status;
      select.addEventListener('change',()=>mutate(()=>api('/'+item.id,'PATCH',{revision:item.revision,status:select.value}),'처리 상태를 저장했습니다. 실제 SNS 상태는 자동 확인하지 않습니다.'));
      stateLabel.append(select);const edit=node('button','정보·메모 수정','outline-button');edit.type='button';edit.addEventListener('click',()=>{
        if(editing&&editing.id!==item.id&&!window.confirm('편집 중인 내용을 버리고 이 후보를 수정할까요?'))return;
        editing={id:item.id,revision:item.revision};for(const key of FIELDS)$('candidate-'+key).value=item[key];
        $('candidate-editor-title').textContent='후보 정보·메모 수정';$('candidate-save').textContent='수정 내용 저장';$('candidate-editor').open=true;$('candidate-accountName').focus();
      });actions.append(stateLabel,edit);card.append(actions);return card;
    }));
    if(!page.items.length)$('candidates-list').append(node('p',loaded?'이 조건의 후보가 없습니다. 직접 조사한 계정·기관·업체를 추가하세요.':'후보 목록을 불러오기 전입니다.','candidate-empty'));
    controls();
  }
  async function load(){
    const query=new URLSearchParams({platform,...filter,offset:String(offset),limit:'25'});
    let next=await api('?'+query);
    if(offset>=next.total&&offset>0){offset=Math.max(0,Math.floor((next.total-1)/25)*25);query.set('offset',String(offset));next=await api('?'+query);}
    page=next;loaded=true;render();
  }
  async function refresh(){
    if(busy||expired||!available)return;busy=true;page={items:[],total:0,selectedCount:0};loaded=false;render();
    try{await load();$('candidates-feedback').textContent='후보 목록을 불러왔습니다. 체크·상태 변경은 관리자 기록만 바꿉니다.';}
    catch(e){$('candidates-feedback').textContent=e.message;}
    finally{busy=false;controls();}
  }
  async function mutate(task,message){
    if(busy||expired||!available)return;busy=true;controls();let saved=false;
    try{await task();saved=true;await load();$('candidates-feedback').textContent=message;}
    catch(e){if(saved){page={items:[],total:0,selectedCount:0};loaded=false;}$('candidates-feedback').textContent=(saved?'저장은 완료됐지만 목록을 갱신하지 못했습니다. ':'')+e.message;render();}
    finally{busy=false;controls();}
  }
  function clearEditor(){editing=null;$('candidate-form').reset();$('candidate-platform').value=platform;$('candidate-editor-title').textContent='후보 추가';$('candidate-save').textContent='후보 저장';$('candidate-editor').open=false;}
  $('candidate-form').addEventListener('submit',event=>{
    event.preventDefault();const body=Object.fromEntries(FIELDS.map(key=>[key,$('candidate-'+key).value]));
    mutate(async()=>{
      if(editing)await api('/'+editing.id,'PATCH',{...body,revision:editing.revision});else await api('','POST',body);
      platform=body.platform;offset=0;clearEditor();
    },'후보 정보를 저장했습니다.');
  });
  $('candidate-cancel').addEventListener('click',()=>{if(window.confirm('입력 중인 후보 정보를 지우고 편집을 닫을까요?'))clearEditor();});
  root.querySelectorAll('[data-candidate-platform]').forEach(button=>button.addEventListener('click',()=>{
    platform=button.dataset.candidatePlatform;offset=0;if(!editing)$('candidate-platform').value=platform;refresh();
  }));
  $('candidates-filter').addEventListener('submit',event=>{event.preventDefault();filter={status:$('candidates-status').value,industry:$('candidates-industry').value,region:$('candidates-region').value.trim(),q:$('candidates-query').value.trim()};offset=0;refresh();});
  $('candidates-all').addEventListener('change',()=>{const selected=$('candidates-all').checked;mutate(()=>api('/batch','POST',{items:page.items.map(({id,revision})=>({id,revision})),changes:{selected}}),'이 페이지의 선택 상태를 저장했습니다.');});
  for(const [key,state]of Object.entries({exclude:'excluded',done:'done',pending:'pending'}))$('candidates-'+key).addEventListener('click',()=>{
    const items=page.items.filter(item=>item.selected).map(({id,revision})=>({id,revision}));
    if(!items.length)return;
    if(state==='done'&&!window.confirm('선택한 '+items.length+'개 후보를 팔로우 완료 (수동 기록)로 표시할까요? SNS에서 직접 처리한 내용만 기록하세요. 실제 팔로우 여부는 자동 확인하지 않습니다.'))return;
    mutate(()=>api('/batch','POST',{items,changes:{status:state}}),'선택한 후보의 처리 상태를 저장했습니다. 실제 SNS 상태는 자동 확인하지 않습니다.');
  });
  for(const key of ['candidates-query','candidates-region'])$(key).addEventListener('input',searchLink);
  $('candidates-refresh').addEventListener('click',refresh);
  $('candidates-prev').addEventListener('click',()=>{offset=Math.max(0,offset-25);refresh();});
  $('candidates-next').addEventListener('click',()=>{offset+=25;refresh();});
  controls();
  if(available)refresh();else $('candidates-feedback').textContent=status.authenticated?'후보 관리에는 기존 영구 저장소 연결이 필요합니다.':'후보 저장·조회는 관리자 로그인 후 사용할 수 있습니다.';
}
