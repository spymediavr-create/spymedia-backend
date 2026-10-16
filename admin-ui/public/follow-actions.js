import {searchResultUrl} from './search-result-url.js';

const node=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;};
const ERRORS={x_follow_disabled:'X 팔로우 실행 설정이 꺼져 있습니다. 기존 인증과 비용 조건을 확인한 뒤 운영자가 활성화해야 합니다.',x_follow_unconfigured:'X 팔로우 인증 또는 저장소 설정을 확인하세요.',x_cost_ack_required:'X API 이용 비용 확인이 필요합니다.',x_follow_busy:'다른 X 팔로우 확인이 진행 중입니다.',x_follow_rate_limited:'연속 요청을 중단했습니다. 잠시 뒤 직접 다시 확인하세요.',x_follow_expired:'대상 확인 시간이 지났습니다. 다시 검토하세요.',account_mismatch:'로그인 계정이 지정된 스파이미디어 계정과 다릅니다.',x_follow_self:'자기 계정은 팔로우할 수 없습니다.',x_unauthorized:'X 인증을 확인하세요. 토큰을 자동 변경하지 않습니다.',x_forbidden:'X 접근 또는 follows.write 권한을 확인하세요.',x_payment_required:'X API 이용 상태와 비용 한도를 확인하세요.',x_rate_limited:'X 요청 제한으로 중단했습니다.',storage_unavailable:'작업 기록 저장소를 확인하세요.',authentication_required:'관리자 로그인이 만료됐습니다.'};
const RESULTS={followed:'팔로우 완료',pending:'팔로우 요청 중 · 상대 승인 대기',requested:'팔로우 요청 중 · 상대 승인 대기',unknown:'결과 확인 필요 · 자동 재전송하지 않음',failed:'실패 · 자동 재전송하지 않음'};
Object.assign(ERRORS,{x_follow_auth_required:'X 기존 인증을 확인하세요. 토큰을 자동 변경하지 않습니다.',x_follow_permission_required:'X 앱·사용자 인증의 팔로우 권한을 확인하세요. 권한을 자동 변경하지 않습니다.',x_follow_storage_unavailable:'팔로우 작업 기록 저장소를 확인하세요.',x_cost_confirmation_required:'X API 비용 확인 설정이 필요합니다.',x_follow_prepare_rate_limited:'X 계정 조회가 너무 빠릅니다. 잠시 후 직접 다시 확인하세요.',x_follow_preparation_expired:'계정 확인 시간이 지났습니다. 다시 검토하세요.',x_follow_confirmation_mismatch:'확인한 대상과 실행 요청이 일치하지 않습니다. 다시 검토하세요.',x_follow_target_unavailable:'대상 X 계정을 확인할 수 없습니다.',x_follow_lookup_failed:'X 계정 조회 결과를 확인하지 못했습니다.',x_follow_result_unknown:'X에서 실제 결과를 확인하세요. 자동 재전송하지 않습니다.',x_follow_payment_required:'X API 이용 비용·한도 상태를 확인하세요.'});
Object.assign(ERRORS,{x_follow_cost_required:'X API 비용·한도를 확인하세요. 결제 설정은 자동 변경하지 않습니다.',x_follow_selection_expired:'검색 결과의 유효 시간이 끝났습니다. 다시 검색하세요.',x_follow_preparation_limit:'확인 중인 계정이 많습니다. 기존 확인의 유효 시간이 끝난 뒤 다시 시도하세요.',x_follow_record_limit:'팔로우 기록 한도에 도달했습니다. 운영자 점검이 필요합니다.',x_follow_rejected:'X에서 팔로우 요청을 거절했습니다.',x_follow_not_completed:'X 응답에서 팔로우 완료 또는 승인 대기를 확인하지 못했습니다.'});
const IG_VERSION='0.2.2';
const IG_RESULTS={followed:'팔로우 완료',request_sent:'팔로우 요청 전송 · 상대 승인 대기',following:'이미 팔로잉 · 건너뜀',requested:'이미 요청 중 · 건너뜀'};
const IG_ERRORS={account_unverified:'Instagram 화면에서 실행 계정을 식별하지 못했습니다. 로그아웃을 뜻하지 않습니다. 같은 브라우저 프로필에서 spymedia_kr로 로그인했는지 확인하세요.',account_mismatch:'Instagram 로그인 계정이 spymedia_kr와 달라 중지했습니다.',login_required:'Instagram 로그인이 필요합니다. 관리자와 같은 Chrome·Edge 프로필에서 spymedia_kr로 로그인하세요.',challenge:'Instagram 추가 인증 또는 활동 제한이 감지되어 중지했습니다.',wrong_profile:'열린 Instagram 프로필이 선택한 대상과 달라 중지했습니다.',ambiguous_profile:'Instagram 프로필 또는 팔로우 버튼을 명확히 식별하지 못해 중지했습니다.',uncertain:'클릭 이후 결과를 확정하지 못했습니다. 해당 Instagram 프로필에서 상태를 확인하세요.',browser_error:'Instagram 브라우저 동작을 확인하지 못해 중지했습니다.',job_lost:'작업이 만료되었거나 확장 도구가 재시작됐습니다.',job_exists:'기존 Instagram 작업이 열려 있습니다. 그 작업을 중지하고 새 작업을 준비하세요.',expired:'작업 유효 시간이 끝났습니다. 다시 검색하고 선택하세요.',not_confirmed:'작업의 계정·대상 확인 상태가 일치하지 않아 중지했습니다.',invalid_message:'확장 도구 응답을 검증하지 못했습니다.',bridge_timeout:'확장 도구 응답 시간이 초과됐습니다. 실제 Instagram 상태를 확인하세요.',extension_update:'Instagram 확장 도구 0.2.2 이상이 필요합니다. 최신 도구를 내려받아 교체하고 확장 프로그램을 새로고침한 뒤 관리자 화면도 새로고침하세요.'};

// Selections and preparations are held only in this page, never in browser storage.
export function attachFollowActions({mount,status,getSelection,prefix}){
  const box=node('section',undefined,'follow-actions');box.id=prefix+'-follow';
  const title=node('h3','선택한 계정 팔로우'),hint=node('p',undefined,'field-hint'),actions=node('div',undefined,'candidate-actions');
  const run=node('button','선택 계정 확인','outline-button');run.type='button';run.id=prefix+'-follow-prepare';
  const stop=node('button','Instagram 작업 중지','outline-button');stop.type='button';stop.hidden=true;
  const download=node('a',`Instagram 도구 ${IG_VERSION} 받기`,'outline-button');download.href='/api/admin/tools/instagram-follow.zip';download.download='spymedia-instagram-follow.zip';
  const help=node('details'),summary=node('summary','Instagram 도구 설치·실행 방법');
  help.append(summary,node('p',`확장 도구 ${IG_VERSION} 이상이 필요합니다. 압축을 풀고 Chrome 또는 Edge의 확장 프로그램 관리에서 개발자 모드 → 압축 해제된 확장 프로그램 로드로 설치하세요. 이전 버전은 파일을 교체하고 확장 프로그램의 새로고침 버튼을 누르세요. 같은 브라우저 프로필에서 SNS 관리자와 Instagram에 로그인한 뒤 관리자 화면도 새로고침하세요.`),node('p','이 관리자 화면에서 실행 계정 spymedia_kr와 선택 목록을 확인하고 시작합니다. Instagram 탭은 뒤에서 열리며 도구가 팔로우 버튼을 누릅니다. 진행 중에는 그 탭의 팔로우 버튼을 직접 누르지 마세요. 로그인·보안 확인·화면 불일치·불확실한 결과가 있으면 중지하며 자동 재시도하지 않습니다. 확장 설치 권한은 사용자가 직접 허용합니다.'));
  const feedback=node('p');feedback.id=prefix+'-follow-feedback';feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');
  const review=node('div');review.id=prefix+'-follow-review';
  actions.append(run,stop,download);box.append(title,hint,actions,help,feedback,review);mount.before(box);
  let key='',requestId=null,busy=false,expired=false,version=0,prepared=null,pending=null,igReview=null,igState=null,expiryTimer;
  const post=value=>window.postMessage({source:'spymedia-admin-follow',...value},location.origin);
  function cancel(){version++;prepared=null;igReview=null;igState=null;review.replaceChildren();clearTimeout(expiryTimer);if(pending){clearTimeout(pending.timer);pending.reject(Object.assign(Error('cancelled'),{code:'cancelled'}));pending=null;}if(requestId){post({type:'CANCEL',requestId});requestId=null;}busy=false;}
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
    run.hidden=current.platform==='blog';run.textContent=instagram?'선택한 Instagram 계정 팔로우':'선택한 X 계정 확인';
    run.disabled=!available||busy||current.invalid>0||(instagram?(!!requestId||current.profiles.length<1||current.profiles.length>10):(current.profiles.length!==1||!status.xFollow?.ready));
    stop.hidden=!requestId&&!igReview;stop.disabled=false;
    hint.textContent=instagram?'프로필만 1~10개 선택하세요. 이 관리자 화면에서 계정·목록을 확인한 뒤 시작하면 도구가 순서대로 팔로우하고 결과를 표시합니다. Instagram은 같은 브라우저 프로필에 로그인되어 있어야 합니다.':x?'X는 한 계정을 확인한 뒤 공식 API로 팔로우합니다. 조회·실행에는 API 비용이 발생할 수 있으며 대량 자동 팔로우는 제공하지 않습니다.':'네이버 공개 API에는 이웃추가 기능이 없습니다. 프로필을 열어 직접 이웃추가하세요. 서로이웃은 상대의 승인이 필요합니다.';
    if(current.invalid)hint.textContent+=' 게시물 주소가 선택되어 있습니다. 프로필 주소만 선택하세요.';
    if(x&&!status.xFollow?.ready)hint.textContent+=' 현재 X 팔로우 실행은 비활성 상태입니다. 기존 게시 기능과 별도 설정입니다.';
  }
  stop.addEventListener('click',()=>{const snapshot=igReview&&{...igReview},state=igState&&{...igState},inFlight=pending?.action==='STEP';cancel();if(snapshot&&state){renderInstagram(snapshot,state,inFlight?'중지 요청 · 결과 확인 필요':'중지됨');const retainedVersion=version;expiryTimer=setTimeout(()=>{if(version!==retainedVersion)return;cancel();feedback.textContent=IG_ERRORS.expired;update();},Math.max(0,snapshot.expiresAt-Date.now()));}feedback.textContent='작업 중지를 요청했습니다. 진행 중이던 대상은 Instagram에서 상태를 확인하세요. 완료된 팔로우는 취소하지 않으며 자동 재전송하지 않습니다.';update();});
  function renderInstagram(selected,state,activeLabel){
    review.replaceChildren(node('p','실행 계정 @spymedia_kr','follow-actor'));
    const list=node('ol',undefined,'follow-progress');
    selected.profiles.forEach((url,index)=>{const row=node('li'),name=node('span','@'+new URL(url).pathname.split('/')[1],'follow-target'),done=state?.results?.find(value=>value.index===index),label=done?IG_RESULTS[done.state]:index===(state?.index||0)&&activeLabel?activeLabel:'실행 전';row.append(name,node('span',label,'follow-result'));list.append(row);});
    review.append(list);
  }
  function bridge(action,body={},timeout=5000){
    if(pending||!requestId)return Promise.reject(Object.assign(Error('invalid_message'),{code:'invalid_message'}));
    return new Promise((resolve,reject)=>{const item={action,resolve,reject,id:requestId};item.timer=setTimeout(()=>{if(pending!==item)return;pending=null;reject(Object.assign(Error(action==='PING'?'extension_update':'bridge_timeout'),{code:action==='PING'?'extension_update':'bridge_timeout'}));},timeout);pending=item;post({type:action,requestId,...body});});
  }
  function validJob(job,selected,action,prior){
    if(!job||job.expectedAccount!=='spymedia_kr'||JSON.stringify(job.profiles)!==JSON.stringify(selected.profiles)||job.expiresAt!==selected.expiresAt||!Number.isInteger(job.index)||job.index<0||job.index>selected.profiles.length||typeof job.started!=='boolean'||typeof job.running!=='boolean'||job.terminalError!==null||!Array.isArray(job.results)||job.results.length!==job.index||job.results.some((r,i)=>r.index!==i||!Object.hasOwn(IG_RESULTS,r.state)))return false;
    if(action==='PREPARE')return !job.started&&!job.running&&job.index===0;
    if(action==='START')return job.started&&job.running&&job.index===0;
    return action==='STEP'&&job.started&&job.index===prior.index+1&&job.running===(job.index<selected.profiles.length)&&JSON.stringify(job.results.slice(0,-1))===JSON.stringify(prior.results);
  }
  async function startInstagram(selected,mine){
    if(igReview!==selected||mine!==version||busy||expired||Date.now()>=selected.expiresAt)return;
    busy=true;requestId=crypto.randomUUID();renderInstagram(selected,null,'연결 확인 중');update();feedback.textContent='Instagram 확장 도구 버전 확인 중…';
    try{
      const ready=await bridge('PING');if(mine!==version)return;
      const supplied=String(ready.version||''),parts=supplied.split('.').map(Number),minimum=IG_VERSION.split('.').map(Number),difference=parts.findIndex((n,i)=>n!==minimum[i]);
      if(!/^\d+\.\d+\.\d+$/.test(supplied)||parts.some(n=>!Number.isSafeInteger(n))||difference!==-1&&parts[difference]<minimum[difference])throw Object.assign(Error('extension_update'),{code:'extension_update'});
      for(const action of ['PREPARE','START']){
        const response=await bridge(action,action==='PREPARE'?{platform:'instagram',control:'admin',expectedAccount:'spymedia_kr',profiles:selected.profiles,expiresAt:selected.expiresAt}:{confirmed:true});if(mine!==version)return;
        if(!validJob(response.job,selected,action,igState))throw Object.assign(Error('invalid_message'),{code:'invalid_message'});igState=response.job;
      }
      while(igState.running){
        const prior=igState;renderInstagram(selected,prior,'계정 확인·팔로우 진행 중');feedback.textContent=`Instagram ${prior.index+1}/${selected.profiles.length} 처리 중… 관리자 화면에서 기다려 주세요.`;
        const response=await bridge('STEP',{index:prior.index},45000);if(mine!==version)return;
        if(!validJob(response.job,selected,'STEP',prior))throw Object.assign(Error('invalid_message'),{code:'invalid_message'});igState=response.job;renderInstagram(selected,igState);
      }
      feedback.textContent='선택한 Instagram 계정 처리가 끝났습니다. 각 계정의 팔로우 완료·요청 전송·기존 상태를 확인하세요.';
    }catch(error){
      if(mine!==version)return;renderInstagram(selected,igState,'중지 · 결과 확인 필요');feedback.textContent=(IG_ERRORS[error.code]||'Instagram 작업을 확인하지 못해 중지했습니다.')+' 자동 재시도하지 않습니다.';if(error.code==='extension_update')help.open=true;
      if(requestId)post({type:'CANCEL',requestId});requestId=null;
    }finally{if(mine===version){busy=false;update();}}
  }
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
      clearTimeout(expiryTimer);igReview={profiles:[...current.profiles],expiresAt:Math.min(current.expiresAt||Date.now()+900000,Date.now()+900000)};igState=null;const selected=igReview;
      renderInstagram(selected,null);const confirm=node('button','확인한 Instagram 계정 팔로우 시작','outline-button');confirm.type='button';confirm.id=prefix+'-instagram-follow-start';review.append(confirm);busy=false;
      feedback.textContent='위 실행 계정과 선택한 대상을 확인하세요. 아래 시작 버튼을 누르면 Instagram 탭에서 도구가 팔로우를 실행합니다.';
      confirm.addEventListener('click',()=>{confirm.disabled=true;startInstagram(selected,mine);});
      expiryTimer=setTimeout(()=>{if(igReview!==selected)return;cancel();feedback.textContent=IG_ERRORS.expired;update();},Math.max(0,selected.expiresAt-Date.now()));update();return;
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
    const data=event.data,item=pending;if(event.source!==window||event.origin!==location.origin||data?.source!=='spymedia-follow-extension'||!item||!requestId||data.requestId!==requestId||data.requestId!==item.id)return;
    if(item.action==='PING'&&data.type==='READY'&&data.action===undefined){clearTimeout(item.timer);pending=null;item.reject(Object.assign(Error('extension_update'),{code:'extension_update'}));return;}
    if(data.action!==item.action)return;
    if(data.type!=='ERROR'&&data.type!==(item.action==='PING'?'READY':'STATE'))return;
    clearTimeout(item.timer);pending=null;if(data.type==='ERROR')item.reject(Object.assign(Error(data.code||'invalid_message'),{code:data.code||'invalid_message'}));else item.resolve(data);
  });
  window.addEventListener('pagehide',cancel);
  window.addEventListener('sns-auth-expired',()=>{expired=true;cancel();feedback.textContent=ERRORS.authentication_required;update();});
  update();return {update,clear:()=>{cancel();key='';feedback.textContent='';}};
}
