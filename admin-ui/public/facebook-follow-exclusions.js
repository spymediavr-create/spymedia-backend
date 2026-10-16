import {searchResultUrl} from './search-result-url.js';

const ACCOUNT='61594869881531',ENDPOINT='/api/admin/facebook/follow-exclusions',PAGE_SIZE=20;
const SELF='https://www.facebook.com/profile.php?id='+ACCOUNT;
const RESERVED=new Set(['me','friends','notifications','messages','search','business','ads','policies','terms']);
const node=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;};
const normalizeProfile=value=>{const target=searchResultUrl('facebook',value);return target?.kind==='profile'&&target.url!==SELF&&!RESERVED.has(new URL(target.url).pathname.slice(1))?target.url:null;};

export function parseFacebookFollowExclusionInput(value){
  if(typeof value!=='string'||value.length>21000)return null;
  const values=value.split(/[\s,]+/).filter(Boolean);if(!values.length||values.length>10)return null;
  const profiles=[];
  for(const item of values){const profile=normalizeProfile(item);if(!profile)return null;if(!profiles.includes(profile))profiles.push(profile);}
  return profiles;
}

export function validFacebookFollowExclusionList(data){
  if(data?.account!==ACCOUNT||!Array.isArray(data.items)||data.items.length>10000)return false;
  const seen=new Set();
  for(const item of data.items){
    const profile=normalizeProfile(item?.profileUrl);
    if(!item||Object.keys(item).length!==3||!profile||profile!==item.profileUrl||item.state!=='following'||typeof item.confirmedAt!=='string'||!Number.isFinite(Date.parse(item.confirmedAt))||seen.has(profile))return false;
    seen.add(profile);
  }
  return true;
}

// Only confirmed profile relationships are durable. Search terms/results stay ephemeral.
export function attachFacebookFollowExclusions({mount,status}){
  const panel=node('details');panel.id='facebook-follow-exclusions';
  panel.append(node('summary','Facebook 검색 제외 계정 관리'),node('p','스파이미디어 Facebook 페이지에서 팔로잉으로 확인한 계정은 다음 검색에서 제외합니다. 기존에 직접 팔로우한 계정은 프로필 주소로 등록할 수 있습니다.','field-hint'));
  const form=node('form'),fields=node('fieldset'),label=node('label','이미 팔로잉인 Facebook 프로필 주소'),input=node('textarea');
  input.id='facebook-follow-exclusion-profiles';input.rows=3;input.maxLength=21000;input.placeholder='https://www.facebook.com/프로필주소 · 줄바꿈으로 구분 · 최대 10개';label.htmlFor=input.id;
  const add=node('button','Facebook 팔로잉 계정 제외 등록','outline-button');add.type='submit';fields.append(label,input,add);form.append(fields);
  const feedback=node('p');feedback.id='facebook-follow-exclusions-feedback';feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');
  const refresh=node('button','Facebook 제외 목록 새로고침','outline-button');refresh.type='button';
  const list=node('div'),pager=node('div',undefined,'candidate-actions'),prev=node('button','이전','outline-button'),next=node('button','다음','outline-button'),position=node('span');prev.type=next.type='button';pager.append(prev,position,next);
  panel.append(form,feedback,refresh,list,pager);mount.append(panel);
  let records=[],page=0,busy=false,expired=!status.authenticated,loaded=false,generation=0;
  const messages={invalid_follow_exclusion:'Facebook 프로필 주소와 확인된 상태를 확인하세요.',follow_exclusion_limit:'제외 기록 한도에 도달했습니다. 기존 목록을 확인하세요.',storage_unavailable:'제외 기록을 저장하지 못했습니다. 잠시 후 목록을 확인해 주세요.'};
  function controls(){fields.disabled=busy||expired;refresh.disabled=busy||expired;prev.disabled=busy||expired||page===0;next.disabled=busy||expired||(page+1)*PAGE_SIZE>=records.length;list.querySelectorAll('button').forEach(button=>button.disabled=busy||expired);}
  function render(){
    page=Math.min(page,Math.max(0,Math.ceil(records.length/PAGE_SIZE)-1));list.replaceChildren();
    for(const record of records.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE)){
      const row=node('div',undefined,'candidate-actions'),restore=node('button','검색에 다시 표시','outline-button');restore.type='button';restore.setAttribute('aria-label',record.profileUrl+' 검색에 다시 표시');
      row.append(node('p',record.profileUrl+' · 팔로잉','search-hint'),restore);list.append(row);
      restore.addEventListener('click',()=>run(async mine=>{const result=await api('DELETE',{account:ACCOUNT,profileUrl:record.profileUrl});if(expired||mine!==generation)return;if(typeof result?.removed!=='boolean')throw Error('제외 해제 응답을 확인하지 못했습니다. 목록을 새로고침해 주세요.');await load();if(!expired&&mine===generation)feedback.textContent='해당 Facebook 계정을 다음 검색부터 다시 표시합니다. Facebook 팔로우 상태는 변경하지 않습니다.';}));
    }
    if(!records.length)list.append(node('p',loaded?'등록된 Facebook 제외 계정이 없습니다.':'목록을 불러오면 확인할 수 있습니다.','field-hint'));
    position.textContent=`${records.length}개 제외 · ${page+1}/${Math.max(1,Math.ceil(records.length/PAGE_SIZE))}페이지`;pager.hidden=!records.length;controls();
  }
  async function api(method,body){
    const response=await fetch(ENDPOINT,{method,credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json','X-CSRF-Token':status.csrfToken}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});
    if(response.status===401){window.dispatchEvent(new Event('sns-auth-expired'));throw Error('관리자 로그인이 만료됐습니다. 다시 로그인해 주세요.');}
    const data=await response.json();
    if(response.status===403&&data?.error==='csrf_rejected'){window.dispatchEvent(new Event('sns-auth-expired'));throw Error('관리자 로그인이 만료됐습니다. 다시 로그인해 주세요.');}
    if(!response.ok)throw Error(messages[data?.error]||'제외 기록을 처리하지 못했습니다. 목록을 확인한 뒤 다시 시도해 주세요.');return data;
  }
  async function load(){const mine=generation,data=await api('GET');if(expired||mine!==generation)return;if(!validFacebookFollowExclusionList(data))throw Error('Facebook 제외 목록 응답을 확인하지 못했습니다.');records=data.items;loaded=true;render();}
  async function run(action){if(busy||expired)return;busy=true;const mine=generation;controls();feedback.textContent='Facebook 제외 기록 확인 중…';try{await action(mine);}catch(error){if(!expired&&mine===generation)feedback.textContent=error.name==='TimeoutError'?'응답이 늦어지고 있습니다. 목록 새로고침으로 저장 여부를 확인해 주세요.':error.message;}finally{busy=false;controls();}}
  form.addEventListener('submit',event=>{
    event.preventDefault();if(busy||expired)return;const profiles=parseFacebookFollowExclusionInput(input.value);
    if(!profiles){feedback.textContent='Facebook 프로필의 HTTPS 주소를 최대 10개 입력해 주세요. 게시물 주소와 자기 페이지는 등록할 수 없습니다.';return;}
    run(async mine=>{const result=await api('POST',{account:ACCOUNT,items:profiles.map(profileUrl=>({profileUrl,state:'following'}))});if(expired||mine!==generation)return;if(result?.saved!==profiles.length)throw Error('저장 응답을 확인하지 못했습니다. 목록 새로고침으로 저장 여부를 확인해 주세요.');input.value='';await load();if(!expired&&mine===generation)feedback.textContent=`${profiles.length}개 Facebook 계정을 다음 검색에서 제외하도록 등록했습니다.`;});
  });
  refresh.addEventListener('click',()=>run(async mine=>{await load();if(!expired&&mine===generation)feedback.textContent='Facebook 제외 목록을 새로고침했습니다.';}));
  panel.addEventListener('toggle',()=>{if(panel.open&&!loaded)run(async mine=>{await load();if(!expired&&mine===generation)feedback.textContent='Facebook 제외 목록을 확인했습니다.';});});
  prev.addEventListener('click',()=>{if(page>0){page--;render();}});next.addEventListener('click',()=>{if((page+1)*PAGE_SIZE<records.length){page++;render();}});
  window.addEventListener('sns-auth-expired',()=>{generation++;expired=true;records=[];input.value='';render();feedback.textContent='관리자 로그인이 만료됐습니다. 다시 로그인해 주세요.';});
  render();return panel;
}
