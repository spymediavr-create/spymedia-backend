import {composeCaption,formatBytes} from './domain.js';
import {createRecordRow} from './record-ui.js';

const MAX_BYTES=300000000;
const $=id=>document.getElementById(id);
const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const messages={
  authentication_required:'관리자 로그인이 만료됐습니다. 다시 로그인하세요.',csrf_rejected:'로그인 상태를 새로 확인하세요.',
  storage_unavailable:'원본을 보관할 서버 저장소를 확인하세요.',storage_full:'서버 저장 공간이 부족합니다.',upload_busy:'다른 파일을 저장 중입니다. 잠시 후 다시 시도하세요.',
  file_too_large:'릴스 영상은 최대 300MB입니다.',reel_too_large:'릴스 영상은 최대 300MB입니다.',invalid_filename:'파일 이름을 확인하세요.',
  invalid_media:'읽을 수 있는 MP4·MOV 영상을 선택하세요.',instagram_reel_only:'릴스는 MP4·MOV 영상 1개만 지원합니다.',reel_only:'MP4·MOV 영상을 선택하세요.',
  reel_type_required:'MP4 또는 MOV 원본 영상으로 내보낸 파일을 선택하세요.',invalid_reel:'영상 파일을 읽지 못했습니다. 편집 프로그램에서 MP4·MOV로 다시 내보내세요.',
  reel_duration:'길이가 맞지 않습니다. 3초~15분 영상으로 다시 내보내세요.',reel_dimensions:'영상 크기가 맞지 않습니다. 가로 1920px 이하, 세로 9:16 권장으로 다시 내보내세요.',
  reel_video_codec:'영상 코덱이 맞지 않습니다. H.264 또는 HEVC로 다시 내보내세요.',reel_frame_rate:'프레임률이 맞지 않습니다. 23~60fps로 다시 내보내세요.',
  reel_video_bitrate:'영상 비트레이트가 지원 범위를 벗어났습니다. 25Mbps 이하로 다시 내보내세요.',reel_audio_codec:'오디오 코덱이 맞지 않습니다. AAC로 다시 내보내세요.',
  reel_audio_sample_rate:'오디오 샘플률이 맞지 않습니다. 48kHz 이하로 다시 내보내세요.',reel_audio_channels:'오디오 채널이 맞지 않습니다. 모노 또는 스테레오로 다시 내보내세요.',
  reel_audio_bitrate:'오디오 비트레이트가 맞지 않습니다. 128kbps 이하로 다시 내보내세요.',reel_pixel_format:'영상 색상 형식이 맞지 않습니다. YUV 4:2:0으로 다시 내보내세요.',
  reel_interlaced:'인터레이스 영상은 지원하지 않습니다. 프로그레시브 방식으로 다시 내보내세요.',reel_rotation:'회전 정보가 있는 영상입니다. 편집 프로그램에서 세로 방향을 적용한 뒤 회전 메타데이터 없이 다시 내보내세요.',
  reel_fast_start:'웹 전송에 필요한 파일 구성이 아닙니다. 빠른 시작(Fast Start/웹 최적화)을 켜서 다시 내보내세요.',reel_edit_list:'타임라인 편집 목록이 포함돼 있습니다. 편집 목록 없이 MP4로 다시 내보내세요.',
  reel_probe_unavailable:'서버의 영상 검사 도구를 사용할 수 없습니다. 서버 설정을 확인한 후 다시 시도하세요.',
  instagram_reel_dimensions:'영상의 가로 크기는 1920px 이하여야 합니다.',instagram_reel_duration:'영상 길이는 3초~15분이어야 합니다.',
  instagram_reel_codec:'영상은 H.264 또는 HEVC, 오디오는 AAC로 준비하세요.',instagram_reel_framerate:'프레임률은 23~60fps로 준비하세요.',
  instagram_reel_limits:'영상 규격이 맞지 않습니다. 길이·크기·코덱·프레임률을 확인하세요.',media_tools_unavailable:'서버의 영상 검사 도구 연결이 필요합니다.',
  invalid_draft:'제목과 설명을 입력하고 해시태그를 확인하세요.',instagram_content_limits:'제목·설명·해시태그 합계를 2,200자 이하로 줄여 주세요.',
  instagram_not_configured:'기존 Instagram 앱의 인증 설정이 필요합니다.',channel_not_configured:'Instagram 전송 설정을 확인하세요.',
  account_mismatch:'연결 계정이 지정한 spymedia_kr와 다릅니다. 전송을 중단했습니다.',channel_auth_or_permission:'Instagram 인증 또는 게시 권한을 확인하세요.',
  instagram_check_rate_limited:'계정 확인은 1분에 한 번 가능합니다.',channel_rate_limit:'Instagram 요청 한도에 도달했습니다. 잠시 후 다시 확인하세요.',
  publishing_disabled:'서버의 SNS 전송 설정이 꺼져 있습니다.',media_in_trash:'저장된 원본을 보관함에서 복원하세요.',job_in_trash:'동일한 작업을 보관함에서 복원하세요.',
  job_not_ready:'이미 전송했거나 준비되지 않은 작업입니다. 결과를 새로고침하세요.',check_channel_before_retry:'Instagram에서 게시 결과를 먼저 확인하세요. 중복 전송은 중단됐습니다.',
  channel_media_processing:'Instagram에서 영상 처리를 완료하지 못했습니다.',channel_media_processing_timeout:'Instagram 영상 처리가 지연됐습니다. 저장된 결과를 확인하세요.',
  channel_network_failure:'Instagram 응답을 확인하지 못했습니다. 자동으로 다시 전송하지 말고 게시 결과를 확인하세요.',
  verify_publication:'게시 결과를 확인하지 못했습니다. Instagram에서 먼저 확인하세요.',server_unavailable:'서버 응답을 확인하지 못했습니다. 결과를 새로고침하세요.',
  upload_cancelled:'업로드를 취소했습니다. 원본 파일은 그대로입니다. 이미 완료된 저장 여부는 보관 콘텐츠에서 확인할 수 있습니다.'
};
const states={prepared:'준비 완료',queued:'전송 대기',publishing:'전송·처리 확인 중',succeeded:'완료',failed:'실패',unknown:'결과 확인 필요'};
const phases={instagram_identity:'계정 확인',instagram_reel_create:'영상 등록',instagram_reel_prepare:'영상 처리',instagram_reel_publish:'최종 전송',instagram_reel_verify:'게시 결과 확인'};
function errorText(error){
  const code=typeof error?.code==='string'&&/^[a-z0-9_]{1,80}$/.test(error.code)?error.code:'server_unavailable';
  const d=error?.details||{},parts=[phases[d.phase],Number.isInteger(d.httpStatus)?'HTTP '+d.httpStatus:null,Number.isInteger(d.providerCode)?'오류 '+d.providerCode:null];
  return (messages[code]||'요청을 완료하지 못했습니다. 오류 코드: '+code)+(parts.some(Boolean)?' ('+parts.filter(Boolean).join(' · ')+')':'');
}
function fileType(file){
  if(file.type==='video/mp4'||file.type==='video/quicktime')return file.type;
  if(!file.type&&/\.mp4$/i.test(file.name))return 'video/mp4';
  if(!file.type&&/\.mov$/i.test(file.name))return 'video/quicktime';
  return null;
}
function dimensions(media){return media?.width&&media?.height?media.width+' × '+media.height+'px':'크기 정보 없음';}
function duration(media){return Number.isFinite(media?.duration)?Math.round(media.duration*10)/10+'초':'길이 정보 없음';}
function safeMediaUrl(value){return typeof value==='string'&&/^\/api\/admin\/media\/[a-f0-9-]{36}(\?(preview|converted)=1)?$/.test(value)?value:null;}
function resultLink(value){
  try{const u=new URL(value);return u.protocol==='https:'&&['instagram.com','www.instagram.com'].includes(u.hostname)&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&/^\/(p|reel)\/[a-zA-Z0-9_-]+\/$/.test(u.pathname)?u.href:null;}catch{return null;}
}

export function attachInstagramReels(status,getDraft){
  const state={status,busy:false,expired:false,verified:false,file:null,url:null,media:null,localIssue:'',localPending:false,jobs:[],selected:null,expanded:new Set(),xhr:null,sequence:0,cooldown:0};
  let poll,cooldownTimer,metadataTimer,metadataCleanup=()=>{};
  const preview=$('reels-preview');
  const ready=()=>state.status?.authenticated===true&&state.status.mode!=='preview'&&!state.expired;
  const storage=()=>state.status?.storageReady===true;
  const draft=()=>{const input=getDraft();return {title:String(input.title||'').trim(),description:String(input.description||'').trim(),tags:[...(input.tags||[])]};};
  const caption=()=>{const d=draft();return composeCaption(d.title,d.description,d.tags);};
  const feedback=(text,success=false)=>{$('reels-feedback').textContent=text;$('reels-feedback').classList.toggle('success-feedback',success);};
  function expire(){
    state.expired=true;state.verified=false;state.selected=null;state.xhr?.abort();clearTimeout(poll);
    $('reels-connection-status').replaceChildren(el('span','관리자 로그인이 만료됐습니다. 저장한 원본과 작업은 다시 로그인 후 확인하세요. '));
    const link=el('a','다시 로그인');link.href='/admin/login?reason=session_expired';$('reels-connection-status').append(link);controls();
  }
  function responseError(response,data){
    if(response===401||response===403&&data.error==='csrf_rejected'){expire();window.dispatchEvent(new Event('sns-auth-expired'));}
    return {code:data.error||'server_unavailable',details:data.details};
  }
  async function api(route,body){
    let r,data;
    try{r=await fetch('/api/admin/'+route,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':state.status.csrfToken},...(body===undefined?{}:{body:JSON.stringify(body)})});data=await r.json();}
    catch{throw {code:'server_unavailable'};}
    if(!r.ok||data.error)throw responseError(r.status,data);return data;
  }
  function controls(){
    const c=state.status?.instagramConnection,d=draft(),text=caption(),job=state.jobs.find(j=>j.id===state.selected);
    $('reels-file').disabled=state.busy;
    $('reels-clear').disabled=!state.file||state.busy;
    $('reels-upload').disabled=!ready()||!storage()||state.busy||!state.file||!!state.localIssue||state.localPending||!!state.media;
    $('reels-prepare').disabled=!ready()||!storage()||state.busy||!state.media||!d.title||!d.description||text.length>2200;
    $('reels-check').disabled=!ready()||!c?.credentialsConfigured||state.busy||Date.now()<state.cooldown;
    $('reels-refresh').disabled=!ready()||state.busy;
    $('reels-cancel').hidden=!state.xhr;
    $('reels-send').disabled=!ready()||!storage()||state.busy||!state.verified||!state.status.publishingEnabled||!c?.publishingEnabled||!c?.mediaDeliveryConfigured||!state.status.channels?.instagram?.configured||job?.canSend!==true||job.status!=='prepared';
    for(const input of $('reels-jobs').querySelectorAll('input'))input.disabled=state.busy||!ready()||!state.jobs.find(j=>j.id===input.dataset.jobId)?.canSend;
    $('reels-send-note').textContent=!ready()?'로그인 후 서버 검사·저장과 전송을 이용할 수 있습니다.':!c?.credentialsConfigured?'Instagram 인증 설정이 필요합니다.':!storage()?'서버 저장소 연결이 필요합니다.':!c.mediaDeliveryConfigured?'Instagram에 원본을 전달할 서버 설정이 필요합니다.':!c.publishingEnabled||!state.status.publishingEnabled?'Instagram 전송 설정이 꺼져 있습니다.':!state.verified?'전송 전에 인스타그램 연결 확인을 실행하세요.':!job?.canSend?'전송 가능한 릴스 작업 1개를 선택하세요.':'선택한 저장 작업만 전송합니다. 현재 편집 중인 입력과 다를 수 있으니 최종 확인하세요.';
    $('reels-caption').textContent=text||'위 콘텐츠 정보에 제목과 설명을 입력하세요.';
    $('reels-caption-count').textContent=text.length.toLocaleString('ko-KR')+' / 2,200자';
    $('reels-draft-warning').textContent=text.length>2200?'릴스 문구가 2,200자를 넘습니다. 위 제목·설명·해시태그를 줄여 주세요.':'';
    $('reels-saved-note').textContent=job&&job.caption!==text?'현재 입력과 선택한 저장 작업의 문구가 다릅니다. 편집 내용을 사용하려면 새 작업을 준비하세요.':state.media?'서버 검사를 통과한 영상과 현재 문구로 작업을 준비할 수 있습니다.':'';
  }
  async function busy(fn){if(state.busy||!ready())return;state.busy=true;controls();try{await fn();}catch(e){feedback(errorText(e));}finally{state.busy=false;controls();}}
  function clearFile(resetInput=true){
    ++state.sequence;metadataCleanup();clearTimeout(metadataTimer);preview.pause();preview.removeAttribute('src');preview.load();preview.hidden=true;
    if(state.url)URL.revokeObjectURL(state.url);Object.assign(state,{file:null,url:null,media:null,localIssue:'',localPending:false});if(resetInput)$('reels-file').value='';
    $('reels-file-info').textContent='선택한 영상이 없습니다.';$('reels-local-check').textContent='브라우저에서는 코덱과 프레임률을 확정할 수 없습니다. 저장 시 서버에서 최종 검사합니다.';
    $('reels-media-status').textContent='';$('reels-progress-wrap').hidden=true;controls();
  }
  function choose(file,fromInput=false){
    if(state.busy)return;clearFile(!fromInput);state.selected=null;
    if(!file)return;
    if(!file.size||file.size>MAX_BYTES||!fileType(file)){feedback(!file.size?'내용이 없는 파일입니다.':file.size>MAX_BYTES?'릴스 영상은 최대 300MB입니다.':'MP4 또는 MOV 영상 1개를 선택하세요.');return;}
    state.file=file;state.url=URL.createObjectURL(file);state.localPending=true;const sequence=state.sequence;
    $('reels-file-info').textContent=file.name+' · '+formatBytes(file.size);preview.hidden=false;
    $('reels-local-check').textContent='로컬 영상의 크기와 길이를 읽고 있습니다…';feedback('선택한 영상은 아직 서버에 저장되지 않았습니다.');
    const finish=(loaded)=>{
      if(sequence!==state.sequence)return;metadataCleanup();clearTimeout(metadataTimer);state.localPending=false;
      if(loaded&&Number.isFinite(preview.duration)&&preview.videoWidth>0){
        const m={width:preview.videoWidth,height:preview.videoHeight,duration:preview.duration};
        state.localIssue=m.width>1920?'가로 크기를 1920px 이하로 준비하세요.':m.duration<3||m.duration>900?'영상 길이를 3초~15분으로 준비하세요.':'';
        const warning=Math.abs(m.width/m.height-9/16)>.015?' 9:16 세로 비율을 권장합니다. 현재 비율은 그대로 보관됩니다.':'';
        $('reels-file-info').textContent=file.name+' · '+formatBytes(file.size)+' · '+dimensions(m)+' · '+duration(m);
        $('reels-local-check').textContent=(state.localIssue||'브라우저에서 크기·길이를 확인했습니다.')+warning+' 코덱·프레임률을 포함한 최종 검사는 서버에서 진행합니다.';
      }else $('reels-local-check').textContent='이 브라우저에서 영상 정보를 읽지 못했습니다. 재생 지원 여부와 서버의 최종 규격 검사는 다릅니다. 검사·저장으로 확인하세요.';
      controls();
    };
    const loaded=()=>finish(true),failed=()=>finish(false);preview.addEventListener('loadedmetadata',loaded);preview.addEventListener('error',failed);
    metadataCleanup=()=>{preview.removeEventListener('loadedmetadata',loaded);preview.removeEventListener('error',failed);};
    metadataTimer=setTimeout(failed,12000);preview.src=state.url;preview.load();controls();
  }
  function upload(file){return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();state.xhr=xhr;xhr.open('POST','/api/admin/reels');xhr.timeout=30*60*1000;
    xhr.setRequestHeader('Content-Type',fileType(file));xhr.setRequestHeader('X-Upload-Name',encodeURIComponent(file.name));xhr.setRequestHeader('X-CSRF-Token',state.status.csrfToken);
    const complete=(fn,value)=>{state.xhr=null;controls();fn(value);};
    xhr.upload.onprogress=e=>{if(e.lengthComputable){const percent=Math.min(100,Math.round(e.loaded/e.total*100));$('reels-progress').value=percent;$('reels-progress-label').textContent=percent===100?'전송 완료 · 서버 검사 중':percent+'%';}};
    xhr.onload=()=>{let data;try{data=JSON.parse(xhr.responseText);}catch{complete(reject,{code:'server_unavailable'});return;}if(xhr.status<200||xhr.status>=300||data.error){complete(reject,responseError(xhr.status,data));return;}if(!data.media?.id){complete(reject,{code:'server_unavailable'});return;}complete(resolve,data.media);};
    xhr.onerror=xhr.ontimeout=()=>complete(reject,{code:'server_unavailable'});xhr.onabort=()=>complete(reject,{code:'upload_cancelled'});
    $('reels-progress-wrap').hidden=false;$('reels-progress').value=0;$('reels-progress-label').textContent='0%';controls();xhr.send(file);
  });}
  function renderJobs(){
    if(!state.jobs.some(j=>j.id===state.selected&&j.canSend))state.selected=null;
    $('reels-jobs').replaceChildren(...state.jobs.map(job=>{
      const check=el('input');check.type='radio';check.name='reels-job';check.dataset.jobId=job.id;check.checked=job.id===state.selected;
      check.addEventListener('change',()=>{state.selected=job.id;controls();});
      return createRecordRow({id:job.id,title:job.title||'제목 없음',createdAt:job.createdAt,channel:'릴스',status:states[job.status]||'확인 필요',statusKey:job.status,check,className:'reels-job',expanded:state.expanded.has(job.id),onToggle:open=>{open?state.expanded.add(job.id):state.expanded.delete(job.id);},fillDetails:details=>{
        const source=job.sourceMedia?.[0],asset=job.assets?.[0];details.append(el('p',job.caption),el('small',(source?.name||'저장된 릴스 원본')+' · '+dimensions(asset)+' · '+duration(asset)));
        const url=safeMediaUrl(asset?.preview);if(url){const video=el('video');video.src=url;video.controls=true;video.playsInline=true;video.preload='metadata';details.append(video);}
        if(job.error)details.append(el('p',errorText({code:job.error,details:job.errorDetails})));
        if(job.status==='unknown')details.append(el('p','게시 여부가 불확실합니다. Instagram에서 먼저 확인하세요. 이 작업은 자동 재전송하지 않습니다.'));
        if(job.canRetry===true&&job.status==='failed'){
          const retry=el('button','실패 작업 다시 준비');retry.type='button';retry.className='outline-button';
          retry.addEventListener('click',()=>busy(async()=>{await api('jobs/retry',{id:job.id});state.selected=job.id;await refresh();feedback('실패 작업을 다시 준비했습니다. 실제 전송은 선택·최종 확인 후 진행하세요.',true);}));details.append(retry);
        }
        const href=resultLink(job.result?.url);if(href){const link=el('a','게시 결과 확인 ↗');Object.assign(link,{href,target:'_blank',rel:'noopener noreferrer'});details.append(link);}
      }});
    }));
    if(!state.jobs.length)$('reels-jobs').append(el('p','준비한 릴스 작업이 없습니다. 검사한 영상과 문구로 작업을 준비하세요.'));
    controls();
  }
  async function refresh(){
    if(!ready())return;const result=await api('jobs');state.jobs=(result.jobs||[]).filter(j=>j.type==='instagram-reel'&&j.channel==='instagram');renderJobs();
  }
  function schedule(){clearTimeout(poll);if(!ready())return;poll=setTimeout(async()=>{try{if(!state.busy&&state.jobs.some(j=>['queued','publishing'].includes(j.status)))await refresh();}catch(e){feedback(errorText(e));}finally{schedule();}},2500);}
  $('reels-file').addEventListener('change',()=>choose($('reels-file').files[0],true));
  $('reels-clear').addEventListener('click',()=>{if(!state.busy){clearFile();feedback('로컬 선택만 해제했습니다. 이미 저장한 원본과 작업은 보관됩니다.');}});
  const drop=$('reels-drop');drop.addEventListener('dragover',e=>{e.preventDefault();if(!state.busy)drop.classList.add('dragging');});drop.addEventListener('dragleave',()=>drop.classList.remove('dragging'));
  drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('dragging');if(state.busy)return;if(e.dataTransfer.files.length!==1){feedback('릴스 영상 1개만 선택하세요.');return;}choose(e.dataTransfer.files[0]);});
  $('reels-cancel').addEventListener('click',()=>state.xhr?.abort());
  $('reels-upload').addEventListener('click',()=>{if($('reels-upload').disabled)return;busy(async()=>{
    const sequence=state.sequence,media=await upload(state.file);if(sequence!==state.sequence)return;state.media=media;
    $('reels-progress-wrap').hidden=true;$('reels-media-status').textContent='서버 검사 완료 · '+dimensions(media)+' · '+duration(media)+(media.videoCodec?' · '+media.videoCodec:'')+(media.audioCodec?' / '+media.audioCodec:'')+(media.frameRate?' · '+Math.round(media.frameRate*100)/100+'fps':'')+' · 원본 보관됨'+(media.warnings?.includes('reel_vertical_recommended')?' · 9:16 세로 비율 권장(현재 비율 유지)':'');
    feedback('영상을 검사하고 저장했습니다. 문구를 검토한 뒤 릴스 작업을 준비하세요.',true);
  });});
  $('reels-prepare').addEventListener('click',()=>{if($('reels-prepare').disabled)return;busy(async()=>{
    const input=draft(),mediaId=state.media.id;
    const result=await api('jobs',{type:'instagram-reel',channels:['instagram'],mediaIds:[mediaId],...input});
    const saved=result.jobs?.find(j=>j.type==='instagram-reel'&&j.channel==='instagram');
    if(saved){state.selected=saved.id;state.expanded.add(saved.id);}await refresh();feedback('릴스 작업을 저장했습니다. 준비만으로 게시되지 않습니다. 저장된 문구와 원본을 확인한 뒤 전송하세요.',true);
  });});
  $('reels-check').addEventListener('click',()=>{if($('reels-check').disabled)return;busy(async()=>{
    state.verified=false;state.cooldown=Date.now()+60000;clearTimeout(cooldownTimer);cooldownTimer=setTimeout(controls,60100);
    try{const result=await api('instagram/check',{});state.verified=result.connection?.identityVerified===true&&result.connection.username==='spymedia_kr';$('reels-connection-status').textContent=state.verified?'spymedia_kr 계정 확인됨 · 글쓰기 권한은 아직 검증하지 않았습니다.':'지정한 계정을 확인하지 못했습니다.';}
    catch(e){$('reels-connection-status').textContent=errorText(e);throw e;}
  });});
  $('reels-send').addEventListener('click',()=>{
    const job=state.jobs.find(j=>j.id===state.selected);if($('reels-send').disabled||!job)return;
    const asset=job.assets?.[0],name=job.sourceMedia?.[0]?.name||'저장된 릴스 원본';
    if(!window.confirm('spymedia_kr에 선택한 릴스와 저장된 문구를 공개 게시합니다.\n\n영상: '+name+'\n규격: '+dimensions(asset)+' · '+duration(asset)+'\n\n'+job.caption+'\n\n현재 편집 중인 내용이 아니라 이 저장 작업을 전송합니다. 전송하시겠습니까?'))return;
    busy(async()=>{state.selected=null;await api('jobs/start',{ids:[job.id]});await refresh();feedback('릴스 전송을 요청했습니다. 처리 상태와 게시 결과를 아래에서 확인하세요.',true);});
  });
  $('reels-refresh').addEventListener('click',()=>busy(refresh));
  window.addEventListener('sns-auth-expired',expire);
  window.addEventListener('pagehide',()=>{clearTimeout(poll);clearTimeout(cooldownTimer);clearTimeout(metadataTimer);metadataCleanup();state.xhr?.abort();preview.pause();preview.removeAttribute('src');preview.load();if(state.url)URL.revokeObjectURL(state.url);state.url=null;});
  $('reels-connection-status').textContent=!ready()?'로컬 미리보기입니다. 실제 검사·저장과 전송은 로그인 후 가능합니다.':status.instagramConnection?.credentialsConfigured?'기존 인증 설정 있음 · 계정 미확인':'기존 Instagram 인증 설정이 필요합니다.';
  controls();if(ready())refresh().catch(e=>feedback(errorText(e)));schedule();
  return {updateDraft:controls};
}
