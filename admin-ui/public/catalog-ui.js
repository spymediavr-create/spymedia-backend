import {createRecordRow} from './record-ui.js';
import {formatBytes} from './domain.js';
const NAMES={youtube:'유튜브',instagram:'인스타그램',facebook:'페이스북',x:'X',blog:'블로그'};
const STATES={converting:'규격 변환 중',prepared:'전송 준비',queued:'전송 대기',publishing:'전송 확인 중',succeeded:'완료',failed:'실패',unknown:'채널에서 결과 확인 필요'};
const $=id=>document.getElementById(id);
const node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const date=value=>value?new Date(value).toLocaleString('ko-KR'):'기록 없음';
const X_REASONS=new Map([
  ['x_invalid_request',['invalid-request','요청 형식 오류']],
  ['x_resource_not_found',['resource-not-found','대상 없음']],
  ['x_not_authorized_for_resource',['not-authorized-for-resource','대상 접근 권한 없음']],
  ['x_client_forbidden',['client-forbidden','앱 API 접근 제한']],
  ['x_usage_capped',['usage-capped','사용량 한도 도달']],
  ['x_rate_limit_exceeded',['rate-limit-exceeded','요청 횟수 제한']],
  ['invalid_grant',['invalid_grant','기존 인증 승인 거절']],
  ['invalid_client',['invalid_client','앱 인증 거절']],
  ['unauthorized_client',['unauthorized_client','앱 인증 방식 거절']],
  ['invalid_scope',['invalid_scope','요청 권한 오류']],
  ['unsupported_grant_type',['unsupported_grant_type','지원하지 않는 인증 방식']],
  ['temporarily_unavailable',['temporarily_unavailable','인증 서비스 일시 이용 불가']]
]);
export function formatFailureDetails(details={}) {
  if(!details||typeof details!=='object'||Array.isArray(details))return '';
  const parts=[],phases={facebook_identity:'페이지 인증 확인',facebook_link_create:'링크 소개 요청',facebook_link_verify:'게시 결과 확인',x_identity:'X 계정 인증 확인',x_link_create:'X 링크 소개 요청',x_link_verify:'X 게시 결과 확인',x_token_refresh:'X 인증 갱신'};
  const xPhase=typeof details.phase==='string'&&details.phase.startsWith('x_');
  if(Object.hasOwn(phases,details.phase))parts.push('단계: '+phases[details.phase]);
  if(Number.isInteger(details.httpStatus)&&details.httpStatus>=100&&details.httpStatus<=599)parts.push('HTTP '+details.httpStatus);
  if(Number.isInteger(details.providerCode)&&details.providerCode>=0&&details.providerCode<=2147483647)parts.push((xPhase?'X code ':'Meta code ')+details.providerCode);
  if(Number.isInteger(details.providerSubcode)&&details.providerSubcode>=0)parts.push('subcode '+details.providerSubcode);
  if(xPhase&&Number.isInteger(details.httpStatus)&&details.httpStatus>=100&&details.httpStatus<=599){
    const reason=X_REASONS.get(details.providerType);
    parts.push(reason?'X 유형: '+reason[0]+' · 사유: '+reason[1]:'세부 원인: 알 수 없음 (안전한 오류 유형 없음)');
  }
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
  let kind='media',bin='active',offset=0,total=0,items=[],selected=new Set(),expanded=new Set(),loading=false,requestId=0;
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
      const title=kind==='media'?item.name||'파일명 기록 없음':item.title||'제목 없음';
      const check=node('input');check.type='checkbox';check.checked=selected.has(item.id);check.dataset.allowed=String(bin==='trash'||!!item.canTrash);
      check.addEventListener('change',()=>{check.checked?selected.add(item.id):selected.delete(item.id);updateControls();});
      return createRecordRow({id:item.id,title,createdAt:item.createdAt,channel:kind==='media'?(item.kind==='video'?'영상':'이미지'):NAMES[item.channel]||item.channel,status:kind==='media'?(bin==='trash'?'휴지통':item.canTrash?'보관 중':'사용 중'):item.channel==='blog'&&item.status==='prepared'?'원고 저장':STATES[item.status]||item.status,statusKey:kind==='media'?(bin==='trash'?'trash':item.canTrash?'stored':'protected'):item.status,check,className:'catalog-row',expanded:expanded.has(item.id),onToggle:open=>{open?expanded.add(item.id):expanded.delete(item.id);},fillDetails:panel=>{
        panel.append(node('h4',title));
        if(kind==='media') {
          panel.append(node('p',(item.kind==='video'?'영상':'이미지')+' · '+formatBytes(item.size||0)+' · 보관 '+date(item.createdAt)+' · 관련 작업 '+item.relatedJobs+'개'));
          const a=node('a','원본 다운로드');a.href=item.download;a.download='';panel.append(a);
        } else {
          const media=describeJobMedia(item);panel.append(node('p','채널: '+NAMES[item.channel]+' · '+(item.channel==='blog'&&item.status==='prepared'?'원고 저장':STATES[item.status]||item.status)),node('p',item.caption||''),node('p','미디어: '+media.label),node('p',media.filenames.join(' · ')),jobDiagnostics(item));
          if(item.legacyReadOnly)panel.append(node('p','기존 미디어 작업 · 이력 조회만 지원합니다.'));
          for(const asset of item.assets||[]){const media=node(asset.kind==='video'?'video':'img');media.src=asset.preview;if(asset.kind==='video'){media.controls=true;media.preload='metadata';}else media.alt=title;panel.append(media);}
          if(item.mediaInTrash)panel.append(node('p','원본 파일이 휴지통에 있습니다. 복원 후 작업을 준비할 수 있습니다.'));
          if(item.result?.url)try{const url=new URL(item.result.url);if(url.protocol==='https:'&&/^(www\.)?(youtube\.com|instagram\.com|facebook\.com|x\.com)$/.test(url.hostname)){const a=node('a','채널에서 확인');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';panel.append(a);}}catch{}
        }
        if(item.trashedAt)panel.append(node('small','휴지통 이동 '+date(item.trashedAt)));
        if(bin==='active'&&!item.canTrash)panel.append(node('p','진행 중이거나 게시 결과 확인이 필요한 작업과 연결되어 이동할 수 없습니다.'));
      }});
    }));
    if(!items.length){const empty=node('p',bin==='trash'?'휴지통이 비어 있습니다.':'보관된 항목이 없습니다.');empty.className='record-empty';$('catalog-items').append(empty);}
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
    offset=0;items=[];total=0;selected.clear();expanded.clear();render();refresh();
  });
  $('catalog-refresh').addEventListener('click',refresh);
  $('catalog-prev').addEventListener('click',()=>{offset=Math.max(0,offset-limit);selected.clear();expanded.clear();refresh();});
  $('catalog-next').addEventListener('click',()=>{offset+=limit;selected.clear();expanded.clear();refresh();});
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
