const NAMES={youtube:'유튜브',instagram:'인스타그램',x:'X',facebook:'페이스북',blog:'블로그'};
const STATES={converting:'규격 변환 중',prepared:'전송 준비',queued:'전송 대기',publishing:'전송·처리 확인 중',succeeded:'완료',failed:'실패',unknown:'채널에서 결과 확인 필요'};
const ERRORS={storage_unavailable:'영구 저장소 연결이 필요합니다.',media_tools_unavailable:'파일 검증·변환 도구 연결이 필요합니다.',invalid_media:'파일이 손상되었거나 지원되지 않습니다.',file_too_large:'파일 크기 제한을 확인하세요.',storage_full:'저장 공간이 부족합니다.',csrf_rejected:'로그인 상태를 새로 확인하세요.',authentication_required:'다시 로그인하세요.',instagram_content_limits:'인스타그램 설명은 2,200자 이하, 영상은 3초~15분으로 준비하세요.',youtube_content_limits:'유튜브는 영상, 제목 100자 이하, 설명 4,500자 이하로 준비하세요.',youtube_settings_required:'유튜브 공개 범위와 아동용 여부를 선택하세요.',x_content_limits:'X 글 길이·사진 4장·영상 20분 제한을 확인하세요.',account_mismatch:'연결된 계정이 지정한 스파이미디어 계정과 다릅니다.',channel_auth_or_permission:'계정 인증 만료 또는 권한 문제를 확인하세요.',channel_not_configured:'이 채널의 인증과 전송 설정을 확인하세요.',publishing_disabled:'현재 서버에서 SNS 전송이 비활성 상태입니다.',check_channel_before_retry:'중복 방지를 위해 채널의 실제 결과를 먼저 확인하세요.',job_not_ready:'이미 전송했거나 준비되지 않은 작업입니다.'};
const $=id=>document.getElementById(id);
function el(tag,text){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;}
export function attachServerUI(status,getDraft) {
  if(!status.authenticated||status.mode==='preview')return;
  $('server-workflow').hidden=false;$('prepare-server').disabled=!status.uploadsConnected;
  $('server-note').textContent=status.uploadsConnected?'원본을 보관하고 채널 규격으로 변환합니다. 결과를 확인한 뒤 전송하세요.':'영구 저장소 또는 파일 검증·변환 도구 연결이 필요합니다.';
  $('storage-note').textContent='서버 보관 버튼을 누르면 선택한 원본을 업로드합니다.';
  let jobs=[],chosen=new Set(),busy=false,poll;
  async function api(route,method='GET',body,headers={}) {
    const response=await fetch('/api/admin/'+route,{method,headers:{...(method==='GET'?{}:{'X-CSRF-Token':status.csrfToken}),...(body&&!headers['Content-Type']?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:headers['Content-Type']?body:JSON.stringify(body)});
    const data=await response.json();if(!response.ok)throw new Error(ERRORS[data.error]||'요청을 완료하지 못했습니다. 작업 상태를 확인하세요.');return data;
  }
  function updateButton(){ $('start-server').disabled=busy||!status.publishingEnabled||!chosen.size; }
  function render() {
    window.dispatchEvent(new CustomEvent('sns-job-status',{detail:jobs.map(job=>({channel:job.channel,status:job.status}))}));
    chosen=new Set([...chosen].filter(id=>jobs.some(j=>j.id===id&&j.status==='prepared'&&j.channel!=='blog'&&status.channels?.[j.channel]?.configured)));
    $('server-jobs').replaceChildren(...jobs.map(job=>{
      const card=el('article');card.className='job-card';
      const heading=el('label');const check=el('input');check.type='checkbox';check.checked=chosen.has(job.id);check.disabled=job.status!=='prepared'||job.channel==='blog'||!status.channels?.[job.channel]?.configured;
      check.addEventListener('change',()=>{check.checked?chosen.add(job.id):chosen.delete(job.id);updateButton();});heading.append(check,el('strong',NAMES[job.channel]+' · '+STATES[job.status]));card.append(heading,el('h3',job.title),el('p',job.caption));
      if(job.youtubePrivacy)card.append(el('small','공개 범위: '+({private:'비공개',unlisted:'일부 공개',public:'공개'}[job.youtubePrivacy])+' · '+(job.madeForKids?'아동용':'아동용 아님')));
      if(job.error)card.append(el('p',ERRORS[job.error]||'처리를 완료하지 못했습니다. 중복 전송 전에 채널 상태를 확인하세요.'));
      if(job.canRetry){const retry=el('button','실패 작업 다시 준비');retry.type='button';retry.addEventListener('click',async()=>{retry.disabled=true;try{jobs=(await api('jobs/retry','POST',{id:job.id})).jobs;render();}catch(e){$('server-feedback').textContent=e.message;retry.disabled=false;}});card.append(retry);}
      for(const asset of job.assets){const media=el(asset.kind==='video'?'video':'img');media.src=asset.preview;if(asset.kind==='video'){media.controls=true;media.preload='metadata';}else media.alt=job.title;card.append(media);}
      if(job.channel==='blog'){
        const copy=el('button','원고 복사');copy.type='button';copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(job.manuscript);$('server-feedback').textContent='원고를 복사했습니다. 이미지를 내려받아 네이버에서 최종 게시하세요.';}catch{$('server-feedback').textContent='원고 텍스트를 선택해 복사하세요.';}});card.append(copy);
        job.originals.forEach((media,i)=>{const a=el('a','원본 '+(i+1)+' 다운로드');a.href=media.download;a.download='';card.append(a);});
        job.assets.forEach((media,i)=>{const a=el('a','준비한 이미지 '+(i+1)+' 다운로드');a.href=media.preview;a.download='blog-image-'+(i+1)+'.jpg';card.append(a);});
      }
      if(job.result?.url){try{const url=new URL(job.result.url);if(url.protocol==='https:'&&/^(www\.)?(youtube\.com|instagram\.com|facebook\.com|x\.com)$/.test(url.hostname)){const a=el('a','채널에서 확인');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';card.append(a);}}catch{}}
      if(job.result?.privacyStatus)card.append(el('small','유튜브 실제 공개 상태: '+job.result.privacyStatus));
      if(job.result?.processing)card.append(el('small','유튜브 업로드 완료 · 영상 처리는 진행 중입니다.'));
      return card;
    }));updateButton();
  }
  async function refresh(){try{jobs=(await api('jobs')).jobs;render();}catch(e){$('server-feedback').textContent=e.message;}clearTimeout(poll);poll=setTimeout(refresh,10000);}
  $('prepare-server').addEventListener('click',async()=>{
    if(busy)return;busy=true;$('prepare-server').disabled=true;updateButton();$('server-feedback').textContent='원본 보관·규격 변환 준비 중…';
    try {
      const draft=getDraft();if(!draft.title.trim()||!draft.description.trim()||!draft.channels.length)throw new Error('제목·설명과 채널을 선택하세요.');
      const uploads=new Map();
      for(const channel of draft.channels){
        const files=draft.forChannel(channel);if(!files.length)throw new Error(NAMES[channel]+'에 사용할 미디어를 선택하세요.');
        if(channel==='youtube'&&$('made-for-kids').value==='')throw new Error(ERRORS.youtube_settings_required);
        const ids=[];for(const file of files){if(!uploads.has(file)){const result=await api('media','POST',file,{'Content-Type':file.type,'X-Upload-Name':encodeURIComponent(file.name)});uploads.set(file,result.media.id);}ids.push(uploads.get(file));}
        const result=await api('jobs','POST',{title:draft.title,description:draft.description,tags:draft.tags,channels:[channel],mediaIds:ids,youtubePrivacy:$('youtube-privacy').value,madeForKids:$('made-for-kids').value==='true'});
        jobs=[...result.jobs,...jobs.filter(j=>!result.jobs.some(created=>created.id===j.id))];render();
      }
      $('server-feedback').textContent='준비한 작업을 아래에서 확인하세요. 규격 변환 후 전송할 작업을 선택할 수 있습니다.';await refresh();
    }catch(e){$('server-feedback').textContent=e.message;}finally{busy=false;$('prepare-server').disabled=!status.uploadsConnected;updateButton();}
  });
  $('start-server').addEventListener('click',async()=>{
    const selected=jobs.filter(j=>chosen.has(j.id));if(busy||!selected.length)return;
    const details=selected.map(j=>NAMES[j.channel]+': '+j.title+(j.youtubePrivacy?' ('+j.youtubePrivacy+')':'')).join('\n');
    if(!window.confirm('다음 콘텐츠를 선택한 계정으로 전송합니다.\n\n'+details+'\n\n전송을 시작할까요?'))return;
    busy=true;updateButton();try{jobs=(await api('jobs/start','POST',{ids:selected.map(j=>j.id)})).jobs;chosen.clear();render();$('server-feedback').textContent='전송을 시작했습니다. 채널별 결과가 확인될 때까지 기다리세요.';}catch(e){$('server-feedback').textContent=e.message;}finally{busy=false;updateButton();}
  });
  if(status.storageReady)refresh();
  window.addEventListener('beforeunload',()=>clearTimeout(poll));
}
