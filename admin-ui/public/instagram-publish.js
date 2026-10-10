import {composeCaption,parseTags} from './domain.js';
import {createRecordRow} from './record-ui.js';
const $=id=>document.getElementById(id),make=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
export function attachInstagramPhoto(initialStatus=null,getDraft=null){
const state={status:initialStatus,verified:false,quotaBlocked:false,busy:false,file:null,photoUrl:null,jobs:[],selected:null,cooldown:0,expanded:new Set(),expired:false};
const previewImage=make('img');previewImage.alt='선택한 사진 미리보기';previewImage.hidden=true;$('ig-placeholder')?.append(previewImage);
let poll,cooldownTimer,jobsVersion=0;
const ready=()=>state.status?.authenticated===true&&state.status.mode!=='preview'&&!state.expired;
const messages={instagram_publish_limit:'Instagram 게시 한도를 모두 사용했습니다. 시간이 지난 뒤 계정·게시 권한을 다시 확인하세요.',upload_busy:'다른 파일을 저장 중입니다. 잠시 후 다시 시도하세요.',authentication_required:'로그인이 만료됐습니다. 입력한 문구와 사진을 보관하고 다시 로그인하세요.',instagram_not_configured:'Instagram 인증 설정이 필요합니다. 기존 앱의 연결 상태를 확인해 주세요.',channel_not_configured:'Instagram 전송 설정이 준비되지 않았습니다.',account_mismatch:'연결 계정이 spymedia_kr와 다릅니다. 전송을 중단했습니다.',channel_auth_or_permission:'Instagram 인증 또는 권한이 거절됐습니다. 기존 앱의 로그인과 게시 권한을 확인해 주세요.',instagram_check_rate_limited:'계정 확인은 1분에 한 번 가능합니다.',channel_rate_limit:'Instagram 요청 한도에 도달했습니다. 잠시 뒤 다시 확인하세요.',instagram_photo_only:'JPEG 사진 1장만 준비할 수 있습니다.',instagram_photo_dimensions:'사진 규격이 맞지 않습니다. 가로 320–1,440px, 비율 4:5–1.91:1의 JPEG로 다시 내보내세요.',instagram_content_limits:'제목·설명·해시태그 합계를 2,200자 이하로 줄여 주세요.',invalid_draft:'제목과 설명, 해시태그를 확인해 주세요.',photo_too_large:'사진은 최대 8MB입니다.',invalid_photo_dimensions:'읽을 수 있는 JPEG 사진을 선택해 주세요.',media_in_trash:'사진이 휴지통에 있습니다. 보관함에서 복원해 주세요.',job_in_trash:'같은 준비 항목이 휴지통에 있습니다. 보관함에서 복원해 주세요.',job_not_ready:'전송 가능한 준비 항목을 다시 선택해 주세요.',check_channel_before_retry:'Instagram에서 게시 여부를 먼저 확인해 주세요. 자동 재전송은 중단됐습니다.',channel_media_processing:'Instagram에서 사진 처리를 완료하지 못했습니다.',channel_media_processing_timeout:'Instagram 사진 처리가 지연됐습니다.',channel_network_failure:'Instagram 응답을 확인하지 못했습니다.',verify_publication:'게시 결과를 확인하지 못했습니다. Instagram에서 먼저 확인해 주세요.',storage_unavailable:'사진 저장 공간 설정이 필요합니다.',storage_full:'사진 저장 공간이 부족합니다.',publishing_disabled:'관리자 전송 설정이 꺼져 있습니다.',csrf_rejected:'보안 확인에 실패했습니다. 화면을 새로고침해 주세요.'};
const phases={instagram_identity:'계정 확인',instagram_permissions:'게시 권한 확인',instagram_photo_create:'사진 등록',instagram_photo_prepare:'사진 처리',instagram_photo_publish:'최종 전송',instagram_photo_verify:'게시 결과 확인'};
function comparison(value){const c=value?.identityComparison;return value?.phase==='instagram_identity'&&c&&typeof c.usernameMatches==='boolean'&&typeof c.idMatches==='boolean'?c:null;}
function detail(value){
  if(!value)return '';const c=comparison(value),parts=[phases[value.phase],Number.isInteger(value.httpStatus)?'HTTP '+value.httpStatus:null,Number.isInteger(value.providerCode)?'오류 '+value.providerCode:null,Number.isInteger(value.providerSubcode)?'세부 오류 '+value.providerSubcode:null];
  if(c){
    parts.push('계정명 '+(c.usernameMatches?'일치':'불일치'),'계정 번호 '+(c.idMatches?'일치':'불일치'));
    if(c.userIdPresent===false)parts.push('API user_id 미반환');
    else if(c.userIdPresent===true){parts.push('API user_id 반환됨');if(typeof c.userIdMatchesConfigured==='boolean')parts.push('user_id와 기존 번호 '+(c.userIdMatchesConfigured?'일치':'불일치'));if(typeof c.idMatchesUserId==='boolean')parts.push('id와 user_id '+(c.idMatchesUserId?'일치':'불일치'));}
  }
  return parts.filter(Boolean).join(' · ');
}
function failure(e){
  let text=messages[e.code]||'요청을 완료하지 못했습니다. 설정과 저장된 항목을 확인해 주세요.';const c=comparison(e.details);
  if(e.code==='account_mismatch'&&c){
    if(c.usernameMatches&&!c.idMatches)text='계정명은 spymedia_kr와 일치하지만 계정 번호가 기존 설정과 다릅니다. 전송을 중단했습니다.';
    else if(!c.usernameMatches&&c.idMatches)text='계정명이 spymedia_kr와 다릅니다. 계정 번호는 기존 설정과 일치합니다. 전송을 중단했습니다.';
    else if(!c.usernameMatches&&!c.idMatches)text='계정명과 계정 번호가 모두 기존 설정과 다릅니다. 전송을 중단했습니다.';
  }
  if(e.code==='invalid_channel_response'&&e.details?.phase==='instagram_permissions')text='Instagram 게시 권한 응답을 확인하지 못했습니다. 계정·게시 권한 확인을 다시 실행해 주세요.';
  return text+(detail(e.details)?' ('+detail(e.details)+')':'');
}
function feedback(text,success=false){$('ig-publish-feedback').textContent=text;$('ig-publish-feedback').classList.toggle('success-feedback',success);}
function expire(){state.expired=true;state.verified=false;state.quotaBlocked=false;state.selected=null;$('ig-connection').textContent='로그인이 만료됐습니다. 입력한 문구와 선택한 사진은 유지됩니다. 다시 로그인하세요.';controls();}
window.addEventListener('sns-auth-expired',expire);
window.addEventListener('sns-instagram-checking',event=>{state.verified=false;state.quotaBlocked=false;state.cooldown=event.detail.cooldown;clearTimeout(cooldownTimer);cooldownTimer=setTimeout(controls,60100);$('ig-connection').textContent='계정과 게시 권한을 확인하고 있습니다.';controls();});
window.addEventListener('sns-instagram-connection',event=>{
  const c=event.detail,identity=c?.identityVerified===true&&c.username==='spymedia_kr',permissions=identity&&c.publishingPermissionsVerified===true,q=c?.publishingQuota;
  state.quotaBlocked=permissions&&c.publishingQuotaAvailable===false;state.verified=permissions&&!state.quotaBlocked;
  const quota=permissions&&Number.isSafeInteger(q?.used)&&q.used>=0&&Number.isSafeInteger(q?.total)&&q.total>0?' · 게시 한도 '+q.used.toLocaleString('ko-KR')+' / '+q.total.toLocaleString('ko-KR')+' 사용':'';
  $('ig-connection').textContent=permissions?'spymedia_kr 계정 확인됨 · 게시 권한 확인됨'+quota+(state.quotaBlocked?' · 게시 한도를 모두 사용해 현재 전송할 수 없습니다. 시간이 지난 뒤 다시 확인하세요.':' · 실제 게시 결과는 전송 후 확인합니다.'):identity?'spymedia_kr 계정 확인됨 · 게시 권한을 확인하지 못해 전송을 중단했습니다.':'지정한 계정을 확인하지 못했습니다.';controls();
});
window.addEventListener('sns-instagram-check-failed',event=>{state.verified=false;state.quotaBlocked=false;$('ig-connection').textContent=event.detail;controls();});
async function api(route,{method='GET',body,headers={}}={}){
  const response=await fetch(route,{method,credentials:'same-origin',headers:{...(method!=='GET'?{'X-CSRF-Token':state.status?.csrfToken}:{}),...headers},...(body!==undefined?{body}: {})});
  const data=await response.json();
  if(!response.ok){if(response.status===401||response.status===403&&data.error==='csrf_rejected'){expire();window.dispatchEvent(new Event('sns-auth-expired'));}throw {code:data.error,details:data.details,retryAfter:Number(response.headers.get('retry-after'))||0};}
  return data;
}
const post=(route,body)=>api(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
function draft(){const input=getDraft?.();return input?{title:String(input.title||'').trim(),description:String(input.description||'').trim(),tags:[...(input.tags||[])]}:{title:$('ig-title').value.trim(),description:$('ig-description').value.trim(),tags:parseTags($('ig-tags').value)};}
function controls(){
  const s=state.status,c=s?.instagramConnection,authenticated=ready(),job=state.jobs.find(j=>j.id===state.selected),photo=document.querySelector('[name=ig-kind]:checked').value==='photo',input=draft();
  if(getDraft){const text=composeCaption(input.title,input.description,input.tags);$('ig-caption').textContent=text||'위 콘텐츠 정보에 제목과 설명을 입력하세요.';$('ig-length').textContent=text.length.toLocaleString('ko-KR')+' / 2,200자'+(text.length>2200?' · 문구를 줄여 주세요.':'');$('ig-saved-note').textContent=job&&job.caption!==text?'현재 입력과 선택한 저장 작업의 문구가 다릅니다. 편집 내용을 사용하려면 새 사진 작업을 준비하세요.':'';}
  const showPhoto=photo&&!!state.photoUrl;previewImage.hidden=!showPhoto;$('ig-placeholder')?.classList.toggle('ig-native-preview',showPhoto);if(showPhoto)previewImage.src=state.photoUrl;else previewImage.removeAttribute('src');
  $('ig-check').disabled=!authenticated||!c?.credentialsConfigured||state.busy||Date.now()<state.cooldown;
  $('ig-photo').disabled=state.busy;
  $('ig-prepare').disabled=!authenticated||!s.storageReady||state.busy||!photo||!state.file||!input.title||!input.description||composeCaption(input.title,input.description,input.tags).length>2200;
  $('ig-refresh').disabled=!authenticated||state.busy;
  $('ig-send').disabled=!authenticated||!s.storageReady||state.busy||!state.verified||!s.publishingEnabled||!c?.publishingEnabled||!c?.mediaDeliveryConfigured||!s.channels?.instagram?.configured||!job?.canSend;
  for(const check of $('ig-jobs').querySelectorAll('input'))check.disabled=state.busy||!authenticated||!state.jobs.find(j=>j.id===check.dataset.jobId)?.canSend;
  $('ig-send-note').textContent=!authenticated?'로그인 후 사진 전송을 이용할 수 있습니다.':!c?.credentialsConfigured?'기존 Instagram 앱의 인증 설정이 필요합니다.':!c.mediaDeliveryConfigured?'사진 전달 설정이 필요합니다.':!c.publishingEnabled||!s.publishingEnabled?'Instagram 전송 설정이 꺼져 있습니다.':state.quotaBlocked?'Instagram 게시 한도를 모두 사용했습니다. 시간이 지난 뒤 계정·게시 권한을 다시 확인하세요.':!state.verified?'계정·게시 권한 확인을 먼저 실행해 주세요.':!job?.canSend?'전송 가능한 준비 항목 1개를 선택하세요.':'전송 전에 선택한 사진과 저장된 문구를 다시 확인합니다.';
}
async function busy(fn){if(state.busy||!ready())return;state.busy=true;controls();try{await fn();}catch(e){feedback(failure(e));}finally{state.busy=false;controls();}}
function renderJobs(){
  if(!state.jobs.some(j=>j.id===state.selected&&j.canSend))state.selected=null;
  const container=$('ig-jobs');container.replaceChildren();
  for(const job of state.jobs){
    const check=make('input');check.type='radio';check.name='ig-prepared-job';check.dataset.jobId=job.id;check.checked=job.id===state.selected;check.disabled=!job.canSend||state.busy;check.addEventListener('change',()=>{state.selected=job.id;controls();});
    const labels={prepared:'준비 완료',queued:'대기 중',publishing:'전송 중',succeeded:'완료',failed:'실패',unknown:'확인 필요'};
    const row=createRecordRow({id:job.id,title:job.title,createdAt:job.createdAt,channel:'인스타그램',status:labels[job.status]||'확인 필요',statusKey:job.status,check,className:'ig-job-card',expanded:state.expanded.has(job.id),onToggle:open=>{if(open)state.expanded.add(job.id);else state.expanded.delete(job.id);},fillDetails:details=>{
      details.append(make('p',job.caption));
      if(job.sourceMedia[0]?.name)details.append(make('small',job.sourceMedia[0].name));
      const asset=job.assets[0];if(asset&&/^\/api\/admin\/media\/[a-f0-9-]{36}\?(preview|converted)=1$/.test(asset.preview)){const image=make('img');image.src=asset.preview;image.alt='저장된 사진 미리보기';details.append(image);}
      if(job.error){details.append(make('p',failure({code:job.error,details:job.errorDetails})));}
      if(job.status==='unknown')details.append(make('p','Instagram에서 게시 여부를 확인해 주세요. 이 항목은 재전송하지 않습니다.'));
      if(job.canRetry){const retry=make('button','다시 준비');retry.type='button';retry.className='outline-button';retry.addEventListener('click',()=>busy(async()=>{await post('/api/admin/jobs/retry',{id:job.id});await refresh();feedback('다시 준비했습니다. 전송은 별도로 확인해 실행해 주세요.',true);}));details.append(retry);}
      try{const u=new URL(job.result?.url);if(u.protocol==='https:'&&['instagram.com','www.instagram.com'].includes(u.hostname)&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&/^\/(p|reel)\/[a-zA-Z0-9_-]+\/$/.test(u.pathname)){const link=make('a','게시 결과 확인 ↗');link.href=u.href;link.target='_blank';link.rel='noopener noreferrer';details.append(link);}}catch{}
    }});container.append(row);
  }
  if(!state.jobs.length){const empty=make('p','준비한 사진이 없습니다. 사진과 문구를 입력한 뒤 준비해 주세요.');empty.className='record-empty';container.append(empty);}controls();
}
async function refresh(){if(!ready())return;const version=jobsVersion,data=await api('/api/admin/jobs');if(version!==jobsVersion)return;state.jobs=data.jobs.filter(j=>j.type==='instagram-photo'&&j.channel==='instagram');renderJobs();}
$('ig-check').addEventListener('click',()=>busy(async()=>{
  state.verified=false;state.cooldown=Date.now()+60000;clearTimeout(cooldownTimer);cooldownTimer=setTimeout(controls,60100);
  window.dispatchEvent(new CustomEvent('sns-instagram-checking',{detail:{cooldown:state.cooldown}}));
  try{const data=await post('/api/admin/instagram/check',{});window.dispatchEvent(new CustomEvent('sns-instagram-connection',{detail:data.connection}));}
  catch(e){window.dispatchEvent(new CustomEvent('sns-instagram-check-failed',{detail:failure(e)}));throw e;}
}));
$('ig-photo').addEventListener('change',()=>{
  state.file=null;if(state.photoUrl)URL.revokeObjectURL(state.photoUrl);state.photoUrl=null;$('ig-photo-preview').hidden=true;
  const file=$('ig-photo').files[0];$('ig-photo-info').textContent='';
  if(file){if(file.type!=='image/jpeg'||file.size<=0||file.size>8*1024**2){feedback('최대 8MB의 JPEG 사진 1장을 선택해 주세요.');$('ig-photo').value='';}else{state.file=file;state.photoUrl=URL.createObjectURL(file);$('ig-photo-preview').src=state.photoUrl;$('ig-photo-preview').hidden=false;$('ig-photo-info').textContent=file.name+' · '+(file.size/1024).toFixed(1)+'KB';document.querySelector('[name=ig-kind][value=photo]').checked=true;document.querySelector('[name=ig-kind][value=photo]').dispatchEvent(new Event('change'));feedback('사진을 선택했습니다. 문구를 확인한 뒤 준비해 주세요.',true);}}controls();
});
$('ig-prepare').addEventListener('click',()=>{if($('ig-prepare').disabled)return;busy(async()=>{
  const file=state.file,input=draft();feedback('사진 규격을 검사하고 원본과 문구를 저장하고 있습니다.');
  const data=await api('/api/admin/media',{method:'POST',headers:{'Content-Type':'image/jpeg','X-Upload-Name':encodeURIComponent(file.name)},body:file});
  const prepared=await post('/api/admin/jobs',{type:'instagram-photo',channels:['instagram'],mediaIds:[data.media.id],...input});
  jobsVersion++;state.jobs=[...prepared.jobs,...state.jobs.filter(j=>!prepared.jobs.some(saved=>saved.id===j.id))];state.selected=prepared.jobs[0].id;state.expanded.add(state.selected);renderJobs();await refresh();feedback('사진과 문구를 저장했습니다. 선택한 준비 항목을 확인한 뒤 전송하세요.',true);
});});
$('ig-send').addEventListener('click',()=>{
  const job=state.jobs.find(j=>j.id===state.selected);if($('ig-send').disabled||!job)return;
  const asset=job.assets[0],file=job.sourceMedia[0]?.name||'저장된 JPEG 사진';
  if(!confirm('spymedia_kr에 아래 사진과 저장된 문구를 공개 게시합니다.\n\n사진: '+file+' · '+asset.width+' × '+asset.height+'px\n\n'+job.caption+'\n\n전송하시겠습니까?'))return;
  busy(async()=>{state.selected=null;await post('/api/admin/jobs/start',{ids:[job.id]});await refresh();feedback('전송을 요청했습니다. 아래 목록에서 결과를 확인하세요.',true);});
});
$('ig-refresh').addEventListener('click',()=>busy(refresh));
for(const id of ['ig-title','ig-description','ig-tags'])$(id)?.addEventListener('input',controls);
for(const radio of document.querySelectorAll('[name=ig-kind]'))radio.addEventListener('change',controls);
$('ig-recommend')?.addEventListener('click',controls);
window.addEventListener('pagehide',()=>{clearInterval(poll);clearTimeout(cooldownTimer);if(state.photoUrl)URL.revokeObjectURL(state.photoUrl);});
async function initialize(){try{
  state.status=initialStatus||await api('/api/admin/status');
  const c=state.status.instagramConnection;
  $('ig-connection').textContent=state.status.authenticated?(c?.credentialsConfigured?'기존 인증 설정 있음 · 계정 미확인':'기존 Instagram 인증 설정이 필요합니다.'):'미리보기 화면입니다. 로그인 후 사진 전송을 이용할 수 있습니다.';
  if(!state.status.authenticated&&$('ig-mode-note'))$('ig-mode-note').textContent='현재 화면은 미리보기입니다. 사진 저장과 SNS 전송은 로그인 후 이용할 수 있습니다.';
  await refresh();controls();
}catch(e){feedback(failure(e));controls();}
}
initialize();
poll=setInterval(()=>{if(ready()&&!state.busy&&state.jobs.some(j=>['queued','publishing'].includes(j.status)))refresh().catch(e=>feedback(failure(e)));},2500);
return {updateDraft:controls};
}
if(document.getElementById('ig-title'))attachInstagramPhoto();
