import {composeCaption,parseTags,recommendTags} from './domain.js';
const $=id=>document.getElementById(id);
try{
  const draft=JSON.parse(sessionStorage.getItem('spymedia_instagram_draft')||'null');
  if(draft&&typeof draft==='object'){
    $('ig-title').value=typeof draft.title==='string'?draft.title.slice(0,200):'';
    $('ig-description').value=typeof draft.description==='string'?draft.description.slice(0,2200):'';
    $('ig-tags').value=Array.isArray(draft.tags)?parseTags(draft.tags.filter(t=>typeof t==='string').join(' ')).map(t=>'#'+t).join(' '):'';
  }
}catch{}
function caption(){return composeCaption($('ig-title').value,$('ig-description').value,parseTags($('ig-tags').value));}
function render(){
  const text=caption(),photo=document.querySelector('[name=ig-kind]:checked').value==='photo';
  $('ig-caption').textContent=text||'설명과 해시태그가 여기에 표시됩니다.';
  $('ig-length').textContent=text.length+' / 2,200자'+(text.length>2200?' · 문구를 줄여 주세요.':'');
  $('ig-copy').disabled=!text||text.length>2200;
  $('ig-placeholder').classList.toggle('photo',photo);
  $('ig-placeholder').querySelector('strong').textContent=photo?'사진 · 게시물':'릴스 · 영상';
  $('ig-placeholder').querySelector('p').textContent=(photo?'사진':'영상')+'은 Meta Business Suite에서 선택하세요';
}
for(const id of ['ig-title','ig-description','ig-tags'])$(id).addEventListener('input',()=>{render();$('ig-feedback').textContent='';});
for(const radio of document.querySelectorAll('[name=ig-kind]'))radio.addEventListener('change',render);
$('ig-recommend').addEventListener('click',()=>{
  const suggested=recommendTags($('ig-title').value,$('ig-description').value);
  $('ig-tags').value=parseTags([...parseTags($('ig-tags').value),...suggested].join(' ')).map(t=>'#'+t).join(' ');render();
});
$('ig-copy').addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(caption());$('ig-feedback').classList.add('success-feedback');$('ig-feedback').textContent='복사했습니다. Meta Business Suite에서 붙여 넣어 주세요.';}catch{$('ig-feedback').classList.remove('success-feedback');$('ig-feedback').textContent='복사하지 못했습니다. 미리보기 문구를 선택해 복사하세요.';}
});
if(location.pathname.endsWith('/preview'))$('ig-back').href='/admin/preview';
render();
