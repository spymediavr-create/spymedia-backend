import {CHANNELS, MAX_IMAGES, validateMedia, parseTags, recommendTags, composeCaption, draftIssues, formatBytes} from './domain.js';
import {attachServerUI} from './server-ui.js';

const $ = selector => document.querySelector(selector);
const state = {video: null, images: [], imageIndex: 0, tags: [], suggestions: [], channels: new Set(['instagram', 'facebook']), active: 'instagram', media: 'image'};
let toastTimer;
let backendStatus;
const channelStates=new Map();
function channelLabel(id){if(id==='blog')return '원고 준비 · 반자동';return channelStates.get(id)|| (backendStatus?.channels?.[id]?.configured?'계정 검증 대기':'연결 전');}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 2800);
}
function clearDraftFeedback() { $('#draft-feedback').replaceChildren(); }
function revoke(media) { if (media) URL.revokeObjectURL(media.url); }
function removeVideo() { revoke(state.video); state.video = null; $('#video-input').value = ''; $('#video-error').textContent = ''; renderFiles(); renderPreview(); clearDraftFeedback(); }
function removeImage(index) { revoke(state.images[index]); state.images.splice(index, 1); state.imageIndex = Math.min(state.imageIndex, Math.max(0, state.images.length - 1)); $('#image-input').value = ''; $('#image-error').textContent = ''; renderFiles(); renderPreview(); clearDraftFeedback(); }

async function chooseVideo(files) {
  const file = files[0];
  if (!file) return;
  const error = validateMedia(file, 'video');
  $('#video-error').textContent = error;
  $('#video-input').value = '';
  if (error) return;
  revoke(state.video);
  state.video = {file, url: URL.createObjectURL(file)};
  state.media = 'video';
  renderFiles(); renderPreview(); clearDraftFeedback();
}
async function chooseImages(files) {
  if (!files.length) return;
  const errors = [];
  const seen = new Set(state.images.map(item => `${item.file.name}:${item.file.size}:${item.file.lastModified}`));
  for (const file of files) {
    const error = validateMedia(file, 'image');
    if (error) { errors.push(`${file.name}: ${error}`); continue; }
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (seen.has(key)) { errors.push(`${file.name}: 이미 선택한 이미지입니다.`); continue; }
    if (state.images.length >= MAX_IMAGES) { errors.push('이미지는 최대 10장까지 선택할 수 있습니다.'); break; }
    state.images.push({file, url: URL.createObjectURL(file)}); seen.add(key);
  }
  $('#image-input').value = '';
  $('#image-error').textContent = errors.join(' ');
  if (state.images.length) state.media = 'image';
  renderFiles(); renderPreview(); clearDraftFeedback();
}

function fileRow(media, kind, index) {
  const row = element('div', 'file-row');
  if (kind === 'image') {
    const thumbnail = element('img', 'file-thumbnail'); thumbnail.src = media.url; thumbnail.alt = '';
    const show = element('button', 'show-image'); show.type = 'button'; show.setAttribute('aria-label', `${media.file.name} 미리보기`); show.append(thumbnail);
    show.addEventListener('click', () => { state.imageIndex = index; state.media = 'image'; renderPreview(); }); row.append(show);
  } else row.append(element('span', 'file-thumbnail video-thumbnail', '▶'));
  const detail = element('div', 'file-detail');
  detail.append(element('strong', '', media.file.name), element('span', '', `${formatBytes(media.file.size)} · 로컬 선택`));
  const remove = element('button', 'remove-file', '×'); remove.type = 'button'; remove.setAttribute('aria-label', kind === 'video' ? '영상 삭제' : `${media.file.name} 삭제`);
  remove.addEventListener('click', () => kind === 'video' ? removeVideo() : removeImage(index));
  row.append(detail, remove); return row;
}
function renderFiles() {
  $('#video-file').replaceChildren(...(state.video ? [fileRow(state.video, 'video')] : []));
  $('#image-files').replaceChildren(...state.images.map((media, index) => fileRow(media, 'image', index)));
}

for (const kind of ['video', 'image']) {
  const input = $(`#${kind}-input`);
  const choose = kind === 'video' ? chooseVideo : chooseImages;
  input.addEventListener('change', () => choose([...input.files]));
  const drop = $(`#${kind}-drop`);
  drop.addEventListener('dragover', event => { event.preventDefault(); drop.classList.add('dragging'); });
  drop.addEventListener('dragleave', event => { if (!drop.contains(event.relatedTarget)) drop.classList.remove('dragging'); });
  drop.addEventListener('drop', event => { event.preventDefault(); drop.classList.remove('dragging'); choose([...event.dataTransfer.files]); });
  drop.querySelector('.drop-zone').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input.click(); } });
}

function renderTags() {
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

function renderChannels() {
  $('#selected-count').textContent = `${state.channels.size}개 선택`;
  $('#channel-grid').replaceChildren(...CHANNELS.map(channel => {
    const button = element('button', `channel-card ${state.channels.has(channel.id) ? 'selected' : ''}`); button.type = 'button'; button.dataset.channel = channel.id;
    button.setAttribute('aria-label', channel.name); button.setAttribute('aria-pressed', String(state.channels.has(channel.id)));
    const icon = element('span', `channel-icon ${channel.id}`, channel.initial); icon.setAttribute('aria-hidden', 'true');
    const info = element('span', 'channel-info'); info.append(element('strong', '', channel.name), element('span', '', channel.account), element('small', '', channelLabel(channel.id)));
    const check = element('span', 'channel-check', state.channels.has(channel.id) ? '✓' : ''); check.setAttribute('aria-hidden', 'true');
    button.append(icon, info, check);
    button.addEventListener('click', () => {
      if (state.channels.has(channel.id)) state.channels.delete(channel.id); else { state.channels.add(channel.id); state.active = channel.id; }
      if (!state.channels.has(state.active)) state.active = CHANNELS.find(item => state.channels.has(item.id))?.id || null;
      renderChannels(); renderPreview(); clearDraftFeedback();
    }); return button;
  }));
}
function setMediaPreference(kind) { state.media = kind; renderPreview(); }
document.querySelectorAll('[data-media]').forEach(button => button.addEventListener('click', () => setMediaPreference(button.dataset.media)));

function renderPreview() {
  const selected = CHANNELS.filter(channel => state.channels.has(channel.id));
  $('#preview-tabs').replaceChildren(...selected.map(channel => {
    const tab = element('button', `preview-tab ${state.active === channel.id ? 'active' : ''}`, channel.name); tab.type = 'button'; tab.id = `tab-${channel.id}`;
    tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(state.active === channel.id)); tab.setAttribute('aria-controls', 'preview-content'); tab.tabIndex = state.active === channel.id ? 0 : -1;
    tab.addEventListener('click', () => { state.active = channel.id; renderPreview(); });
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const index = selected.findIndex(item => item.id === channel.id);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? selected.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + selected.length) % selected.length;
      state.active = selected[next].id; renderPreview(); $(`#tab-${state.active}`).focus();
    }); return tab;
  }));
  $('#preview-empty').hidden = !!selected.length; $('#preview-content').hidden = !selected.length;
  if (!selected.length) { $('#preview-media').replaceChildren(); return; }
  const channel = CHANNELS.find(item => item.id === state.active) || selected[0];
  $('#preview-content').setAttribute('aria-labelledby', `tab-${channel.id}`);
  for (const [selector, value] of Object.entries({'#preview-account':channel.account, '#preview-channel-name':channel.name, '#detail-name':channel.name, '#detail-account':channel.account, '#detail-format':channel.format, '#detail-status':channelLabel(channel.id), '#preview-avatar':channel.initial})) $(selector).textContent = value;
  const title = $('#title').value.trim(); const description = $('#description').value.trim();
  $('#preview-title').textContent = title || '제목을 입력하세요'; $('#preview-description').textContent = description || '입력한 설명이 여기에 표시됩니다.';
  $('#preview-tags').textContent = state.tags.map(tag => `#${tag}`).join(' ');
  const media = $('#preview-media'); media.replaceChildren(); media.dataset.channel = channel.id;
  const useVideo = channel.type === 'video' || (state.video && (!state.images.length || state.media === 'video'));
  media.dataset.kind = useVideo ? 'video' : 'image';
  $('#media-choice').hidden = channel.type === 'video' || !state.video || !state.images.length;
  document.querySelectorAll('[data-media]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.media === (useVideo ? 'video' : 'image'))));
  let warning = '';
  if (useVideo && state.video) {
    const video = element('video'); video.src = state.video.url; video.controls = true; video.preload = 'metadata'; video.playsInline = true; video.setAttribute('aria-label', '선택한 영상 미리보기');
    video.addEventListener('error', () => { if (video.isConnected) $('#preview-warning').textContent = '이 브라우저에서 영상 재생을 지원하지 않거나 파일이 손상되었습니다. 원본을 다시 확인하세요.'; });
    media.append(video);
  } else if (!useVideo && state.images.length) {
    const img = element('img'); img.src = state.images[state.imageIndex].url; img.alt = title || state.images[state.imageIndex].file.name;
    img.addEventListener('error', () => { if (img.isConnected) $('#preview-warning').textContent = '이미지를 읽지 못했습니다. 파일을 다시 선택하세요.'; });
    media.append(img);
    if (state.images.length > 1) {
      media.append(element('span', 'image-count', `${state.imageIndex + 1} / ${state.images.length}`));
      for (const [direction, label, glyph] of [[-1, '이전 이미지', '‹'], [1, '다음 이미지', '›']]) {
        const navigation = element('button', `image-navigation ${direction === -1 ? 'previous' : 'next'}`, glyph); navigation.type = 'button'; navigation.setAttribute('aria-label', label);
        navigation.addEventListener('click', () => { state.imageIndex = (state.imageIndex + direction + state.images.length) % state.images.length; renderPreview(); }); media.append(navigation);
      }
    }
  } else {
    const placeholder = element('div', 'media-placeholder'); placeholder.append(element('span', '', channel.type === 'video' ? '▷' : '▧'), element('p', '', channel.type === 'video' ? '영상을 선택하면 여기에 표시됩니다.' : '미디어를 선택하면 여기에 표시됩니다.')); media.append(placeholder);
    if (channel.type === 'video' && state.images.length) warning = '유튜브에는 영상이 필요합니다. 선택한 이미지는 다른 채널에서 확인할 수 있습니다.';
  }
  if (state.video && state.images.length && channel.type !== 'video') warning = '영상과 이미지는 각각 확인할 수 있습니다. 실제 전송 방식은 서버 연결 후 결정됩니다.';
  $('#preview-warning').textContent = warning; $('#preview-warning').hidden = !warning;
  const blog = channel.id === 'blog'; $('#blog-note').hidden = !blog; $('#copy-blog').hidden = !blog;
}
$('#copy-blog').addEventListener('click', async () => {
  const copy = composeCaption($('#title').value, $('#description').value, state.tags);
  if (!copy.trim()) { toast('제목 또는 설명을 입력한 후 원고를 복사하세요.'); return; }
  try { await navigator.clipboard.writeText(copy); toast('원고 텍스트를 복사했습니다. 이미지는 별도로 첨부하세요.'); } catch { toast('복사 권한이 없습니다. 미리보기에서 원고를 선택해 복사하세요.'); }
});
$('#check-draft').addEventListener('click', () => {
  const issues = draftIssues({title:$('#title').value,description:$('#description').value,video:state.video,images:state.images,channels:state.channels});
  const feedback = $('#draft-feedback'); feedback.replaceChildren();
  if (issues.length) { const list = element('ul'); issues.forEach(issue => list.append(element('li', '', issue))); feedback.append(element('strong', '', '준비할 항목'), list); }
  else feedback.append(element('strong', '', '로컬 미리보기 입력이 준비되었습니다.'), element('p', '', '파일은 전송되지 않았습니다. 계정 연결과 서버 변환·게시 검증이 남아 있습니다.'));
});
$('#logout-button').addEventListener('click', async () => {
  try { const response = await fetch('/api/admin/logout', {method:'POST',headers:{'X-CSRF-Token':backendStatus?.csrfToken||''}}); if (!response.ok) throw new Error('logout'); location.replace('/admin/login'); } catch { toast('로그아웃을 확인하지 못했습니다. 다시 시도하세요.'); }
});
window.addEventListener('beforeunload', () => { revoke(state.video); state.images.forEach(revoke); });
window.addEventListener('sns-job-status',event=>{
  const labels={converting:'규격 변환 중',prepared:'전송 준비',queued:'전송 대기',publishing:'전송 확인 중',succeeded:'완료',failed:'실패',unknown:'결과 확인 필요'};
  channelStates.clear();for(const job of event.detail)if(job.channel!=='blog'&&!channelStates.has(job.channel))channelStates.set(job.channel,labels[job.status]);renderChannels();renderPreview();
});
try {
  const response = await fetch('/api/admin/status', {cache:'no-store'}); if (!response.ok) throw new Error('status');
  const status = await response.json();
  backendStatus=status;
  if (status.mode !== 'preview' && !status.authenticated) location.replace('/admin/login');
  const preview = status.mode === 'preview';
  $('#mode-label').textContent = preview ? '로컬 미리보기' : '관리자 세션';
  $('#mode-note').textContent = preview ? '미리보기 모드입니다. 실제 계정 인증과 서버 업로드·자동 게시 기능은 연결 전입니다.' : status.uploadsConnected ? '관리자 로그인과 원본 보관·변환이 준비되었습니다. 채널별 전송 설정과 결과를 확인하세요.' : '관리자 로그인이 확인되었습니다. 원본 보관·변환 설정을 확인해야 전송을 준비할 수 있습니다.';
  attachServerUI(status,()=>({title:$('#title').value,description:$('#description').value,tags:[...state.tags],channels:[...state.channels],forChannel:channel=>channel==='youtube'||state.media==='video'&&state.video?[state.video?.file].filter(Boolean):state.images.map(m=>m.file)}));
  $('#leave-link').hidden = !preview; $('#logout-button').hidden = preview;
} catch { $('#mode-label').textContent = '서버 확인 실패'; $('#mode-note').textContent = '서버 상태를 확인하지 못했습니다. 로컬 화면만 확인할 수 있으며 인증·게시 상태는 알 수 없습니다.'; }
renderFiles(); renderTags(); renderChannels(); renderPreview();
