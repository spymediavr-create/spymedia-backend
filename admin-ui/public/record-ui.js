const make=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
let sequence=0;
function compactDate(value){
  const d=new Date(value);return value&&!Number.isNaN(d.getTime())?new Intl.DateTimeFormat('ko-KR',{year:'2-digit',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(d):'기록 없음';
}
export function createRecordRow({id,title,createdAt,channel,status,statusKey,check,className,expanded=false,onToggle,fillDetails}){
  const row=make('article');row.className=className+' record-item';row.dataset.id=id;row.dataset.status=statusKey||'';
  const header=make('div');header.className='record-header';
  check.classList.add('record-select');check.setAttribute('aria-label',title+' 선택');
  const date=make('time',compactDate(createdAt));date.className='record-date';
  if(createdAt&&!Number.isNaN(new Date(createdAt).getTime()))date.dateTime=createdAt;
  date.title='생성 '+(createdAt&&!Number.isNaN(new Date(createdAt).getTime())?new Date(createdAt).toLocaleString('ko-KR'):'기록 없음');
  const type=make('strong',channel);type.className='record-channel';
  const name=make('h3',title);name.className='record-title';name.title=title;
  const compactStatus={converting:'변환 중',publishing:'전송 중',unknown:'확인 필요'}[statusKey]||status;
  const state=make('span',compactStatus);state.className='record-state';state.title=status;
  const toggle=make('button','상세');toggle.type='button';toggle.className='record-toggle';toggle.setAttribute('aria-label',title+' 상세 펼치기');
  const details=make('div');details.className='record-details';details.id='record-detail-'+(++sequence);details.hidden=!expanded;
  toggle.setAttribute('aria-controls',details.id);
  let filled=false;
  function apply(open){
    details.hidden=!open;toggle.setAttribute('aria-expanded',String(open));toggle.textContent=open?'접기':'상세';
    toggle.setAttribute('aria-label',title+(open?' 상세 접기':' 상세 펼치기'));
    if(open&&!filled){fillDetails(details);filled=true;}
    if(!open)for(const media of details.querySelectorAll('video'))media.pause();
  }
  toggle.addEventListener('click',()=>{const open=details.hidden;onToggle(open);apply(open);});
  header.append(check,date,type,name,state,toggle);row.append(header,details);apply(expanded);
  return row;
}
