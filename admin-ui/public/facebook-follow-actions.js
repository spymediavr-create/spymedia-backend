import {searchResultUrl} from './search-result-url.js';

export const FACEBOOK_FOLLOW_ACTOR='61594869881531';
export const FACEBOOK_FOLLOW_NAME='스파이미디어';
export const FACEBOOK_FOLLOW_VERSION='0.1.0';
const RESULTS={followed:'팔로우 완료',following:'이미 팔로잉 · 건너뜀'};
const ERRORS={account_unverified:'Facebook 화면에서 실행 중인 페이지를 확인하지 못했습니다. 같은 브라우저 프로필에서 스파이미디어 페이지로 전환한 뒤 다시 확인하세요.',account_mismatch:'Facebook 실행 계정이 스파이미디어 페이지와 달라 중지했습니다. Facebook 오른쪽 위 계정 메뉴에서 스파이미디어 페이지로 전환하세요.',login_required:'Facebook 로그인이 필요합니다. 관리자와 같은 Chrome·Edge 프로필에서 로그인하고 스파이미디어 페이지로 전환하세요.',challenge:'Facebook 추가 인증 또는 활동 제한이 감지되어 중지했습니다.',wrong_profile:'열린 Facebook 프로필이 선택한 대상과 달라 중지했습니다.',ambiguous_profile:'선택한 Facebook 프로필의 팔로우 버튼을 명확히 확인하지 못해 중지했습니다.',unsupported_language:'Facebook 화면 언어 또는 버튼을 확인하지 못해 중지했습니다. 한국어·영어 화면에서 확인하세요.',uncertain:'클릭 이후 결과를 확정하지 못했습니다. 해당 Facebook 프로필에서 상태를 확인하세요.',browser_error:'Facebook 브라우저 동작을 확인하지 못해 중지했습니다.',job_lost:'작업이 만료되었거나 확장 도구가 재시작됐습니다.',job_exists:'기존 Facebook 작업이 열려 있습니다. 기존 작업을 중지하고 새 작업을 준비하세요.',expired:'선택한 대상의 유효 시간이 끝났습니다. 다시 검색하고 선택하세요.',not_confirmed:'실행 계정·대상의 확인 상태가 일치하지 않아 중지했습니다.',invalid_message:'Facebook 확장 도구 응답을 검증하지 못했습니다.',bridge_timeout:'Facebook 확장 도구 응답 시간이 초과됐습니다. 실제 Facebook 상태를 확인하세요.',extension_update:'Facebook 확장 도구 0.1.0 이상이 필요합니다. 아래 도구를 별도로 설치하고 관리자 화면을 새로고침하세요.'};
const node=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;};
const exact=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));

export function normalizeFacebookFollowSelection(current){
  const profiles=[];let invalid=0;
  for(const value of current.profiles||[]){const safe=searchResultUrl('facebook',value);if(!safe||safe.kind!=='profile'||safe.url==='https://www.facebook.com/profile.php?id='+FACEBOOK_FOLLOW_ACTOR){invalid++;continue;}if(!profiles.includes(safe.url))profiles.push(safe.url);}
  return {...current,profiles,invalid};
}

export function validateFacebookFollowJob(job,selected,action,prior){
  if(!exact(job,['expectedAccount','expectedName','profiles','expiresAt','index','started','running','terminalError','results'])||job.expectedAccount!==FACEBOOK_FOLLOW_ACTOR||job.expectedName!==FACEBOOK_FOLLOW_NAME||JSON.stringify(job.profiles)!==JSON.stringify(selected.profiles)||job.expiresAt!==selected.expiresAt||!Number.isInteger(job.index)||job.index<0||job.index>selected.profiles.length||typeof job.started!=='boolean'||typeof job.running!=='boolean'||job.terminalError!==null||!Array.isArray(job.results)||job.results.length!==job.index||job.results.some((result,index)=>!exact(result,['index','state'])||result.index!==index||!Object.hasOwn(RESULTS,result.state)))return false;
  if(action==='PREPARE')return !job.started&&!job.running&&job.index===0;
  if(action==='START')return job.started&&job.running&&job.index===0;
  return action==='STEP'&&!!prior&&job.started&&job.index===prior.index+1&&job.running===(job.index<selected.profiles.length)&&JSON.stringify(job.results.slice(0,-1))===JSON.stringify(prior.results);
}

// Only selected profile URLs and confirmed progress are held in this page's memory.
export function attachFacebookFollowActions({mount,status,getSelection,prefix}){
  const box=node('section',undefined,'follow-actions');box.id=prefix+'-facebook-follow';
  const title=node('h3','선택한 Facebook 계정 팔로우'),hint=node('p',undefined,'field-hint'),actions=node('div',undefined,'candidate-actions');
  const run=node('button','선택한 Facebook 계정 팔로우','outline-button');run.type='button';run.id=prefix+'-facebook-follow-prepare';
  const stop=node('button','Facebook 작업 중지','outline-button');stop.type='button';stop.hidden=true;
  const download=node('a',`Facebook 도구 ${FACEBOOK_FOLLOW_VERSION} 받기`,'outline-button');download.href='/api/admin/tools/facebook-follow.zip';download.download='spymedia-facebook-follow.zip';
  const help=node('details');help.append(node('summary','Facebook 도구 설치·실행 방법'),node('p',`Facebook 도구 ${FACEBOOK_FOLLOW_VERSION} 이상을 Instagram 도구와 별도로 설치하세요. 압축을 풀고 Chrome·Edge 확장 프로그램 관리에서 개발자 모드 → 압축 해제된 확장 프로그램 로드를 선택합니다. 설치 권한은 직접 허용한 뒤 관리자 화면을 새로고침하세요.`),node('p',`SNS 관리자와 Facebook을 같은 브라우저 프로필에서 사용하세요. Facebook 오른쪽 위 계정 메뉴에서 ${FACEBOOK_FOLLOW_NAME} 페이지(${FACEBOOK_FOLLOW_ACTOR})로 전환해야 합니다. 개인 프로필에서는 실행하지 않습니다.`),node('p','대상 목록을 확인하고 시작하면 Facebook 탭에서 선택한 계정의 팔로우만 순서대로 실행합니다. 진행 중에는 그 탭의 버튼을 직접 누르지 마세요. 로그인·계정 불일치·추가 인증·제한·불확실한 결과가 나오면 중지하며 자동 재시도하지 않습니다.'));
  const feedback=node('p');feedback.id=prefix+'-facebook-follow-feedback';feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');
  const review=node('div');review.id=prefix+'-facebook-follow-review';
  actions.append(run,stop,download);box.append(title,hint,actions,help,feedback,review);mount.before(box);
  let key='',version=0,busy=false,expired=false,requestId=null,pending=null,selected=null,state=null,expiryTimer;
  const post=value=>window.postMessage({source:'spymedia-admin-facebook-follow',...value},location.origin);
  const selection=()=>normalizeFacebookFollowSelection(getSelection());
  function cancel(){version++;clearTimeout(expiryTimer);if(pending){clearTimeout(pending.timer);pending.reject(Object.assign(Error('cancelled'),{code:'cancelled'}));pending=null;}if(requestId)post({type:'CANCEL',requestId});requestId=null;selected=null;state=null;busy=false;review.replaceChildren();}
  function update(){
    const current=selection(),next=JSON.stringify([current.platform,current.profiles,current.invalid,current.expiresAt]);
    if(key!==next){cancel();key=next;feedback.textContent='';}
    box.hidden=current.platform!=='facebook';
    run.disabled=!status.authenticated||expired||!!current.disabled||busy||!!selected||!!requestId||current.invalid>0||current.profiles.length<1||current.profiles.length>10;
    stop.hidden=!selected&&!requestId;stop.disabled=false;
    hint.textContent='프로필 주소 1~10개를 선택하세요. 실행 계정은 스파이미디어 Facebook 페이지입니다. 아래에서 대상 목록을 확인한 뒤 시작하면 도구가 팔로우하고 결과를 표시합니다.'+(current.invalid?' 게시물 주소 또는 자기 페이지는 실행 대상이 될 수 없습니다. 프로필 주소만 선택하세요.':'');
  }
  function render(snapshot,job,active){
    review.replaceChildren(node('p',`실행 페이지 ${FACEBOOK_FOLLOW_NAME} · ${FACEBOOK_FOLLOW_ACTOR}`,'follow-actor'));
    const list=node('ol',undefined,'follow-progress');snapshot.profiles.forEach((url,index)=>{const row=node('li'),target=node('a',url.replace('https://www.facebook.com/',''),'follow-target');target.href=url;target.target='_blank';target.rel='noopener noreferrer';const result=job?.results?.find(item=>item.index===index);row.append(target,node('span',result?RESULTS[result.state]:index===(job?.index||0)&&active?active:'실행 전','follow-result'));list.append(row);});review.append(list);
  }
  function bridge(action,body={},timeout=5000){
    if(pending||!requestId)return Promise.reject(Object.assign(Error('invalid_message'),{code:'invalid_message'}));
    return new Promise((resolve,reject)=>{const item={action,resolve,reject,id:requestId};item.timer=setTimeout(()=>{if(pending!==item)return;pending=null;const code=action==='PING'?'extension_update':'bridge_timeout';reject(Object.assign(Error(code),{code}));},timeout);pending=item;post({type:action,requestId,...body});});
  }
  async function start(snapshot,mine){
    if(snapshot!==selected||mine!==version||busy||expired||!status.authenticated||getSelection().disabled||Date.now()>=snapshot.expiresAt)return;
    busy=true;requestId=crypto.randomUUID();render(snapshot,null,'연결 확인 중');update();feedback.textContent='Facebook 확장 도구 확인 중…';
    try{
      const ready=await bridge('PING');if(mine!==version)return;
      const value=String(ready.version||''),parts=value.split('.').map(Number),minimum=FACEBOOK_FOLLOW_VERSION.split('.').map(Number),difference=parts.findIndex((n,i)=>n!==minimum[i]);
      if(!/^\d+\.\d+\.\d+$/.test(value)||parts.some(n=>!Number.isSafeInteger(n))||difference!==-1&&parts[difference]<minimum[difference])throw Object.assign(Error('extension_update'),{code:'extension_update'});
      for(const action of ['PREPARE','START']){const response=await bridge(action,action==='PREPARE'?{platform:'facebook',control:'admin',expectedAccount:FACEBOOK_FOLLOW_ACTOR,profiles:snapshot.profiles,expiresAt:snapshot.expiresAt}:{confirmed:true});if(mine!==version)return;if(!validateFacebookFollowJob(response.job,snapshot,action,state))throw Object.assign(Error('invalid_message'),{code:'invalid_message'});state=response.job;}
      while(state.running){const prior=state;render(snapshot,prior,'페이지 확인·팔로우 진행 중');feedback.textContent=`Facebook ${prior.index+1}/${snapshot.profiles.length} 처리 중… 관리자 화면에서 기다려 주세요.`;const response=await bridge('STEP',{index:prior.index},90000);if(mine!==version)return;if(!validateFacebookFollowJob(response.job,snapshot,'STEP',prior))throw Object.assign(Error('invalid_message'),{code:'invalid_message'});state=response.job;render(snapshot,state);}
      feedback.textContent='선택한 Facebook 계정 처리가 끝났습니다. 각 계정의 팔로우 완료·기존 팔로잉 상태를 확인하세요.';
    }catch(error){if(mine!==version)return;render(snapshot,state,'중지 · 결과 확인 필요');feedback.textContent=(ERRORS[error.code]||'Facebook 작업을 확인하지 못해 중지했습니다.')+' 자동 재시도하지 않습니다.';if(error.code==='extension_update')help.open=true;if(requestId)post({type:'CANCEL',requestId});requestId=null;
    }finally{if(mine===version){busy=false;update();}}
  }
  run.addEventListener('click',()=>{
    update();if(run.disabled)return;const current=selection(),mine=++version;
    const expiresAt=Math.min(current.expiresAt||Date.now()+900000,Date.now()+900000);if(!Number.isFinite(expiresAt)||expiresAt<=Date.now()){feedback.textContent=ERRORS.expired;return;}
    selected={profiles:[...current.profiles],expiresAt};state=null;const snapshot=selected;render(snapshot,null);
    const confirm=node('button','확인한 Facebook 계정 팔로우 시작','outline-button');confirm.type='button';confirm.id=prefix+'-facebook-follow-start';review.append(confirm);
    feedback.textContent='위 스파이미디어 실행 페이지와 선택한 대상을 확인하세요. 아래 시작 버튼을 누르면 Facebook에서 실제 팔로우가 실행됩니다.';
    confirm.addEventListener('click',()=>{confirm.disabled=true;start(snapshot,mine);});
    expiryTimer=setTimeout(()=>{if(selected!==snapshot)return;cancel();feedback.textContent=ERRORS.expired;update();},Math.max(0,snapshot.expiresAt-Date.now()));update();
  });
  stop.addEventListener('click',()=>{const snapshot=selected,previous=state,inFlight=pending?.action==='STEP';cancel();if(snapshot){render(snapshot,previous,inFlight?'중지 요청 · 결과 확인 필요':'중지됨');const mine=version;expiryTimer=setTimeout(()=>{if(mine!==version)return;cancel();feedback.textContent=ERRORS.expired;update();},Math.max(0,snapshot.expiresAt-Date.now()));}feedback.textContent='Facebook 작업 중지를 요청했습니다. 진행 중이던 대상의 실제 상태를 확인하세요. 완료된 팔로우는 유지되며 자동 재전송하지 않습니다.';update();});
  window.addEventListener('message',event=>{const data=event.data,item=pending;if(event.source!==window||event.origin!==location.origin||data?.source!=='spymedia-facebook-follow-extension'||!item||!requestId||data.requestId!==requestId||data.requestId!==item.id||data.action!==item.action||data.type!=='ERROR'&&data.type!==(item.action==='PING'?'READY':'STATE'))return;clearTimeout(item.timer);pending=null;if(data.type==='ERROR')item.reject(Object.assign(Error('extension_error'),{code:typeof data.code==='string'?data.code:'invalid_message'}));else item.resolve(data);});
  window.addEventListener('pagehide',cancel);
  window.addEventListener('sns-auth-expired',()=>{expired=true;cancel();feedback.textContent='관리자 로그인이 만료되어 Facebook 작업을 중지했습니다.';update();});
  update();return {update,clear:()=>{cancel();key='';feedback.textContent='';}};
}
