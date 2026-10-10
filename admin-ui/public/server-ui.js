import {createRecordRow} from './record-ui.js';
import {attachCatalogUI,jobDiagnostics,formatFailureDetails} from './catalog-ui.js';
import {draftIssues} from './domain.js';
import {parseYouTubeUrl} from './youtube-url.js';
const NAMES={youtube:'유튜브',instagram:'인스타그램',x:'X',facebook:'페이스북',blog:'블로그'};
const STATES={converting:'규격 변환 중',prepared:'전송 준비',queued:'전송 대기',publishing:'전송·처리 확인 중',succeeded:'완료',failed:'실패',unknown:'채널에서 결과 확인 필요'};
const ERRORS={storage_unavailable:'영구 저장소 연결이 필요합니다.',media_tools_unavailable:'파일 검증·변환 도구 연결이 필요합니다.',invalid_media:'파일이 손상되었거나 지원되지 않습니다.',file_too_large:'파일 크기 제한을 확인하세요.',storage_full:'저장 공간이 부족합니다.',csrf_rejected:'로그인 상태를 새로 확인하세요.',authentication_required:'다시 로그인하세요.',instagram_content_limits:'인스타그램 설명은 2,200자 이하, 영상은 3초~15분으로 준비하세요.',youtube_content_limits:'유튜브는 영상, 제목 100자 이하, 설명 4,500자 이하로 준비하세요.',youtube_settings_required:'유튜브 공개 범위와 아동용 여부를 선택하세요.',x_content_limits:'X 글 길이·사진 4장·영상 20분 제한을 확인하세요.',account_mismatch:'연결된 계정이 지정한 스파이미디어 계정과 다릅니다.',channel_auth_or_permission:'계정 인증 또는 접근 권한을 확인하세요.',channel_not_configured:'이 채널의 인증과 전송 설정을 확인하세요.',publishing_disabled:'현재 서버에서 SNS 전송이 비활성 상태입니다.',check_channel_before_retry:'중복 방지를 위해 채널의 실제 결과를 먼저 확인하세요.',job_not_ready:'이미 전송했거나 준비되지 않은 작업입니다.'};
Object.assign(ERRORS,{x_check_rate_limited:'X 연결 확인은 1분에 한 번 가능합니다.',x_auth_configuration:'기존 X 인증 방식과 서버 설정을 확인하세요. 비밀 값은 채팅에 입력하지 마세요.',x_auth_expired:'X 사용자 인증이 만료됐습니다. 갱신 설정 또는 안전한 재연결을 확인하세요.',x_scope_missing:'기존 X 사용자 인증의 글쓰기 권한을 확인하세요.',x_cost_confirmation_required:'X 비용 확인이 필요합니다. 실제 지출 상한은 X Developer Console에서 설정하세요.',x_token_storage_unavailable:'X 갱신 인증정보를 안전하게 보관할 서버 설정을 확인하세요.',x_refresh_reauthorization_required:'X 인증 갱신을 안전하게 완료하지 못했습니다. 자동 재시도를 중단했습니다. 기존 연결의 복구를 확인하세요.',facebook_check_rate_limited:'연결 확인은 1분에 한 번 가능합니다. 잠시 후 다시 확인하세요.',invalid_connection_check_input:'연결 확인 요청 형식을 확인하세요.',legacy_operation_disabled:'기존 영상 작업은 이력 조회만 지원합니다. 새 YouTube 링크 소개를 준비하세요.',invalid_youtube_url:'올바른 유튜브 영상 주소를 입력하세요.',photo_only:'블로그 자료는 JPG·PNG·WebP 사진만 지원합니다.',photo_too_large:'사진은 한 장당 8MB 이하로 선택하세요.',invalid_photo_dimensions:'사진 규격을 확인하세요. 가로·세로 4096px 이하, 총 1,600만 화소 이하가 필요합니다.',upload_busy:'다른 사진을 저장 중입니다. 잠시 후 다시 시도하세요.',interrupted:'서버가 다시 시작되어 작업이 중단됐습니다. 파일과 이력은 보존됩니다.',conversion_failed:'미디어 규격 변환에 실패했습니다. 원본 파일과 서버 변환 도구를 확인하세요.',channel_network_failure:'채널 API 응답을 받지 못했습니다. 전송 결과를 확인하세요.',channel_request_failed:'채널 API 요청이 실패했습니다. 오류 코드와 전송 결과를 확인하세요.',channel_media_processing:'채널에서 미디어 처리에 실패했습니다.',channel_media_processing_timeout:'채널의 미디어 처리 확인 시간이 초과됐습니다.',channel_rate_limit:'채널 API 요청 한도에 도달했습니다.',media_in_trash:'원본 파일을 휴지통에서 복원한 후 다시 준비하세요.',job_in_trash:'같은 콘텐츠의 작업이 휴지통에 있습니다. 기존 작업을 복원하세요.',content_in_use:'진행 중이거나 게시 결과 확인이 필요한 작업과 연결된 항목은 이동할 수 없습니다.',server_unavailable:'서버 응답을 확인할 수 없습니다. 잠시 후 목록을 새로고침하세요.'});
Object.assign(ERRORS,{x_unauthorized:'X 인증이 거절됐습니다. 기존 인증정보의 앱·계정 일치와 서명을 확인하세요.',x_forbidden:'X 접근이 거절됐습니다. 앱·프로젝트 접근 상태와 계정 권한을 확인하세요.',x_payment_required:'X 이용 상태 확인이 필요합니다. Developer Console의 잔액과 차단 표시를 확인하세요.'});
const $=id=>document.getElementById(id);
function el(tag,text){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;}
export function describeJobMedia(job) {
  if(job.type==='blog-draft')return {label:'블로그 원고 · 사진 '+(job.sourceMedia?.length||0)+'장',filenames:(job.sourceMedia||[]).map(item=>item.name||'파일명 기록 없음')};
  if(job.type==='link')return {label:'유튜브 링크 1개'+(job.sourceMedia?.length?' · 블로그 참고 사진 '+job.sourceMedia.length+'장':''),filenames:(job.sourceMedia||[]).map(item=>item.name||'파일명 기록 없음')};
  const sources=Array.isArray(job.sourceMedia)&&job.sourceMedia.length?job.sourceMedia:[];
  const entries=sources.length?sources:(job.assets||[]);
  let kinds=new Set(entries.map(item=>item.kind).filter(kind=>kind==='video'||kind==='image'));
  if(!kinds.size)kinds=new Set((job.assets||[]).map(item=>item.kind).filter(kind=>kind==='video'||kind==='image'));
  const kind=kinds.size===1?[...kinds][0]:null;
  const label=kind==='video'?'영상 '+entries.length+'개':kind==='image'?'사진 '+entries.length+'장':'미디어 종류 확인 필요';
  const filenames=entries.length?entries.map((item,index)=>sources[index]?.name||'파일명 기록 없음'):['파일명 기록 없음'];
  return {label,filenames};
}
export function attachServerUI(status,getDraft) {
  if(!status.authenticated||status.mode==='preview')return;
  $('server-workflow').hidden=false;$('prepare-server').disabled=!status.uploadsConnected;
  $('server-note').textContent=status.uploadsConnected?'영상 파일 없이 링크 소개를 준비합니다. Facebook·X는 선택·확인 후 전송하고, 블로그는 원고를 복사합니다.':'영구 저장소 연결을 확인하세요.';
  $('storage-note').textContent='링크 소개 준비 시 블로그에 선택한 사진만 보관합니다.';
  if(!status.xConnection?.credentialsConfigured)$('x-feedback').textContent='조회 사용 중지(인증 설정 필요). 현재 X 조회는 실행되지 않습니다. 기존 X 인증 방식과 서버 설정을 먼저 확인하세요.';
  else if(!status.xConnection.costAcknowledged)$('x-feedback').textContent='조회 사용 중지(비용 확인 필요). 현재 X 조회는 실행되지 않습니다. 다시 조회하려면 조회 비용 승인이 필요합니다. 실제 지출 상한은 X Developer Console에서 확인하세요.';
  let jobs=[],chosen=new Set(),expanded=new Set(),busy=false,sessionExpired=false,poll,catalog;
  const notice=el('p');notice.className='session-notice';notice.hidden=true;notice.setAttribute('role','alert');$('server-workflow').prepend(notice);
  function expireSession(){
    sessionExpired=true;chosen.clear();notice.hidden=false;
    notice.replaceChildren(el('span','관리자 로그인이 만료됐습니다. 서버 재시작이나 로그인 제한 시간 경과 때 발생할 수 있습니다. 저장한 콘텐츠는 다시 로그인 후 확인하세요.'));
    const link=el('a','다시 로그인');link.href='/admin/login?reason=session_expired';notice.append(link);render();
  }
  window.addEventListener('sns-auth-expired',expireSession);
  async function api(route,method='GET',body,headers={}) {
    let response,data;
    try {
      response=await fetch('/api/admin/'+route,{method,headers:{...(method==='GET'?{}:{'X-CSRF-Token':status.csrfToken}),...(body&&!headers['Content-Type']?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:headers['Content-Type']?body:JSON.stringify(body)});
      try{data=await response.json();}catch{data={error:'server_unavailable'};}
    }catch{const e=new Error(ERRORS.server_unavailable);e.code='server_unavailable';throw e;}
    if(response.status===401||response.status===403&&data.error==='csrf_rejected')expireSession();
    if(!response.ok||data.error){
      const code=typeof data.error==='string'&&/^[a-z0-9_]{1,80}$/.test(data.error)?data.error:'server_unavailable';
      const e=new Error(ERRORS[code]||'요청을 완료하지 못했습니다. 오류 코드: '+code);e.code=code;e.status=response.status;e.details=data.details;throw e;
    }
    return data;
  }
  function updateButton(){
    $('start-server').disabled=busy||sessionExpired||!status.publishingEnabled||!chosen.size;
    $('prepare-server').disabled=busy||sessionExpired||!status.uploadsConnected;$('facebook-check').disabled=busy||sessionExpired;
    const xUnavailable=!status.xConnection?.credentialsConfigured||!status.xConnection?.costAcknowledged;
    $('x-check').disabled=busy||sessionExpired||xUnavailable;
    $('x-check').textContent=xUnavailable?'X 조회 사용 중지':'X 연결 확인';
    $('x-check').setAttribute('aria-describedby','x-feedback');
    $('x-check').title=xUnavailable?'조회가 중지된 이유를 옆 안내에서 확인하세요.':'';
    catalog?.updateControls();
  }
  function render() {
    window.dispatchEvent(new CustomEvent('sns-job-status',{detail:jobs.map(job=>({channel:job.channel,status:job.status}))}));
    chosen=new Set([...chosen].filter(id=>jobs.some(j=>j.id===id&&!sessionExpired&&j.type==='link'&&['facebook','x'].includes(j.channel)&&j.canSend!==false&&j.status==='prepared'&&j.channel!=='blog'&&status.channels?.[j.channel]?.configured)));
    $('server-jobs').replaceChildren(...jobs.map(job=>{
      const check=el('input');check.type='checkbox';check.checked=chosen.has(job.id);check.disabled=busy||sessionExpired||job.type!=='link'||!['facebook','x'].includes(job.channel)||job.canSend===false||job.status!=='prepared'||job.channel==='blog'||!status.channels?.[job.channel]?.configured;
      check.addEventListener('change',()=>{check.checked?chosen.add(job.id):chosen.delete(job.id);updateButton();});
      const card=createRecordRow({id:job.id,title:job.title||'제목 없음',createdAt:job.createdAt,channel:NAMES[job.channel]||job.channel,status:job.channel==='blog'&&job.status==='prepared'?'원고 저장':STATES[job.status]||job.status,statusKey:job.status,check,className:'job-card',expanded:expanded.has(job.id),onToggle:open=>{open?expanded.add(job.id):expanded.delete(job.id);},fillDetails:panel=>{
        panel.append(el('h4',job.title),el('p','채널: '+NAMES[job.channel]+' · '+(job.channel==='blog'&&job.status==='prepared'?'원고 저장':STATES[job.status]||job.status)),el('p',job.caption));
        const mediaDescription=describeJobMedia(job);const label=el('p','미디어: '+mediaDescription.label);label.className='job-media-label';
        const files=el('ul');files.className='job-files';mediaDescription.filenames.forEach(name=>files.append(el('li',name)));panel.append(label,files,jobDiagnostics(job));
        if(job.legacyReadOnly)panel.append(el('p','기존 미디어 작업 · 이력 조회만 지원합니다. 새 링크 소개를 준비하세요.'));
        const source=parseYouTubeUrl(job.youtubeUrl);if(source){const a=el('a','YouTube 원본 확인 ↗');a.href=source.url;a.target='_blank';a.rel='noopener noreferrer';panel.append(a);}
        if(job.mediaInTrash)panel.append(el('p','원본 파일이 휴지통에 있습니다. 보관 콘텐츠에서 복원하세요.'));
        if(job.youtubePrivacy)panel.append(el('small','공개 범위: '+({private:'비공개',unlisted:'일부 공개',public:'공개'}[job.youtubePrivacy])+' · '+(job.madeForKids?'아동용':'아동용 아님')));
        if(job.error)panel.append(el('p',ERRORS[job.error]||'처리를 완료하지 못했습니다. 중복 전송 전에 채널 상태를 확인하세요.'));
        if(job.canRetry){const retry=el('button','실패 작업 다시 준비');retry.type='button';retry.disabled=busy||sessionExpired;retry.addEventListener('click',async()=>{if(busy||sessionExpired)return;busy=true;render();try{jobs=(await api('jobs/retry','POST',{id:job.id})).jobs;}catch(e){$('server-feedback').textContent=e.message;}finally{busy=false;render();}});panel.append(retry);}
        for(const asset of job.assets||[]){const media=el(asset.kind==='video'?'video':'img');media.src=asset.preview;if(asset.kind==='video'){media.controls=true;media.preload='metadata';}else media.alt=job.title;panel.append(media);}
        if(job.channel==='blog'){
          const copy=el('button','원고 복사');copy.type='button';copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(job.manuscript);$('server-feedback').textContent='원고를 복사했습니다. 이미지를 내려받아 네이버에서 최종 게시하세요.';}catch{$('server-feedback').textContent='원고 텍스트를 선택해 복사하세요.';}});panel.append(copy);
          (job.originals||[]).forEach((media,i)=>{const a=el('a','원본 '+(i+1)+' 다운로드');a.href=media.download;a.download='';panel.append(a);});
          if(job.type!=='link'&&job.type!=='blog-draft')(job.assets||[]).forEach((media,i)=>{const a=el('a','준비한 이미지 '+(i+1)+' 다운로드');a.href=media.preview;a.download='blog-image-'+(i+1)+'.jpg';panel.append(a);});
        }
        if(job.result?.url){try{const url=new URL(job.result.url);if(url.protocol==='https:'&&/^(www\.)?(youtube\.com|instagram\.com|facebook\.com|x\.com)$/.test(url.hostname)){const a=el('a','채널에서 확인');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';panel.append(a);}}catch{}}
        if(job.result?.privacyStatus)panel.append(el('small','유튜브 실제 공개 상태: '+job.result.privacyStatus));
        if(job.result?.processing)panel.append(el('small','유튜브 업로드 완료 · 영상 처리는 진행 중입니다.'));
      }});
      card.dataset.jobChannel=job.channel;return card;
    }));
    if(!jobs.length){const empty=el('p','준비한 작업이 없습니다. 링크 소개를 준비하면 여기에 표시됩니다.');empty.className='record-empty';$('server-jobs').append(empty);}
    updateButton();
  }
  async function refresh(){if(sessionExpired)return;try{jobs=(await api('jobs')).jobs;render();}catch(e){$('server-feedback').textContent=e.message;}clearTimeout(poll);if(!sessionExpired)poll=setTimeout(refresh,10000);}
  $('facebook-check').addEventListener('click',async()=>{
    if(busy||sessionExpired)return;busy=true;render();$('facebook-feedback').textContent='페이지 인증을 확인하고 있습니다…';
    try{
      const data=await api('facebook/check','POST',{}),connection=data.connection;
      if(!connection?.identityVerified||connection.pageId!=='1387247911137772')throw Error('지정한 스파이미디어 Page를 확인하지 못했습니다.');
      $('facebook-feedback').textContent='스파이미디어 Page 인증 확인됨. 글쓰기 권한은 아직 검증하지 않았습니다.'+(connection.publishingEnabled?'':' 현재 서버 전송 스위치는 꺼져 있습니다.');
    }catch(e){const details=formatFailureDetails(e.details||{});$('facebook-feedback').textContent=e.message+(details?' · '+details:'');}
    finally{busy=false;render();}
  });
  $('x-check').addEventListener('click',async()=>{
    if(busy||sessionExpired||$('x-check').disabled)return;
    if(!window.confirm('X @spymedia_kor 계정 조회 API만 호출합니다. 조회 비용이 발생할 수 있습니다. 실제 비용 한도는 X Developer Console 설정을 따릅니다.\n\n게시와 인증 갱신은 실행하지 않습니다. 연결을 확인할까요?'))return;
    busy=true;render();$('x-feedback').textContent='X 계정 인증을 확인하고 있습니다…';
    try{
      const connection=(await api('x/check','POST',{})).connection;
      if(!connection?.identityVerified||connection.username!=='spymedia_kor')throw Error('지정한 X 계정을 확인하지 못했습니다.');
      $('x-feedback').textContent='@spymedia_kor 인증 확인됨 · '+(connection.authMode==='oauth1'?'OAuth 1.0a':'OAuth 2.0')+'. 글쓰기 권한은 아직 검증하지 않았습니다.'+(connection.authMode==='oauth2'&&!connection.refreshConfigured?' 자동 갱신 설정은 없습니다.':'')+(connection.publishingEnabled?'':' 현재 X 전송 설정은 비활성 상태입니다.');
    }catch(e){const details=formatFailureDetails(e.details||{});$('x-feedback').textContent=e.message+(details?' · '+details:'');}
    finally{busy=false;render();}
  });
  $('prepare-server').addEventListener('click',async()=>{
    if(busy||sessionExpired)return;busy=true;chosen.clear();render();$('server-feedback').textContent='링크 소개 준비 중…';
    try{
      const draft=getDraft(),issues=draftIssues({...draft,channels:new Set(draft.channels)});
      if(issues.length)throw Error(issues.join(' '));
      if(draft.mediaIds.length+draft.photos.length>10)throw Error('블로그 참고 사진은 썸네일 포함 최대 10장입니다. 사진을 줄여 주세요.');
      const ids=[...draft.mediaIds],failures=[];
      let blogReady=true;
      if(draft.channels.includes('blog'))try{for(const file of draft.photos){
        const result=await api('media','POST',file,{'Content-Type':file.type,'X-Upload-Name':encodeURIComponent(file.name)});
        if(!ids.includes(result.media.id))ids.push(result.media.id);
      }}catch(e){if(sessionExpired)throw e;blogReady=false;failures.push(NAMES.blog+': '+e.message);}
      for(const channel of draft.channels){
        if(channel==='blog'&&!blogReady)continue;
        try{
          const result=await api('jobs','POST',{type:'link',youtubeUrl:draft.youtubeUrl,title:draft.title,description:draft.description,tags:draft.tags,xText:draft.xText,channels:[channel],mediaIds:channel==='blog'?ids:[]});
          jobs=[...result.jobs,...jobs.filter(j=>!result.jobs.some(created=>created.id===j.id))];render();
        }catch(e){if(sessionExpired)throw e;failures.push(NAMES[channel]+': '+e.message);}
      }
      await refresh();await catalog?.refresh();
      $('server-feedback').textContent=failures.length?'일부 작업 준비를 완료하지 못했습니다. '+failures.join(' '):'링크 소개를 준비했습니다. 내용을 확인하고 전송할 작업을 선택하세요. 블로그는 원고·사진을 가져가 최종 게시합니다.';
    }catch(e){$('server-feedback').textContent=e.message;}finally{busy=false;render();}
  });
  $('start-server').addEventListener('click',async()=>{
    const selected=jobs.filter(j=>chosen.has(j.id)&&j.type==='link'&&['facebook','x'].includes(j.channel));if(busy||sessionExpired||!selected.length)return;
    const details=selected.map(j=>NAMES[j.channel]+' · '+j.title+'\n'+j.caption).join('\n\n');
    const xCount=selected.filter(j=>j.channel==='x').length,cost=xCount?'\n\nX 링크 글 생성 '+xCount+'건: 현재 US$'+(xCount*0.20).toFixed(2)+' + 조회 비용 별도. 실제 지출 상한은 X Developer Console 설정을 따릅니다.':'';
    if(!window.confirm('다음 링크 소개글을 선택한 계정으로 전송합니다.\n\n'+details+cost+'\n\n전송을 시작할까요?'))return;
    busy=true;render();try{jobs=(await api('jobs/start','POST',{ids:selected.map(j=>j.id)})).jobs;chosen.clear();$('server-feedback').textContent='전송을 시작했습니다. 채널별 결과를 확인하세요.';}catch(e){$('server-feedback').textContent=e.message;}finally{busy=false;render();}
  });
  catalog=attachCatalogUI({api,isBusy:()=>busy||sessionExpired,setBusy:value=>{busy=value;render();},refreshJobs:refresh,describeJobMedia});
  refresh();
  window.addEventListener('beforeunload',()=>clearTimeout(poll));
}
