import {parseYouTubeUrl} from './youtube-url.js';

const BLOG_URL='https://blog.naver.com/spymedia';
const ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ERRORS={authentication_required:'관리자 로그인이 만료됐습니다. 작성 중인 원고는 유지됩니다. 다시 로그인 후 저장하세요.',csrf_rejected:'관리자 로그인을 다시 확인하세요. 작성 중인 원고는 유지됩니다.',storage_unavailable:'저장소 연결이 필요합니다. 원고 복사와 내려받기는 계속 사용할 수 있습니다.',invalid_draft:'제목·본문·태그의 길이와 내용을 확인하세요.',invalid_youtube_url:'올바른 YouTube 영상 주소를 입력하세요.',invalid_media_selection:'사진은 최대 10장까지 선택할 수 있습니다.',blog_photos_only:'사진은 JPG·PNG·WebP, 한 장당 8MB 이하로 준비하세요.',photo_only:'JPG·PNG·WebP 사진만 저장할 수 있습니다.',photo_too_large:'사진은 한 장당 8MB 이하로 준비하세요.',file_too_large:'사진은 한 장당 8MB 이하로 준비하세요.',invalid_photo_dimensions:'사진은 가로·세로 4096px 이하, 총 1,600만 화소 이하로 준비하세요.',media_in_trash:'선택한 사진이 휴지통에 있습니다. 보관 콘텐츠에서 복원하세요.',job_in_trash:'같은 원고가 휴지통에 있습니다. 보관 콘텐츠에서 복원하세요.',upload_busy:'다른 사진을 저장 중입니다. 잠시 후 다시 시도하세요.',storage_full:'저장 공간이 부족합니다.',invalid_channel:'블로그 원고 저장 요청을 처리하지 못했습니다.'};
const text=value=>typeof value==='string'?value:'';
const node=(tag,content,className)=>{const n=document.createElement(tag);if(content!==undefined)n.textContent=content;if(className)n.className=className;return n;};
const button=(id,label,handler)=>{const n=node('button',label,'outline-button');n.type='button';if(id)n.id=id;if(handler)n.addEventListener('click',handler);return n;};
const tagList=value=>[...new Set((Array.isArray(value)?value.join(' '):text(value)).split(/[\s,]+/).map(t=>t.replace(/^#+/,'')).filter(Boolean))];

function originalUrl(value,id){
  if(typeof value!=='string'||!ID.test(id||''))return null;
  try{const u=new URL(value,location.origin);return u.origin===location.origin&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/api/admin/media/'+id?u.pathname:null;}catch{return null;}
}
function storedPreview(value,id){return ID.test(id||'')&&value==='/api/admin/media/'+id+'?preview=1'?value:null;}

export function attachBlogWorkspace(getDraft){
  const root=document.getElementById('blogWorkspace');
  if(!root)return {updateDraft(){},setStatus(){}};
  root.classList.add('blog-workspace');
  let status={},dirty=false,engaged=false,busy=false,refreshing=false,expired=false,photos=[],jobs=[],latestSource,sourceSignature='',revision=0,jobsVersion=0;
  const ownedPreviews=new Map(),uploadedFiles=new WeakMap();
  const header=node('div',undefined,'blog-heading'),intro=node('div');
  intro.append(node('p','NAVER BLOG','eyebrow'),node('h2','네이버 블로그 원고 작업실'),node('p','원고와 사진을 준비한 뒤 네이버에서 배치·검토하고 최종 발행하세요.','blog-hint'));
  const open=node('a','spymedia 블로그 열기 ↗','outline-button');open.id='blog-open';open.href=BLOG_URL;open.target='_blank';open.rel='noopener noreferrer';header.append(intro,open);
  const sourceNotice=node('p','','blog-source-notice');sourceNotice.id='blog-source-notice';sourceNotice.hidden=true;sourceNotice.setAttribute('role','status');
  const generate=button('blog-generate','공통정보로 원고 만들기',()=>generateDraft());
  const contextWrap=node('label',undefined,'blog-check'),context=node('input');context.id='blog-add-context';context.type='checkbox';contextWrap.append(context,document.createTextNode('지역·촬영 종류 추가'));
  const sourceActions=node('div',undefined,'blog-actions');sourceActions.append(generate,contextWrap);
  const layout=node('div',undefined,'blog-layout'),editor=node('div',undefined,'blog-editor'),previewPanel=node('div',undefined,'blog-preview-panel');
  function field(id,label,kind='input'){
    const wrap=node('div',undefined,'blog-field'),l=node('label',label),input=node(kind);input.id=id;l.htmlFor=id;wrap.append(l,input);editor.append(wrap);return input;
  }
  const title=field('blog-title','블로그 제목');title.maxLength=200;
  const body=field('blog-body','블로그 본문','textarea');body.rows=12;body.maxLength=5000;
  const counts=node('p','','blog-hint');counts.id='blog-counts';body.after(counts);
  const tags=field('blog-tags','해시태그');tags.placeholder='공백 또는 쉼표로 구분 · 최대 30개';
  const youtube=field('blog-youtube','YouTube 영상 주소 (선택)');youtube.type='url';youtube.placeholder='https://www.youtube.com/watch?v=…';
  const youtubeError=node('p','','blog-hint');youtubeError.id='blog-youtube-error';youtubeError.setAttribute('role','status');youtubeError.hidden=true;youtube.after(youtubeError);youtube.setAttribute('aria-describedby',youtubeError.id);
  editor.append(node('p','영상 주소와 해시태그는 복사용 본문 끝에 붙습니다. 본문 입력 내용은 그대로 유지됩니다.','blog-hint'));
  const previewLabel=node('label','네이버에 붙여넣을 본문');previewLabel.htmlFor='blog-preview';
  const preview=node('textarea');preview.id='blog-preview';preview.readOnly=true;preview.rows=15;preview.setAttribute('aria-label','네이버에 붙여넣을 본문 미리보기');
  const copyTitle=button('blog-copy-title','제목 복사',()=>{if(title.value.trim())copyText(title.value,'제목');});
  const copyBody=button('blog-copy-body','본문 복사',()=>{if(canCopyBody())copyText(composeBody(),'본문');});
  const download=button('blog-download-txt','전체 원고 TXT 내려받기',downloadText);
  const copyActions=node('div',undefined,'blog-actions');copyActions.append(copyTitle,copyBody,download);
  const fallback=node('div',undefined,'blog-copy-fallback');fallback.hidden=true;
  const fallbackLabel=node('label','자동 복사가 허용되지 않았습니다. 선택된 내용을 Ctrl+C 또는 길게 눌러 복사하세요.');fallbackLabel.htmlFor='blog-copy-fallback';
  const fallbackText=node('textarea');fallbackText.id='blog-copy-fallback';fallbackText.readOnly=true;fallback.append(fallbackLabel,fallbackText);
  previewPanel.append(previewLabel,preview,copyActions,fallback,node('p','네이버 편집기에서 제목과 본문을 붙여넣고, 아래 사진을 원하는 위치에 넣으세요. 저장 버튼은 이 작업실에 초안을 보관합니다.','blog-hint'));
  layout.append(editor,previewPanel);
  const photoSection=node('section',undefined,'blog-photo-section');photoSection.append(node('h3','블로그 사진'),node('p','공통정보에서 선택한 사진을 사용합니다. 순서 변경과 제외는 이 원고에만 적용됩니다.','blog-hint'));
  const photoList=node('ol');photoList.id='blog-photos';photoSection.append(photoList);
  const save=button('blog-save','원고와 사진 저장',saveDraft);save.classList.add('primary-button');
  const connection=node('span','','blog-hint');connection.id='blog-connection';const saveActions=node('div',undefined,'blog-actions');saveActions.append(save,connection);
  const feedback=node('p','','blog-feedback');feedback.id='blog-feedback';feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');
  const savedSection=node('section',undefined,'blog-saved'),savedHeader=node('div',undefined,'blog-heading');
  const refresh=button('blog-refresh','저장 목록 새로고침',refreshJobs);const jobList=node('div');jobList.id='blog-jobs';savedHeader.append(node('h3','저장한 블로그 원고'),refresh);savedSection.append(savedHeader,jobList);
  root.replaceChildren(header,sourceActions,sourceNotice,layout,photoSection,saveActions,feedback,savedSection);

  function source(){
    const d=getDraft()||{};
    return {title:text(d.title),description:text(d.description),tags:tagList(d.tags),region:text(d.region),shootType:text(d.shootType),youtubeUrl:text(d.youtubeUrl),photos:Array.isArray(d.photos)?d.photos.map((p,index)=>({key:text(p.key)||text(p.id)||'photo-'+index,file:p.file instanceof Blob?p.file:null,preview:text(p.preview),id:ID.test(p.id||'')?p.id:null,name:text(p.name)||text(p.file?.name)||'사진 '+(index+1)})):[]};
  }
  function signature(s){return JSON.stringify({...s,photos:s.photos.map(p=>({key:p.key,id:p.id,name:p.name,size:p.file?.size,modified:p.file?.lastModified}))});}
  function selected(list){const seen=new Set();return list.filter(p=>{const key=p.id||p.key;if(seen.has(key))return false;seen.add(key);return true;}).map(p=>({...p}));}
  function fill(d,withContext=false){
    title.value=d.title;body.value=d.description;tags.value=tagList(d.tags).map(t=>'#'+t).join(' ');youtube.value=d.youtubeUrl||'';
    if(withContext){const lines=[];if(d.region)lines.push('촬영 지역: '+d.region);if(d.shootType)lines.push('촬영 종류: '+d.shootType);if(lines.length)body.value=[body.value,lines.join('\n')].filter(Boolean).join('\n\n');}
    photos=selected(d.photos||[]);revision++;sourceNotice.hidden=true;renderPreview();renderPhotos();
  }
  function updateDraft(){
    latestSource=source();const next=signature(latestSource);
    if(next===sourceSignature)return;
    sourceSignature=next;
    if(!engaged&&!dirty)fill(latestSource);
    else{sourceNotice.textContent='공통정보가 변경됐습니다. 현재 블로그 원고와 사진 선택은 유지됩니다. 새 공통정보를 반영하려면 “공통정보로 원고 만들기”를 누르세요.';sourceNotice.hidden=false;}
  }
  function generateDraft(){
    if((dirty||engaged)&&!window.confirm('현재 블로그 원고와 사진 선택을 공통정보로 다시 만들까요? 작성 중인 수정 내용은 바뀝니다.'))return;
    latestSource=source();sourceSignature=signature(latestSource);fill(latestSource,context.checked);dirty=true;engaged=true;feedback.textContent='공통정보의 원문으로 원고를 만들었습니다. 내용을 검토하고 수정하세요.';
  }
  function composeBody(){const url=parseYouTubeUrl(youtube.value)?.url;return [body.value,url,tagList(tags.value).map(t=>'#'+t).join(' ')].filter(Boolean).join('\n\n');}
  function invalidYouTube(){return !!youtube.value.trim()&&!parseYouTubeUrl(youtube.value);}
  function canCopyBody(){return !!body.value.trim()&&!invalidYouTube();}
  function renderPreview(){
    preview.value=composeBody();counts.textContent='제목 '+title.value.length+' / 200자 · 본문 '+body.value.length+' / 5,000자 · 태그 '+tagList(tags.value).length+' / 30개';
    const invalid=invalidYouTube();youtubeError.hidden=!invalid;youtubeError.textContent=invalid?'YouTube 주소를 확인하세요. 현재 주소는 미리보기에 포함되지 않습니다. 주소를 수정하거나 지우면 본문 복사와 TXT 내려받기를 사용할 수 있습니다.':'';youtube.setAttribute('aria-invalid',String(invalid));
    copyTitle.disabled=!title.value.trim();copyBody.disabled=!canCopyBody();download.disabled=!title.value.trim()||!canCopyBody();
  }
  function edited(){dirty=true;engaged=true;revision++;renderPreview();if(busy)feedback.textContent='저장 시작 시점의 원고와 사진을 저장하고 있습니다. 이후 수정 내용은 다음 저장에 반영됩니다.';}
  [title,body,tags,youtube].forEach(input=>input.addEventListener('input',edited));
  function previewFor(photo){
    if(photo.file){if(!ownedPreviews.has(photo.file))ownedPreviews.set(photo.file,URL.createObjectURL(photo.file));return ownedPreviews.get(photo.file);}
    return storedPreview(photo.preview,photo.id);
  }
  function renderPhotos(){
    photoList.replaceChildren();
    if(!photos.length){photoList.append(node('li','선택한 사진이 없습니다. 글만 저장할 수도 있습니다.','blog-empty'));return;}
    photos.forEach((photo,index)=>{
      const row=node('li',undefined,'blog-photo');row.dataset.photoKey=photo.key;
      const imageUrl=previewFor(photo);if(imageUrl){const img=node('img');img.src=imageUrl;img.alt=photo.name;img.loading='lazy';row.append(img);}
      const detail=node('div',undefined,'blog-photo-detail');detail.append(node('strong',(index+1)+'. '+photo.name));
      const actions=node('div',undefined,'blog-actions');
      const move=(offset)=>{const other=index+offset;if(other<0||other>=photos.length)return;[photos[index],photos[other]]=[photos[other],photos[index]];edited();renderPhotos();};
      const up=button(null,'위로',()=>move(-1));up.disabled=index===0;up.setAttribute('aria-label',photo.name+' 위로');
      const down=button(null,'아래로',()=>move(1));down.disabled=index===photos.length-1;down.setAttribute('aria-label',photo.name+' 아래로');
      const remove=button(null,'제외',()=>{photos.splice(index,1);edited();renderPhotos();});remove.setAttribute('aria-label',photo.name+' 제외');actions.append(up,down,remove);
      const url=photo.file?imageUrl:originalUrl(photo.download||'/api/admin/media/'+photo.id,photo.id);
      if(url){const a=node('a','원본 내려받기');a.href=url;a.download=photo.name;a.className='blog-download';actions.append(a);}
      detail.append(actions);row.append(detail);photoList.append(row);
    });
  }
  async function copyText(value,label){
    const copiedRevision=revision;
    try{await navigator.clipboard.writeText(value);fallback.hidden=true;feedback.textContent=copiedRevision===revision?label+'을 복사했습니다.':'복사를 시작할 때의 '+label+'을 복사했습니다. 이후 수정한 내용을 반영하려면 다시 복사하세요.';}
    catch{fallback.hidden=false;fallbackText.value=value;fallbackText.focus();fallbackText.select();feedback.textContent=copiedRevision===revision?'복사할 '+label+'을 선택했습니다. 직접 복사하세요.':'복사를 시작할 때의 '+label+'을 선택했습니다. 이후 수정한 내용을 반영하려면 다시 복사를 누르세요.';}
  }
  function downloadText(){
    if(!title.value.trim()||!canCopyBody())return;
    const value=[title.value,composeBody()].filter(Boolean).join('\n\n');const url=URL.createObjectURL(new Blob(['\ufeff'+value],{type:'text/plain;charset=utf-8'}));
    const a=node('a');a.href=url;a.download=(title.value.trim().replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,80)||'네이버-블로그-원고')+'.txt';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);feedback.textContent='전체 원고를 TXT 파일로 내려받았습니다.';
  }
  function canRead(){return status.authenticated===true&&!expired&&status.mode!=='preview';}
  function renderConnection(){
    save.disabled=busy||!canRead()||!status.uploadsConnected;refresh.disabled=busy||refreshing||!canRead();
    connection.textContent=busy?'저장 시작 시점의 원고와 사진을 보관하고 있습니다.':expired?'다시 로그인하면 저장할 수 있습니다.':!canRead()?'로그인하면 원고를 저장할 수 있습니다.':!status.uploadsConnected?'저장소 연결이 필요합니다.':'저장한 원고는 네이버에서 직접 최종 발행합니다.';
  }
  function expire(){expired=true;renderConnection();feedback.textContent=ERRORS.authentication_required;}
  window.addEventListener('sns-auth-expired',expire);
  async function api(route,method='GET',payload,headers={}){
    let response,data;try{response=await fetch('/api/admin/'+route,{method,headers:{...(method==='GET'?{}:{'X-CSRF-Token':status.csrfToken||''}),...(payload!==undefined&&!headers['Content-Type']?{'Content-Type':'application/json'}:{}),...headers},body:payload===undefined?undefined:headers['Content-Type']?payload:JSON.stringify(payload)});try{data=await response.json();if(!data||typeof data!=='object')data={};}catch{data={};}}catch{throw new Error('서버에 연결하지 못했습니다. 원고는 유지됩니다. 잠시 후 다시 시도하세요.');}
    if(response.status===401||(response.status===403&&data.error==='csrf_rejected')){window.dispatchEvent(new CustomEvent('sns-auth-expired'));throw new Error(ERRORS.authentication_required);}
    if(!response.ok||data.error)throw new Error(ERRORS[data.error]||'요청을 완료하지 못했습니다. 원고는 유지됩니다. 잠시 후 다시 시도하세요.');
    return data;
  }
  function validate(s){
    if(!s.title.trim()||!s.description.trim())return '제목과 본문을 입력하세요.';
    if(s.title.length>200||s.description.length>5000)return '제목은 200자, 본문은 5,000자 이하로 작성하세요.';
    if(s.tags.length>30||s.tags.some(t=>t.length>60||/[\s#<>\x00-\x1f]/.test(t)))return '태그는 30개 이하, 각각 60자 이하로 입력하고 # 이외의 특수 기호를 확인하세요.';
    if(s.youtubeUrl&&!parseYouTubeUrl(s.youtubeUrl))return ERRORS.invalid_youtube_url;
    if(s.photos.length>10)return ERRORS.invalid_media_selection;
    if(s.photos.some(p=>!p.id&&(!p.file||!['image/jpeg','image/png','image/webp'].includes(p.file.type)||p.file.size>8*1024**2||p.file.size<1)))return ERRORS.blog_photos_only;
    return '';
  }
  async function saveDraft(){
    if(busy||!canRead()||!status.uploadsConnected)return;
    const snapshot={title:title.value,description:body.value,tags:tagList(tags.value),youtubeUrl:youtube.value.trim(),photos:photos.map(p=>({...p}))},savedRevision=revision;
    const issue=validate(snapshot);if(issue){feedback.textContent=issue;return;}
    busy=true;engaged=true;renderConnection();feedback.textContent='저장 시작 시점의 원고와 사진을 저장하고 있습니다…';
    try{
      const ids=[];
      for(const photo of snapshot.photos){
        let id=photo.id||uploadedFiles.get(photo.file);
        if(!id){const result=await api('media','POST',photo.file,{'Content-Type':photo.file.type,'X-Upload-Name':encodeURIComponent(photo.name)});id=result.media?.id;if(!ID.test(id||''))throw new Error('사진 저장 결과를 확인하지 못했습니다. 원고는 유지됩니다.');uploadedFiles.set(photo.file,id);}
        if(!ids.includes(id))ids.push(id);
      }
      const result=await api('jobs','POST',{type:'blog-draft',channels:['blog'],title:snapshot.title,description:snapshot.description,tags:snapshot.tags,youtubeUrl:snapshot.youtubeUrl?parseYouTubeUrl(snapshot.youtubeUrl).url:'',mediaIds:ids});
      if(!Array.isArray(result.jobs))throw new Error('저장 결과를 확인하지 못했습니다. 목록을 새로고침하세요.');
      jobsVersion++;jobs=[...result.jobs,...jobs.filter(j=>!result.jobs.some(created=>created.id===j.id))];renderJobs();
      if(savedRevision===revision){dirty=false;feedback.textContent='원고와 사진을 저장했습니다. 네이버 블로그에서 붙여넣고 최종 발행하세요.';}
      else feedback.textContent='저장 시작 시점의 원고와 사진을 저장했습니다. 이후 수정한 현재 내용은 아직 저장되지 않았습니다.';
    }catch(e){feedback.textContent=e.message;}finally{busy=false;renderConnection();}
  }
  async function refreshJobs(){
    if(!canRead()||refreshing)return;const version=jobsVersion;refreshing=true;renderConnection();
    try{const result=await api('jobs');if(version===jobsVersion){jobs=Array.isArray(result.jobs)?result.jobs:[];renderJobs();}}catch(e){feedback.textContent=e.message;}finally{refreshing=false;renderConnection();}
  }
  function loadJob(job){
    if((dirty||engaged)&&!window.confirm('현재 작업실의 원고와 사진 선택을 저장한 원고로 바꿀까요?'))return;
    const saved=job.blogDraft;const originals=Array.isArray(job.originals)?job.originals:[],sources=Array.isArray(job.sourceMedia)?job.sourceMedia:[],assets=Array.isArray(job.assets)?job.assets:[];
    const media=originals.map((p,i)=>{const src=sources.find(s=>s.id===p.id)||sources[i],asset=assets.find(s=>s.id===p.id);return {key:p.id,id:p.id,name:text(src?.name)||'사진 '+(i+1),download:originalUrl(p.download,p.id),preview:storedPreview(asset?.preview,p.id),file:null};}).filter(p=>p.download);
    fill({title:text(saved?.title)||text(job.title),description:saved?text(saved.description):text(job.manuscript)||text(job.caption),tags:saved?.tags||[],youtubeUrl:saved?text(saved.youtubeUrl):'',photos:media});
    dirty=false;engaged=true;feedback.textContent='저장한 원고를 불러왔습니다. 수정 후 저장하면 별도 원고로 보관됩니다.';title.focus();
  }
  function renderJobs(){
    const visible=jobs.filter(j=>j.channel==='blog'&&['blog-draft','link'].includes(j.type)&&!j.trashedAt);jobList.replaceChildren();
    if(!visible.length){jobList.append(node('p',canRead()?'저장한 블로그 원고가 없습니다.':'로그인 후 저장한 원고를 확인할 수 있습니다.','blog-empty'));return;}
    visible.forEach(job=>{
      const card=node('article',undefined,'blog-saved-card');card.dataset.jobId=text(job.id);card.append(node('h4',text(job.title)||'제목 없음'));
      const date=new Date(job.createdAt);card.append(node('p',(Number.isNaN(date.getTime())?'저장 날짜 없음':date.toLocaleString('ko-KR'))+' · '+(job.type==='blog-draft'?'블로그 초안':'링크 소개 원고'),'blog-hint'));
      const excerpt=node('p',text(job.blogDraft?.description)||text(job.manuscript)||text(job.caption),'blog-saved-excerpt');card.append(excerpt);
      const actions=node('div',undefined,'blog-actions');const load=button(null,'원고 불러오기',()=>loadJob(job));actions.append(load);
      (Array.isArray(job.originals)?job.originals:[]).forEach((photo,index)=>{const url=originalUrl(photo.download,photo.id);if(!url)return;const a=node('a','원본 '+(index+1)+' 내려받기');a.href=url;a.download='';actions.append(a);});card.append(actions);jobList.append(card);
    });
  }
  function setStatus(next){const previous=canRead();status=next||{};if(status.authenticated===true&&status.csrfToken)expired=false;renderConnection();renderJobs();if(canRead()&&!previous)refreshJobs();}
  window.addEventListener('beforeunload',()=>{for(const url of ownedPreviews.values())URL.revokeObjectURL(url);});
  updateDraft();renderConnection();renderJobs();
  return {updateDraft,setStatus};
}
