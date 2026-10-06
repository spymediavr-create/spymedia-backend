import {formatBytes} from './domain.js';
const NAMES={youtube:'유튜브',instagram:'인스타그램',facebook:'페이스북',x:'X',blog:'블로그'};
const STATES={converting:'규격 변환 중',prepared:'전송 준비',queued:'전송 대기',publishing:'전송 확인 중',succeeded:'완료',failed:'실패',unknown:'채널에서 결과 확인 필요'};
const $=id=>document.getElementById(id);
const node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const date=value=>value?new Date(value).toLocaleString('ko-KR'):'기록 없음';
export function formatFailureDetails(details={}) {
  const parts=[],phases={facebook_identity:'페이지 인증 확인',facebook_link_create:'링크 소개 요청',facebook_link_verify:'게시 결과 확인'};
  if(phases[details.phase])parts.push('단계: '+phases[details.phase]);
  if(Number.isInteger(details.httpStatus)&&details.httpStatus>=100&&details.httpStatus<=599)parts.push('HTTP '+details.httpStatus);
  if(Number.isInteger(details.providerCode)&&details.providerCode>=0)parts.push('Meta code '+details.providerCode);
  if(Number.isInteger(details.providerSubcode)&&details.providerSubcode>=0)parts.push('subcode '+details.providerSubcode);
  return parts.join(' · ');
}
export function jobDiagnostics(job) {
  const n=node('p');n.className='job-diagnostics';
  const code=typeof job.error==='string'&&/^[a-z0-9_]{1,80}$/.test(job.error)?job.error:null;
  n.textContent=(code?'오류 코드: '+code+' · ':'')+'준비된 파일 '+(job.assets||[]).length+'개 · 생성 '+date(job.createdAt)+' · 수정 '+date(job.updatedAt);
  const details=formatFailureDetails(job.errorDetails||{});if(details)n.textContent+=' · '+details;
  return n;
}
export function attachCatalogUI({api,isBusy,setBusy,refreshJobs,describeJobMedia}) {
  if(!$('content-library'))return {updateControls(){},refresh:async()=>{}};
  $('content-library').hidden=false;
  let kind='media',bin='active',offset=0,total=0,items=[],selected=new Set(),loading=false,requestId=0;
  const limit=20;
  function updateControls() {
    const disabled=isBusy()||loading;
    $('catalog-change').disabled=disabled||!selected.size;
    $('catalog-refresh').disabled=disabled;
    $('catalog-prev').disabled=disabled||offset===0;
    $('catalog-next').disabled=disabled||offset+limit>=total;
    for(const input of $('catalog-items').querySelectorAll('input'))input.disabled=disabled||input.dataset.allowed!=='true';
    for(const button of document.querySelectorAll('[data-catalog-kind],[data-catalog-bin]'))button.disabled=disabled;
  }
  function render() {
    selected=new Set([...selected].filter(id=>items.some(item=>item.id===id&&(bin==='trash'||item.canTrash))));
    for(const button of document.querySelectorAll('[data-catalog-kind]'))button.setAttribute('aria-pressed',String(button.dataset.catalogKind===kind));
    for(const button of document.querySelectorAll('[data-catalog-bin]'))button.setAttribute('aria-pressed',String(button.dataset.catalogBin===bin));
    $('catalog-change').textContent=bin==='trash'?'선택 항목 복원':'선택 항목 휴지통으로';
    $('catalog-range').textContent=total?(offset+1)+'–'+Math.min(offset+items.length,total)+' / '+total+'개':'0개';
    $('catalog-items').replaceChildren(...items.map(item=>{
      const row=node('article');row.className='catalog-row';row.dataset.id=item.id;
      const heading=node('label');const check=node('input');check.type='checkbox';check.checked=selected.has(item.id);check.dataset.allowed=String(bin==='trash'||!!item.canTrash);
      check.setAttribute('aria-label',(item.name||item.title||'파일명 기록 없음')+' 선택');
      check.addEventListener('change',()=>{check.checked?selected.add(item.id):selected.delete(item.id);updateControls();});
      heading.append(check,node('strong',kind==='media'?item.name||'파일명 기록 없음':NAMES[item.channel]+' · '+(STATES[item.status]||item.status)+' · '+item.title));row.append(heading);
      if(kind==='media') {
        row.append(node('p',(item.kind==='video'?'영상':'이미지')+' · '+formatBytes(item.size||0)+' · 보관 '+date(item.createdAt)+' · 관련 작업 '+item.relatedJobs+'개'));
        const a=node('a','원본 다운로드');a.href=item.download;a.download='';row.append(a);
      } else {
        const media=describeJobMedia(item);row.append(node('p','미디어: '+media.label),node('p',media.filenames.join(' · ')),jobDiagnostics(item));
        if(item.mediaInTrash)row.append(node('p','원본 파일이 휴지통에 있습니다. 복원 후 작업을 준비할 수 있습니다.'));
        if(item.result?.url)try{const url=new URL(item.result.url);if(url.protocol==='https:'&&/^(www\.)?(youtube\.com|instagram\.com|facebook\.com|x\.com)$/.test(url.hostname)){const a=node('a','채널에서 확인');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';row.append(a);}}catch{}
      }
      if(item.trashedAt)row.append(node('small','휴지통 이동 '+date(item.trashedAt)));
      if(bin==='active'&&!item.canTrash)row.append(node('p','진행 중이거나 게시 결과 확인이 필요한 작업과 연결되어 이동할 수 없습니다.'));
      return row;
    }));
    if(!items.length)$('catalog-items').append(node('p',bin==='trash'?'휴지통이 비어 있습니다.':'보관된 항목이 없습니다.'));
    updateControls();
  }
  async function refresh() {
    const current=++requestId;loading=true;updateControls();
    try {
      let data=await api('catalog?kind='+kind+'&bin='+bin+'&offset='+offset+'&limit='+limit);
      if(current!==requestId)return;
      if(data.total&&offset>=data.total){offset=Math.floor((data.total-1)/limit)*limit;return await refresh();}
      items=data.items;total=data.total;
      $('catalog-feedback').textContent='';render();
    } catch(e){if(current===requestId)$('catalog-feedback').textContent=e.message;}
    finally{if(current===requestId){loading=false;updateControls();}}
  }
  for(const button of document.querySelectorAll('[data-catalog-kind],[data-catalog-bin]'))button.addEventListener('click',()=>{
    if(isBusy()||loading)return;
    if(button.dataset.catalogKind)kind=button.dataset.catalogKind;
    if(button.dataset.catalogBin)bin=button.dataset.catalogBin;
    offset=0;items=[];total=0;selected.clear();render();refresh();
  });
  $('catalog-refresh').addEventListener('click',refresh);
  $('catalog-prev').addEventListener('click',()=>{offset=Math.max(0,offset-limit);selected.clear();refresh();});
  $('catalog-next').addEventListener('click',()=>{offset+=limit;selected.clear();refresh();});
  $('catalog-change').addEventListener('click',async()=>{
    if(isBusy()||loading||!selected.size)return;
    const restore=bin==='trash',ids=[...selected];
    if(!restore&&!window.confirm('선택한 '+ids.length+'개 항목을 서버 목록의 휴지통으로 이동합니다.\n원본 파일과 게시 이력은 보존되며 복원할 수 있습니다.\nSNS에 게시된 콘텐츠는 삭제되지 않습니다.\n\n이동할까요?'))return;
    setBusy(true);
    try {
      await api('catalog/'+(restore?'restore':'trash'),'POST',{kind,ids});
      selected.clear();await refresh();await refreshJobs();
      $('catalog-feedback').textContent=restore?'복원했습니다. 자동 전송은 실행되지 않습니다.':'휴지통으로 이동했습니다. SNS 게시물과 파일은 보존됩니다.';
    }catch(e){$('catalog-feedback').textContent=e.message;}
    finally{setBusy(false);updateControls();}
  });
  render();refresh();
  return {updateControls,refresh};
}
