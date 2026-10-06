import {CHANNELS,validateMedia,parseTags,recommendTags,composeCaption,draftIssues,formatBytes,xTextLength,shortXText} from './domain.js';
import {parseYouTubeUrl} from './youtube-url.js';
import {attachServerUI} from './server-ui.js';
const $=selector=>document.querySelector(selector);
const state={images:[],tags:[],suggestions:[],channels:new Set(['facebook','blog']),active:'facebook',importedPhoto:null,pending:null,xEdited:false};
let backendStatus,toastTimer,importSequence=0,importing=false;
const channelStates=new Map();
const node=(tag,className,text)=>{const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;};
const element=node;
function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,2800);}
function clearDraftFeedback(){$('#draft-feedback').replaceChildren();}
function safePreview(value){return typeof value==='string'&&/^\/api\/admin\/media\/[a-f0-9-]{36}\?preview=1$/.test(value)?value:null;}
function currentUrl(){return parseYouTubeUrl($('#youtube-url').value)?.url||null;}
function updateX(){if(!state.xEdited)$('#x-text').value=shortXText($('#title').value,$('#description').value,state.tags);$('#x-count').textContent=xTextLength($('#x-text').value+(currentUrl()?'\n\n'+currentUrl():''))+' / 280';}
function channelLabel(id){
  if(id==='youtube')return backendStatus?.youtubeImportReady?'정보 가져오기 설정 준비':'정보 가져오기 연결 확인 전';
  if(id==='instagram')return '별도 준비 · 링크 전송에서 제외';
  if(id==='blog')return '원고 준비 · 반자동';
  return backendStatus?.channels?.[id]?.configured?'서버 설정 준비 · 인증 미검증':id==='x'?'X 연결 설정 필요 · 전송 불가':'연결 설정 필요 · 전송 불가';
}
function renderFiles(){
  $('#image-files').replaceChildren(...state.images.map((media,index)=>{
    const row=node('div','file-row'),img=node('img','file-thumbnail');img.src=media.url;img.alt='';
    const detail=node('div','file-detail');detail.append(node('strong','',media.file.name),node('span','',formatBytes(media.file.size)+' · 블로그 자료'));
    const remove=node('button','remove-file','×');remove.type='button';remove.setAttribute('aria-label',media.file.name+' 제거');remove.addEventListener('click',()=>{URL.revokeObjectURL(media.url);state.images.splice(index,1);renderFiles();renderPreview();});row.append(img,detail,remove);return row;
  }));
  const box=$('#imported-photo');box.replaceChildren();box.hidden=!state.importedPhoto;
  if(state.importedPhoto){const img=node('img');img.src=state.importedPhoto.preview;img.alt='가져온 유튜브 썸네일';const remove=node('button','text-button','썸네일 제외');remove.type='button';remove.addEventListener('click',()=>{state.importedPhoto=null;renderFiles();renderPreview();});box.append(img,node('span','','유튜브 썸네일 · 블로그 자료'),remove);}
}
function chooseImages(files){
  const errors=[],seen=new Set(state.images.map(m=>m.file.name+':'+m.file.size+':'+m.file.lastModified));
  for(const file of files){
    const issue=validateMedia(file,'image');if(issue){errors.push(file.name+': '+issue);continue;}
    const key=file.name+':'+file.size+':'+file.lastModified;if(seen.has(key))continue;
    if(state.images.length+(state.importedPhoto?1:0)>=10){errors.push('사진은 썸네일을 포함해 최대 10장입니다.');break;}
    state.images.push({file,url:URL.createObjectURL(file)});seen.add(key);
  }
  $('#image-input').value='';$('#image-error').textContent=errors.join(' ');renderFiles();renderPreview();clearDraftFeedback();
}
$('#image-input').addEventListener('change',()=>chooseImages([...$('#image-input').files]));
const drop=$('#image-drop');drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('dragging');});drop.addEventListener('dragleave',()=>drop.classList.remove('dragging'));drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('dragging');chooseImages([...e.dataTransfer.files]);});drop.querySelector('.drop-zone').addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();$('#image-input').click();}});
function renderTags() {
  updateX();
  $('#tag-list').replaceChildren(...state.tags.map(tag => {
    const chip = element('span', 'tag-chip');
    chip.append(element('span', '', `#${tag}`));
    const remove = element('button', '', '×'); remove.type = 'button'; remove.setAttribute('aria-label', `${tag} 태그 삭제`);
    remove.addEventListener('click', () => { state.tags = state.tags.filter(item => item !== tag); renderTags(); renderPreview(); clearDraftFeedback(); });
    chip.append(remove); return chip;
  }));
  $('#suggestions').hidden = !state.suggestions.length;
  $('#suggestion-list').replaceChildren(...state.suggestions.map(tag => {
    const button = element('button', 'suggestion-chip', `+ #${tag}`); button.type = 'button';
    const added = state.tags.includes(tag); button.disabled = added; if (added) button.textContent = `✓ #${tag}`;
    button.addEventListener('click', () => { if (state.tags.length >= 30) { toast('해시태그는 최대 30개까지 추가할 수 있습니다.'); return; } state.tags.push(tag); renderTags(); renderPreview(); clearDraftFeedback(); });
    return button;
  }));
}
function addTags() {
  const raw = $('#tag-input').value;
  const added = parseTags(raw);
  $('#tag-feedback').textContent = added.length ? '' : '추가할 태그를 입력하세요.';
  if (!added.length) return;
  const combined = [...new Set([...state.tags, ...added])];
  if (combined.length > 30) $('#tag-feedback').textContent = '해시태그는 최대 30개까지 추가됩니다.';
  state.tags = combined.slice(0, 30); $('#tag-input').value = '';
  renderTags(); renderPreview(); clearDraftFeedback();
}
$('#add-tags').addEventListener('click', addTags);
$('#tag-input').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); addTags(); } });
$('#recommend-tags').addEventListener('click', () => {
  state.suggestions = recommendTags($('#title').value, $('#description').value, $('#region').value, $('#shoot-type').value);
  $('#tag-feedback').textContent = state.suggestions.length ? '' : '제목 또는 설명을 먼저 입력하세요.';
  renderTags();
});
for (const name of ['title', 'description', 'region', 'shoot-type']) {
  $(`#${name}`).addEventListener('input', () => {
    if (name === 'title' || name === 'description') $(`#${name}-count`).textContent = `${$(`#${name}`).value.length} / ${name === 'title' ? 200 : 5000}`;
    state.suggestions = []; renderTags(); renderPreview(); clearDraftFeedback();
  });
}


for(const id of ['title','description'])$('#'+id).addEventListener('input',()=>{updateX();renderPreview();});
$('#x-text').addEventListener('input',()=>{state.xEdited=true;updateX();renderPreview();clearDraftFeedback();});
$('#youtube-url').addEventListener('input',()=>{
  importSequence++;state.pending=null;$('#import-result').hidden=true;
  if(state.importedPhoto?.youtubeUrl!==currentUrl())state.importedPhoto=null;
  $('#youtube-feedback').textContent='';renderFiles();updateX();renderPreview();clearDraftFeedback();
});
const IMPORT_ERRORS={invalid_youtube_url:'올바른 유튜브 영상 주소를 입력하세요.',youtube_key_missing:'서버의 기존 YouTube 조회 API 연결이 필요합니다.',youtube_unavailable:'공개 정보를 가져올 수 없습니다. 비공개·삭제·주소 오류 여부를 확인하세요.',youtube_access_or_quota:'YouTube API 권한 또는 요청 한도를 확인해야 합니다.',youtube_import_busy:'다른 정보 가져오기를 처리 중입니다. 잠시 후 다시 시도하세요.',youtube_fetch_failed:'YouTube 정보를 가져오지 못했습니다. 작성한 내용은 유지됩니다.'};
function renderImport(video){
  const box=$('#import-result');box.hidden=false;box.replaceChildren();
  if(safePreview(video.thumbnail?.preview)){const img=node('img');img.src=video.thumbnail.preview;img.alt='가져올 유튜브 썸네일';box.append(img);}
  const detail=node('div');detail.append(node('strong','',video.title),node('p','import-description',video.description||'설명 없음'),node('small','',video.channelTitle||'유튜브'));
  if(video.thumbnailError)detail.append(node('p','field-hint','썸네일을 가져오지 못했습니다. 제목·설명만 적용하거나 사진을 직접 선택할 수 있습니다.'));
  const apply=node('button','outline-button','가져온 정보 적용');apply.id='apply-import';apply.type='button';
  apply.addEventListener('click',()=>{
    if(currentUrl()!==video.url){$('#youtube-feedback').textContent='주소가 바뀌었습니다. 해당 영상의 정보를 다시 가져오세요.';return;}
    if(($('#title').value.trim()||$('#description').value.trim())&&!window.confirm('작성 중인 제목·설명을 가져온 영상 정보로 바꿀까요? 해시태그와 직접 선택한 사진은 유지됩니다.'))return;
    $('#title').value=video.title;$('#description').value=video.description;
    for(const id of ['title','description'])$('#'+id).dispatchEvent(new Event('input',{bubbles:true}));
    state.importedPhoto=safePreview(video.thumbnail?.preview)?{...video.thumbnail,youtubeUrl:video.url}:null;state.pending=null;box.hidden=true;renderFiles();updateX();renderPreview();
    $('#youtube-feedback').classList.add('success-feedback');$('#youtube-feedback').textContent='적용했습니다. 제목·설명·사진을 검토하고 수정한 뒤 링크 소개를 준비하세요.';
  });
  detail.append(apply);box.append(detail);
}
$('#import-youtube').addEventListener('click',async()=>{
  $('#youtube-feedback').classList.remove('success-feedback');const source=parseYouTubeUrl($('#youtube-url').value);if(!source){$('#youtube-feedback').textContent=IMPORT_ERRORS.invalid_youtube_url;return;}
  if(importing||!backendStatus?.authenticated)return;
  const sequence=++importSequence;state.pending=null;$('#import-result').hidden=true;importing=true;$('#import-youtube').disabled=true;$('#youtube-feedback').textContent='유튜브 정보 가져오는 중…';
  try{
    const response=await fetch('/api/admin/youtube/import',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':backendStatus.csrfToken},body:JSON.stringify({url:source.url})});
    let data;try{data=await response.json();}catch{throw Error(IMPORT_ERRORS.youtube_fetch_failed);}
    if(response.status===401){window.dispatchEvent(new Event('sns-auth-expired'));throw Error('로그인이 만료됐습니다. 다시 로그인하세요.');}
    if(!response.ok)throw Error(IMPORT_ERRORS[data.error]||'정보를 가져오지 못했습니다. 기존 입력은 유지됩니다.');
    if(sequence!==importSequence||currentUrl()!==source.url)return;
    const video=data.video;if(video?.url!==source.url||typeof video.title!=='string'||typeof video.description!=='string')throw Error(IMPORT_ERRORS.youtube_fetch_failed);
    state.pending=video;renderImport(video);$('#youtube-feedback').classList.add('success-feedback');$('#youtube-feedback').textContent='가져온 내용을 확인하고 적용하세요. 현재 작성 중인 내용은 아직 바뀌지 않았습니다.';
  }catch(e){if(sequence===importSequence)$('#youtube-feedback').textContent=e.message;}
  finally{importing=false;$('#import-youtube').disabled=!backendStatus?.authenticated||!backendStatus.youtubeImportReady;}
});
function renderChannels(){
  $('#selected-count').textContent=state.channels.size+'개 선택';
  $('#channel-grid').replaceChildren(...CHANNELS.map(channel=>{
    const selectable=['facebook','x','blog'].includes(channel.id),selected=state.channels.has(channel.id);
    const button=node('button','channel-card '+(selected?'selected':''));button.type='button';button.dataset.channel=channel.id;button.disabled=!selectable;button.setAttribute('aria-label',channel.name);button.setAttribute('aria-pressed',String(selected));
    const icon=node('span','channel-icon '+channel.id,channel.initial);icon.setAttribute('aria-hidden','true');const info=node('span','channel-info');info.append(node('strong','',channel.name),node('span','',channel.account),node('small','',channelLabel(channel.id)));button.append(icon,info,node('span','channel-check',selected?'✓':''));
    button.addEventListener('click',()=>{selected?state.channels.delete(channel.id):state.channels.add(channel.id);renderChannels();renderPreview();clearDraftFeedback();});return button;
  }));
}
function renderPreview(){
  $('#preview-tabs').replaceChildren(...CHANNELS.map((channel,index)=>{
    const tab=node('button','preview-tab '+(state.active===channel.id?'active':''),channel.name);tab.type='button';tab.id='tab-'+channel.id;tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(state.active===channel.id));tab.setAttribute('aria-controls','preview-content');tab.tabIndex=state.active===channel.id?0:-1;
    tab.addEventListener('click',()=>{state.active=channel.id;renderPreview();});tab.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?4:(index+(e.key==='ArrowRight'?1:-1)+5)%5;state.active=CHANNELS[next].id;renderPreview();$('#tab-'+state.active).focus();});return tab;
  }));
  const channel=CHANNELS.find(c=>c.id===state.active);$('#preview-content').hidden=false;$('#preview-content').setAttribute('aria-labelledby','tab-'+channel.id);
  for(const [selector,value]of Object.entries({'#preview-account':channel.account,'#preview-channel-name':channel.name,'#detail-name':channel.name,'#detail-account':channel.account,'#detail-format':channel.format,'#detail-status':channelLabel(channel.id),'#detail-job-status':channelStates.get(channel.id)||'작업 기록 없음','#preview-avatar':channel.initial}))$(selector).textContent=value;
  const title=$('#title').value.trim(),description=$('#description').value.trim(),url=currentUrl(),media=$('#preview-media');media.replaceChildren();media.dataset.kind='link';media.dataset.channel=channel.id;
  const picture=channel.id==='blog'&&state.images[0]?state.images[0].url:state.importedPhoto?.youtubeUrl===url?state.importedPhoto.preview:null;
  if(channel.id==='instagram'){
    const hint=node('div','media-placeholder');hint.append(node('span','','◎'),node('p','','별도 화면에서 설명을 복사하고\nMeta Business Suite에서 파일을 선택합니다.'));media.append(hint);
  }else{
    if(picture){const img=node('img');img.src=picture;img.alt=title||'소개 사진';media.append(img);}else{const hint=node('div','media-placeholder');hint.append(node('span','','▶'),node('p','','유튜브 원본 링크'));media.append(hint);}
    if(url){const a=node('a','youtube-preview-link','유튜브 본편 보기 ↗');a.href=url;a.target='_blank';a.rel='noopener noreferrer';media.append(a);}
  }
  $('#preview-title').textContent=title||'제목을 입력하세요';$('#preview-description').textContent=channel.id==='x'?$('#x-text').value||'X 소개 문구를 입력하세요':description||'설명을 입력하세요';$('#preview-tags').textContent=channel.id==='x'?url||'':state.tags.map(t=>'#'+t).join(' ');
  $('#preview-warning').textContent=channel.id==='instagram'?'Instagram은 이번 링크 전송에서 제외됩니다. 준비 도우미의 복사·열기 기능으로 별도 게시하세요.':channel.id==='youtube'?'이미 YouTube에 올린 본편을 소개합니다. 여기서 YouTube 업로드를 실행하지 않습니다.':channel.id==='x'&&!backendStatus?.channels?.x?.configured?'X 연결 설정이 필요합니다. 미리보기·원고 준비는 가능하며 전송은 연결 후 진행합니다.':'실제 링크 카드 이미지는 플랫폼에 따라 달라질 수 있습니다.';
  $('#blog-note').hidden=channel.id!=='blog';$('#copy-blog').hidden=channel.id!=='blog';
}
$('#copy-blog').addEventListener('click',async()=>{try{await navigator.clipboard.writeText([$('#title').value,$('#description').value,currentUrl(),state.tags.map(t=>'#'+t).join(' ')].filter(Boolean).join('\n\n'));toast('원고를 복사했습니다. 네이버에서 최종 게시하세요.');}catch{toast('미리보기의 텍스트를 선택해 복사하세요.');}});
$('#check-draft').addEventListener('click',()=>{
  const issues=draftIssues({title:$('#title').value,description:$('#description').value,youtubeUrl:$('#youtube-url').value,channels:state.channels,xText:$('#x-text').value});
  const box=$('#draft-feedback');box.replaceChildren();if(issues.length){const list=node('ul');issues.forEach(text=>list.append(node('li','',text)));box.append(node('strong','','준비할 항목'),list);}else box.append(node('strong','','링크 소개 입력이 준비됐습니다.'),node('p','','서버 작업을 준비한 뒤 선택한 작업의 전송을 명시적으로 확인하세요.'));
});
$('.ig-helper-link').addEventListener('click',event=>{
  event.preventDefault();
  const helper=window.open('about:blank','_blank');if(!helper){toast('팝업이 차단됐습니다. 팝업 허용 후 준비 도우미를 다시 여세요.');return;}
  helper.opener=null;
  try{helper.sessionStorage.setItem('spymedia_instagram_draft',JSON.stringify({title:$('#title').value,description:$('#description').value,tags:state.tags}));}catch{}
  helper.location.replace($('.ig-helper-link').href);
});
$('#logout-button').addEventListener('click',async()=>{try{const r=await fetch('/api/admin/logout',{method:'POST',headers:{'X-CSRF-Token':backendStatus?.csrfToken||''}});if(!r.ok)throw Error();location.replace('/admin/login');}catch{toast('로그아웃을 확인하지 못했습니다. 다시 시도하세요.');}});
window.addEventListener('sns-job-status',e=>{const labels={converting:'규격 변환 중',prepared:'전송 준비',queued:'전송 대기',publishing:'전송 확인 중',succeeded:'완료',failed:'실패',unknown:'결과 확인 필요'};channelStates.clear();for(const job of e.detail)if(!channelStates.has(job.channel))channelStates.set(job.channel,'최근 작업: '+labels[job.status]);renderChannels();renderPreview();});
window.addEventListener('beforeunload',()=>state.images.forEach(m=>URL.revokeObjectURL(m.url)));
try{
  const r=await fetch('/api/admin/status',{cache:'no-store'});if(!r.ok)throw Error();backendStatus=await r.json();const preview=backendStatus.mode==='preview';
  if(!preview&&!backendStatus.authenticated)location.replace('/admin/login?reason=session_expired');
  $('#mode-label').textContent=preview?'로컬 미리보기':'관리자 세션';$('#mode-note').textContent=preview?'로컬 화면 시안입니다. 실제 API 정보 가져오기와 SNS 전송은 실행되지 않습니다.':'YouTube 정보를 가져와 검토한 뒤 Facebook·X 링크 소개와 블로그 원고를 준비하세요. 영상 변환은 사용하지 않습니다.';
  $('#import-youtube').disabled=!backendStatus.authenticated||!backendStatus.youtubeImportReady;
  $('#leave-link').hidden=!preview;$('#logout-button').hidden=preview;
  if(preview)$('.ig-helper-link').href='/admin/instagram/preview';
  attachServerUI(backendStatus,()=>({type:'link',youtubeUrl:$('#youtube-url').value,title:$('#title').value,description:$('#description').value,tags:[...state.tags],xText:$('#x-text').value,channels:[...state.channels],mediaIds:state.importedPhoto?[state.importedPhoto.id]:[],photos:state.images.map(m=>m.file)}));
}catch{$('#mode-label').textContent='서버 확인 필요';$('#mode-note').textContent='서버 상태를 확인하지 못했습니다. 입력한 초안과 미리보기는 확인할 수 있습니다.';}
renderFiles();renderTags();updateX();renderChannels();renderPreview();
