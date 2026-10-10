import {composeCaption} from './domain.js';

const MAX_CAPTION_LENGTH=2200;
const $=id=>document.getElementById(id);

export function attachInstagramSuite(getDraft){
  const caption=$('instagram-suite-caption'),count=$('instagram-suite-count'),warning=$('instagram-suite-warning'),copy=$('instagram-suite-copy'),feedback=$('instagram-suite-feedback');
  let currentCaption='',copying=false;

  function updateDraft(){
    const draft=getDraft();
    const text=composeCaption(String(draft.title||''),String(draft.description||''),draft.tags||[]);
    if(text!==currentCaption){
      currentCaption=text;
      caption.value=text;
      feedback.textContent='';
      feedback.classList.remove('success-feedback');
    }
    const tooLong=text.length>MAX_CAPTION_LENGTH;
    count.textContent=text.length.toLocaleString('ko-KR')+' / 2,200자';
    count.classList.toggle('reels-error',tooLong);
    warning.classList.toggle('reels-error',tooLong);
    caption.setAttribute('aria-invalid',String(tooLong));
    warning.textContent=tooLong?'제목·설명·해시태그 합계를 2,200자 이하로 줄여 주세요.':!text?'위 콘텐츠 정보에 제목·설명·해시태그를 입력하면 게시 문구가 여기에 표시됩니다.':'';
    copy.disabled=copying||!text||tooLong;
  }

  copy.addEventListener('click',async()=>{
    updateDraft();
    if(copy.disabled)return;
    const copiedCaption=currentCaption;
    copying=true;
    copy.disabled=true;
    feedback.textContent='';
    feedback.classList.remove('success-feedback');
    try{
      await navigator.clipboard.writeText(copiedCaption);
      if(copiedCaption!==currentCaption){
        feedback.textContent='복사하는 동안 문구가 바뀌었습니다. 현재 문구를 다시 복사하세요.';
      }else{
        feedback.textContent='문구를 복사했습니다. Meta Business Suite에서 원본 영상을 선택하고 붙여넣으세요.';
        feedback.classList.add('success-feedback');
      }
    }catch{
      caption.focus();
      caption.select();
      caption.setSelectionRange(0,caption.value.length);
      feedback.textContent='자동 복사를 사용할 수 없습니다. 선택된 문구를 Ctrl+C 또는 ⌘C로 복사하세요. 모바일에서는 문구를 길게 눌러 복사하세요.';
    }finally{
      copying=false;
      updateDraft();
    }
  });

  updateDraft();
  return {updateDraft};
}
