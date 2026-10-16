import {REGION_OPTIONS} from './candidate-regions.js';
import {candidatePageNumbers} from './candidate-pagination.js';
import {searchResultUrl} from './search-result-url.js';
import {attachFollowActions} from './follow-actions.js';
import {attachFollowExclusions} from './follow-exclusions.js';
import {attachFacebookFollowExclusions} from './facebook-follow-exclusions.js';
const DISPLAY_SIZE=10,LIFETIME=15*60*1000;
const ERRORS={invalid_temporary_search:'검색 키워드를 짧게 입력하고 SNS·지역·검색 페이지를 확인하세요.',temporary_search_unconfigured:'Brave 검색 API가 설정되지 않았거나 검색이 비활성 상태입니다. 기존 외부 검색 열기나 직접 후보 추가를 사용하세요.',temporary_search_access:'검색 서비스 인증 또는 접근 권한을 확인해야 합니다. 관리자에게 문의하세요.',temporary_search_quota:'검색 서비스의 사용량·결제 설정을 확인해야 합니다.',temporary_search_provider_limit:'검색 제공자의 요청 제한에 도달했습니다. 잠시 후 직접 다시 시도하세요.',temporary_search_rate_limited:'검색 요청이 너무 빠르거나 분당 요청 한도에 도달했습니다. 잠시 후 직접 다시 시도하세요.',temporary_search_timeout:'검색 응답 시간이 초과됐습니다. 자동 재시도하지 않습니다.',temporary_search_failed:'검색 서비스 요청을 완료하지 못했습니다. 자동 재시도하지 않습니다.',temporary_search_invalid_response:'검색 서비스 응답을 안전하게 표시하지 못했습니다.',authentication_required:'관리자 로그인이 만료됐습니다. 임시 검색 결과를 지웠습니다.',csrf_rejected:'로그인 상태를 다시 확인하세요. 임시 검색 결과를 지웠습니다.'};
const node=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
export function attachTemporarySearch(status){
  const $=id=>document.getElementById(id),root=$('sns-temporary-search');if(!root)return;
  attachFollowExclusions({mount:root,status});
  attachFacebookFollowExclusions({mount:root,status});
  $('temporary-search-regions').replaceChildren(...REGION_OPTIONS.map(value=>{const option=node('option');option.value=value;return option;}));
  const ready=!!status.authenticated&&!!status.temporarySearch?.ready;
  // These collections are page memory only. Never put them in persistent storage or a URL.
  let pages=[],current=0,chosen=new Set(),seen=new Set(),query=null,providerPage=-1,hasMore=false,busy=false,expired=false,requestVersion=0,controller,lifetimeTimer,cooldownTimer,cooldownUntil=0,expiresAt=0,excludedTotal=0;
  const follow=attachFollowActions({mount:$('temporary-search-results'),prefix:'temporary-search',status,getSelection:()=>({platform:query?.platform||$('temporary-search-platform').value,profiles:[...chosen],expiresAt,disabled:!ready||busy||expired})});
  const feedback=message=>{$('temporary-search-feedback').textContent=message;};
  function controls(){
    const blocked=!ready||busy||expired||Date.now()<cooldownUntil;
    $('temporary-search-fields').disabled=blocked;
    $('temporary-search-clear').disabled=!busy&&!pages.length;
    const items=pages[current]||[],selected=items.filter(item=>chosen.has(item.url)).length,all=$('temporary-search-all');
    all.disabled=!ready||busy||expired||!items.length;all.checked=!!items.length&&selected===items.length;all.indeterminate=selected>0&&selected<items.length;
    $('temporary-search-selected').textContent=chosen.size+'개 임시 선택';
    $('temporary-search-prev').disabled=blocked||current===0;
    $('temporary-search-next').disabled=blocked||!pages.length||current===pages.length-1&&!hasMore;
    $('temporary-search-next').textContent=current<pages.length-1?'다음 임시 페이지':'다음 결과 묶음 조회';
    root.querySelectorAll('[data-search-page]').forEach(button=>{button.disabled=blocked||Number(button.dataset.searchPage)===current;});
    root.querySelectorAll('[data-search-select]').forEach(check=>{check.disabled=!ready||busy||expired;});
    follow.update();
  }
  function render(){
    const items=pages[current]||[];
    const exclusionLabel=query?.platform==='instagram'?'팔로잉·요청 계정':query?.platform==='facebook'?'팔로잉 계정':'';
    $('temporary-search-range').textContent=pages.length?`${current+1}페이지 · ${items.length}개 표시 · 현재 탭 ${pages.reduce((n,page)=>n+page.length,0)}개 임시 보관${exclusionLabel?` · ${exclusionLabel} ${excludedTotal}개 제외`:''} · 전체 검색 건수 미제공`:'임시 결과 없음';
    $('temporary-search-results').replaceChildren(...items.map(item=>{
      const card=node('article',undefined,'search-result');card.dataset.kind=item.kind;
      const header=node('div',undefined,'search-result-header'),label=node('label',undefined,'temporary-search-check'),check=node('input');check.type='checkbox';check.dataset.searchSelect='';check.checked=chosen.has(item.url);check.setAttribute('aria-label',item.title+' 임시 선택');
      check.addEventListener('change',()=>{check.checked?chosen.add(item.url):chosen.delete(item.url);controls();});label.append(check);header.append(label,node('h3',item.title));card.append(header);
      card.append(node('p',(item.kind==='profile'?'프로필 주소 · URL 형식 판별':'게시물 주소 · 프로필이 아님')+' · 지역 미검증','search-result-type'),node('p',item.snippet));
      const target=searchResultUrl(query.platform,item.url);
      if(target){const link=node('a',(item.kind==='profile'?'프로필 열기 ↗':'원문 게시물 열기 ↗')+' · '+target.url);link.href=target.url;link.target='_blank';link.rel='noopener noreferrer';card.append(link);}
      return card;
    }));
    if(!items.length)$('temporary-search-results').append(node('p',pages.length?(excludedTotal?`${exclusionLabel}을 제외한 뒤 이 검색 페이지에 표시할 결과가 없습니다. 검색 조건을 바꾸거나 다음 결과 묶음을 직접 확인하세요.`:'이 검색 페이지에 안전하게 표시할 결과가 없습니다. 검색 조건을 바꾸거나 다음 결과 묶음을 직접 확인하세요.'):'검색 전입니다. 결과는 영구 저장되지 않습니다.','search-empty'));
    $('temporary-search-pages').replaceChildren(...candidatePageNumbers(current+1,pages.length).map(number=>{
      if(number==='…')return node('span','…');const button=node('button',String(number));button.type='button';button.dataset.searchPage=String(number-1);button.setAttribute('aria-label','임시 '+number+'페이지');if(number-1===current)button.setAttribute('aria-current','page');button.addEventListener('click',()=>{current=number-1;render();});return button;
    }));controls();
  }
  function clear(message){follow.clear();requestVersion++;controller?.abort();clearTimeout(lifetimeTimer);expiresAt=0;pages=[];chosen.clear();seen.clear();query=null;providerPage=-1;hasMore=false;current=0;busy=false;excludedTotal=0;render();if(message)feedback(message);}
  function expire(){expired=true;clear(ERRORS.authentication_required);$('temporary-search-login').hidden=false;}
  window.addEventListener('sns-auth-expired',expire);
  window.addEventListener('pagehide',()=>{clear('페이지를 떠나 임시 결과와 선택을 지웠습니다.');clearInterval(cooldownTimer);$('temporary-search-form').reset();});
  async function fetchBatch(next){
    if(!ready||busy||expired||Date.now()<cooldownUntil)return;
    const version=++requestVersion;controller=new AbortController();const activeController=controller;busy=true;controls();feedback('공개 웹 검색 중…');
    const timeout=setTimeout(()=>activeController.abort(),10000);
    try{
      const response=await fetch('/api/admin/temporary-search',{method:'POST',cache:'no-store',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':status.csrfToken},body:JSON.stringify({...query,page:next}),signal:activeController.signal});
      let data;try{data=await response.json();}catch{throw Error(ERRORS.temporary_search_invalid_response);}
      if(version!==requestVersion)return;
      if(response.status===401||response.status===403&&data?.error==='csrf_rejected'){expire();window.dispatchEvent(new Event('sns-auth-expired'));return;}
      if(!response.ok){
        if(response.status===429){const seconds=Math.min(60,Math.max(1,Number(response.headers.get('Retry-After'))||2));cooldownUntil=Date.now()+seconds*1000;clearInterval(cooldownTimer);cooldownTimer=setInterval(()=>{controls();if(Date.now()>=cooldownUntil)clearInterval(cooldownTimer);},1000);}
        throw Error(ERRORS[data?.error]||ERRORS.temporary_search_failed);
      }
      if(!Array.isArray(data?.items)||data.items.length>20||typeof data.hasMore!=='boolean'||data.page!==next||data.excludedCount!==undefined&&(!Number.isInteger(data.excludedCount)||data.excludedCount<0||data.excludedCount>20))throw Error(ERRORS.temporary_search_invalid_response);
      const exclusionLabel=query.platform==='instagram'?'팔로잉·요청 계정':query.platform==='facebook'?'팔로잉 계정':'';
      const excludedCount=exclusionLabel?(data.excludedCount||0):0;excludedTotal+=excludedCount;
      const items=[];
      for(const item of data.items){const safe=searchResultUrl(query.platform,item?.url);if(!safe||safe.kind!==item.kind||seen.has(safe.url))continue;seen.add(safe.url);items.push({...safe,title:typeof item.title==='string'?item.title.slice(0,200):safe.url,snippet:typeof item.snippet==='string'?item.snippet.slice(0,600):''});}
      const first=pages.length;for(let i=0;i<items.length;i+=DISPLAY_SIZE)pages.push(items.slice(i,i+DISPLAY_SIZE));if(!items.length)pages.push([]);
      current=first;providerPage=next;hasMore=data.hasMore&&next<9;
      if(next===0){expiresAt=Date.now()+LIFETIME;lifetimeTimer=setTimeout(()=>clear('임시 열람 시간이 지나 결과와 선택을 지웠습니다. 필요하면 다시 검색하세요.'),LIFETIME);}
      render();feedback(`이번 조회에서 ${items.length}개를 임시 표시합니다.`+(exclusionLabel?` ${exclusionLabel} ${excludedCount}개 제외.`:'')+' 중복·지원하지 않는 주소는 생략하며 계정·지역은 미검증입니다.'+(next===9?' 제공자가 허용한 마지막 결과 묶음입니다.':'')+(!hasMore&&next!==9?(data.paginationKnown===false?' 다음 페이지 정보가 없어 추가 조회를 중지했습니다.':' 제공자가 추가 페이지를 안내하지 않았습니다.'):''));
    }catch(e){if(version===requestVersion)feedback(e.name==='AbortError'?ERRORS.temporary_search_timeout:e.message||ERRORS.temporary_search_failed);}
    finally{clearTimeout(timeout);if(version===requestVersion){busy=false;controls();}}
  }
  $('temporary-search-form').addEventListener('submit',event=>{event.preventDefault();if(busy||!ready||expired)return;const next={platform:$('temporary-search-platform').value,keyword:$('temporary-search-keyword').value.trim(),region:$('temporary-search-region').value.trim()};if(!next.keyword)return;clear();query=next;fetchBatch(0);});
  $('temporary-search-platform').addEventListener('change',()=>{if(query&&query.platform!==$('temporary-search-platform').value)clear('SNS를 변경해 이전 선택과 작업 준비를 지웠습니다.');controls();});
  $('temporary-search-clear').addEventListener('click',()=>clear('임시 결과와 선택을 지웠습니다. 저장 후보는 유지됩니다.'));
  $('temporary-search-all').addEventListener('change',()=>{const selected=$('temporary-search-all').checked;for(const item of pages[current]||[])selected?chosen.add(item.url):chosen.delete(item.url);render();});
  $('temporary-search-prev').addEventListener('click',()=>{if(current>0){current--;render();}});
  $('temporary-search-next').addEventListener('click',()=>{if(current<pages.length-1){current++;render();}else if(hasMore)fetchBatch(providerPage+1);});
  render();feedback(!status.authenticated?'임시 검색은 관리자 로그인 후 사용할 수 있습니다.':!ready?ERRORS.temporary_search_unconfigured:'검색 설정이 준비됐습니다. 실제 연결은 아직 확인하지 않았습니다. 키워드·지역·SNS를 선택하고 직접 검색하세요.');
}
