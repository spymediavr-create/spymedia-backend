import {searchResultUrl} from './search-result-url.js';

const node=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;};
const ERRORS={x_follow_disabled:'X 팔로우 실행 설정이 꺼져 있습니다. 기존 인증과 비용 조건을 확인한 뒤 운영자가 활성화해야 합니다.',x_follow_unconfigured:'X 팔로우 인증 또는 저장소 설정을 확인하세요.',x_cost_ack_required:'X API 이용 비용 확인이 필요합니다.',x_follow_busy:'다른 X 팔로우 확인이 진행 중입니다.',x_follow_rate_limited:'연속 요청을 중단했습니다. 잠시 뒤 직접 다시 확인하세요.',x_follow_expired:'대상 확인 시간이 지났습니다. 다시 검토하세요.',account_mismatch:'로그인 계정이 지정된 스파이미디어 계정과 다릅니다.',x_follow_self:'자기 계정은 팔로우할 수 없습니다.',x_unauthorized:'X 인증을 확인하세요. 토큰을 자동 변경하지 않습니다.',x_forbidden:'X 접근 또는 follows.write 권한을 확인하세요.',x_payment_required:'X API 이용 상태와 비용 한도를 확인하세요.',x_rate_limited:'X 요청 제한으로 중단했습니다.',storage_unavailable:'작업 기록 저장소를 확인하세요.',authentication_required:'관리자 로그인이 만료됐습니다.'};
const RESULTS={followed:'팔로우 완료',pending:'팔로우 요청 중 · 상대 승인 대기',requested:'팔로우 요청 중 · 상대 승인 대기',unknown:'결과 확인 필요 · 자동 재전송하지 않음',failed:'실패 · 자동 재전송하지 않음'};
Object.assign(ERRORS,{x_follow_auth_required:'X 기존 인증을 확인하세요. 토큰을 자동 변경하지 않습니다.',x_follow_permission_required:'X 앱·사용자 인증의 팔로우 권한을 확인하세요. 권한을 자동 변경하지 않습니다.',x_follow_storage_unavailable:'팔로우 작업 기록 저장소를 확인하세요.',x_cost_confirmation_required:'X API 비용 확인 설정이 필요합니다.',x_follow_prepare_rate_limited:'X 계정 조회가 너무 빠릅니다. 잠시 후 직접 다시 확인하세요.',x_follow_preparation_expired:'계정 확인 시간이 지났습니다. 다시 검토하세요.',x_follow_confirmation_mismatch:'확인한 대상과 실행 요청이 일치하지 않습니다. 다시 검토하세요.',x_follow_target_unavailable:'대상 X 계정을 확인할 수 없습니다.',x_follow_lookup_failed:'X 계정 조회 결과를 확인하지 못했습니다.',x_follow_result_unknown:'X에서 실제 결과를 확인하세요. 자동 재전송하지 않습니다.',x_follow_payment_required:'X API 이용 비용·한도 상태를 확인하세요.'});
Object.assign(ERRORS,{x_follow_cost_required:'X API 비용·한도를 확인하세요. 결제 설정은 자동 변경하지 않습니다.',x_follow_selection_expired:'검색 결과의 유효 시간이 끝났습니다. 다시 검색하세요.',x_follow_preparation_limit:'확인 중인 계정이 많습니다. 기존 확인의 유효 시간이 끝난 뒤 다시 시도하세요.',x_follow_record_limit:'팔로우 기록 한도에 도달했습니다. 운영자 점검이 필요합니다.',x_follow_rejected:'X에서 팔로우 요청을 거절했습니다.',x_follow_not_completed:'X 응답에서 팔로우 완료 또는 승인 대기를 확인하지 못했습니다.'});

// Selections and preparations are held only in this page, never in browser storage.
export function attachFollowActions({mount,status,getSelection,prefix}){
  const box=node('section',undefined,'follow-actions');box.id=prefix+'-follow';
  const title=node('h3','선택한 계정 팔로우'),hint=node('p',undefined,'field-hint'),actions=node('div',undefined,'candidate-actions');
  const run=node('button','선택 계정 확인','outline-button');run.type='button';run.id=prefix+'-follow-prepare';
  const stop=node('button','전달한 Instagram 작업 취소','outline-button');stop.type='button';stop.hidden=true;
  const download=node('a','Instagram 브라우저 도구 받기','outline-button');download.href='/api/admin/tools/instagram-follow.zip';download.download='spymedia-instagram-follow.zip';
  const help=node('details'),summary=node('summary','Instagram 도구 설치·실행 방법');
  help.append(summary,node('p','압축을 풀고 Chrome 또는 Edge의 확장 프로그램 관리에서 개발자 모드 → 압축 해제된 확장 프로그램 로드로 설치하세요. 같은 브라우저에서 SNS 관리자와 Instagram에 로그인한 뒤 관리자 화면을 새로고침하세요.'),node('p','선택 목록을 보내면 별도 검토 창이 열립니다. 실행 계정 spymedia_kr와 대상을 확인하고 그 창에서 시작합니다. 로그인·보안 확인·화면 불일치·불확실한 결과가 있으면 중단합니다. 확장 설치 권한은 사용자가 직접 허용합니다. 실제 Instagram 화면에서의 동작은 별도 확인이 필요합니다.'));
  const feedback=node('p');feedback.id=prefix+'-follow-feedback';feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');
  const review=node('div');review.id=prefix+'-follow-review';
  actions.append(run,stop,download);box.append(title,hint,actions,help,feedback,review);mount.before(box);
  let key='',requestId=null,busy=false,expired=false,version=0,prepared=null,bridgeTimer;
  const post=value=>window.postMessage({source:'spymedia-admin-follow',...value},location.origin);
  function cancel(){version++;prepared=null;review.replaceChildren();clearTimeout(bridgeTimer);if(requestId){post({type:'CANCEL',requestId});requestId=null;}busy=false;}
  function selection(){
    const current=getSelection(),profiles=[];let invalid=0;
    for(const value of current.profiles||[]){const safe=searchResultUrl(current.platform,value);if(!safe||safe.kind!=='profile'){invalid++;continue;}if(!profiles.includes(safe.url))profiles.push(safe.url);}
    return {...current,profiles,invalid};
  }
  function update(){
    const current=selection(),next=JSON.stringify([current.platform,current.profiles,current.invalid,current.expiresAt]);
    if(next!==key){cancel();feedback.textContent='';key=next;}
    const instagram=current.platform==='instagram',x=current.platform==='x',available=!!status.authenticated&&!expired&&!current.disabled;
    box.hidden=!['instagram','x','blog'].includes(current.platform);
    download.hidden=help.hidden=!instagram;download.setAttribute('aria-disabled',String(!status.authenticated));
    run.hidden=current.platform==='blog';run.textContent=instagram?'선택 프로필을 Instagram 도구로 보내기':'선택한 X 계정 확인';
    run.disabled=!available||busy||current.invalid>0||(instagram?(!!requestId||current.profiles.length<1||current.profiles.length>10):(current.profiles.length!==1||!status.xFollow?.ready));
    stop.hidden=!requestId;stop.disabled=false;
    hint.textContent=instagram?'프로필만 1~10개 선택하세요. 별도 브라우저 창에서 목록 검토 후 실제 팔로우를 시작합니다. 체크만으로 실행되지 않습니다.':x?'X는 한 계정을 확인한 뒤 공식 API로 팔로우합니다. 조회·실행에는 API 비용이 발생할 수 있으며 대량 자동 팔로우는 제공하지 않습니다.':'네이버 공개 API에는 이웃추가 기능이 없습니다. 프로필을 열어 직접 이웃추가하세요. 서로이웃은 상대의 승인이 필요합니다.';
    if(current.invalid)hint.textContent+=' 게시물 주소가 선택되어 있습니다. 프로필 주소만 선택하세요.';
    if(x&&!status.xFollow?.ready)hint.textContent+=' 현재 X 팔로우 실행은 비활성 상태입니다. 기존 게시 기능과 별도 설정입니다.';
  }
  stop.addEventListener('click',()=>{cancel();feedback.textContent='전달한 작업에 중단을 요청했습니다. 이미 완료된 팔로우는 취소하지 않습니다.';update();});
  async function api(route,body){
    const response=await fetch('/api/admin/x/follows/'+route,{method:'POST',cache:'no-store',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':status.csrfToken},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
    const data=await response.json();
    if(response.status===401&&data.error==='authentication_required'||response.status===403&&data.error==='csrf_rejected'){window.dispatchEvent(new Event('sns-auth-expired'));throw Error(ERRORS.authentication_required);}
    if(!response.ok)throw Error(ERRORS[data.error]||'요청을 완료하지 못했습니다. 설정·권한과 기존 결과를 확인하세요. 자동 재전송하지 않습니다.');return data;
  }
  function result(value){review.replaceChildren();feedback.textContent=RESULTS[value?.status]||'결과 확인 필요 · 자동 재전송하지 않음';if(ERRORS[value?.errorCode])feedback.textContent+=' · '+ERRORS[value.errorCode];if(value?.operationId)feedback.textContent+=' · 작업 '+value.operationId;}
  run.addEventListener('click',async()=>{
    update();if(run.disabled)return;const current=selection(),mine=++version;busy=true;update();
    if(current.platform==='instagram'){
      requestId=crypto.randomUUID();feedback.textContent='브라우저 확장 도구에 연결 중…';
      bridgeTimer=setTimeout(()=>{if(mine!==version)return;busy=false;feedback.textContent='확장 도구 응답이 없습니다. 도구를 설치한 Chrome/Edge에서 관리자 화면을 새로고침한 뒤 다시 시도하세요.';if(requestId)post({type:'CANCEL',requestId});requestId=null;update();},5000);
      post({type:'PREPARE',requestId,platform:'instagram',expectedAccount:'spymedia_kr',profiles:current.profiles,expiresAt:Math.min(current.expiresAt||Date.now()+900000,Date.now()+900000)});return;
    }
    feedback.textContent='X 실행 계정과 대상 계정 확인 중…';
    try{
      const username=new URL(current.profiles[0]).pathname.split('/').filter(Boolean)[0];
      const data=await api('prepare',{username,...(current.expiresAt?{selectionExpiresAt:current.expiresAt}:{})});if(mine!==version)return;
      if(data.existingResult){result(data.existingResult);return;}
      if(data.source?.username!=='spymedia_kor'||typeof data.target?.username!=='string'||!/^\d{1,19}$/.test(data.target?.userId||'')||typeof data.preparationId!=='string'||typeof data.confirmationToken!=='string')throw Error('대상 확인 응답을 검증하지 못했습니다.');
      prepared=data;review.replaceChildren(node('p',`실행 계정 @${data.source.username} → 대상 @${data.target.username} (${data.target.userId})`));
      const confirm=node('button','이 X 계정 팔로우 실행','outline-button');confirm.type='button';review.append(confirm);feedback.textContent='확인한 계정 1개를 팔로우합니다. 요청 중과 완료를 구분해 표시합니다.';
      confirm.addEventListener('click',async()=>{
        if(!prepared||prepared!==data||expired||busy)return;
        if(!window.confirm(`@${data.source.username} 계정으로 @${data.target.username}을 팔로우할까요? X 공식 API를 호출하며 비용이 발생할 수 있습니다.`))return;
        busy=true;confirm.disabled=true;run.disabled=true;feedback.textContent='X 팔로우 요청 결과 확인 중…';
        try{const answer=await api('execute',{preparationId:data.preparationId,confirmationToken:data.confirmationToken,confirmUsername:data.target.username,confirmTargetUserId:data.target.userId,confirmed:true});if(mine===version)result(answer);}
        catch(e){if(mine===version){review.replaceChildren();feedback.textContent=e.name==='TimeoutError'?'응답 시간이 초과됐습니다. X 프로필에서 결과를 확인하세요. 자동 재전송하지 않습니다.':e.message;}}
        finally{if(mine===version){prepared=null;busy=false;update();}}
      });
    }catch(e){if(mine===version)feedback.textContent=e.name==='TimeoutError'?'X 확인 응답 시간이 초과됐습니다. 자동 재시도하지 않습니다.':e.message;}
    finally{if(mine===version){busy=false;update();}}
  });
  window.addEventListener('message',event=>{
    const data=event.data;if(event.source!==window||event.origin!==location.origin||data?.source!=='spymedia-follow-extension'||!requestId||data.requestId!==requestId||!['ACCEPTED','ERROR'].includes(data.type))return;
    clearTimeout(bridgeTimer);busy=false;
    feedback.textContent=data.type==='ACCEPTED'?'별도 Instagram 검토 창을 열었습니다. 목록과 실행 계정을 확인한 뒤 그 창에서 시작하세요. 아직 팔로우 완료가 아닙니다.':'확장 도구가 선택 목록을 받지 못했습니다. 도구의 설치 상태·열린 작업·선택 목록을 확인하세요.';
    if(data.type==='ERROR')requestId=null;update();
  });
  window.addEventListener('pagehide',cancel);
  window.addEventListener('sns-auth-expired',()=>{expired=true;cancel();feedback.textContent=ERRORS.authentication_required;update();});
  update();return {update,clear:()=>{cancel();key='';feedback.textContent='';}};
}
