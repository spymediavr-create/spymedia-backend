import {searchResultUrl} from './search-result-url.js';

export const NAVER_NEIGHBOR_ACTOR='spymedia';
export const NAVER_NEIGHBOR_VERSION='0.1.0';
const RESULTS={added:'이웃추가 완료',existing:'이미 이웃 · 건너뜀'};
const RESERVED=new Set(['me','myblog','admin','login','logout','help','search','feed','postlist','postview','bloghome','blogpeople','neighbor','neighbors','buddy','buddyadd','manage','settings','write','section','service','notice']);
const ERRORS={account_unverified:'네이버 화면에서 실행 블로그를 확인하지 못했습니다. 같은 브라우저 프로필에서 내 블로그가 spymedia인 계정으로 로그인했는지 확인하세요.',account_mismatch:'네이버에서 사용 중인 블로그가 spymedia와 달라 중지했습니다.',login_required:'네이버 로그인이 필요합니다. 관리자와 같은 Chrome·Edge 프로필에서 내 블로그가 spymedia인 계정으로 로그인하세요.',challenge:'네이버 추가 인증 또는 이용 제한이 감지되어 중지했습니다.',security_limit:'네이버 보안 확인 또는 이용 제한이 감지되어 중지했습니다.',rate_limited:'네이버 이웃추가 제한이 감지되어 중지했습니다.',wrong_profile:'열린 네이버 블로그가 선택한 대상과 달라 중지했습니다.',ambiguous_profile:'선택한 블로그의 일반 이웃추가 버튼을 명확히 확인하지 못해 중지했습니다.',ambiguous_dialog:'일반 이웃추가 확인 화면을 명확히 확인하지 못해 중지했습니다.',mutual_only:'일반 이웃추가를 확인하지 못해 중지했습니다. 해당 블로그의 상태를 직접 확인하세요.',uncertain:'실행 이후 결과를 확정하지 못했습니다. 해당 블로그에서 이웃 상태를 확인하세요.',browser_error:'네이버 브라우저 동작을 확인하지 못해 중지했습니다.',job_lost:'작업이 만료되었거나 확장 도구가 재시작됐습니다.',job_exists:'기존 네이버 이웃추가 작업이 열려 있습니다. 기존 작업을 중지하고 새 작업을 준비하세요.',expired:'선택한 대상의 유효 시간이 끝났습니다. 다시 검색하고 선택하세요.',not_confirmed:'실행 계정·대상의 확인 상태가 일치하지 않아 중지했습니다.',invalid_message:'네이버 확장 도구 응답을 검증하지 못했습니다.',bridge_timeout:'네이버 확장 도구 응답 시간이 초과됐습니다. 실제 블로그의 이웃 상태를 확인하세요.',extension_update:'네이버 이웃추가 도구 0.1.0 이상이 필요합니다. 아래 도구를 별도로 설치하고 관리자 화면을 새로고침하세요.'};
ERRORS.authentication_check_failed='관리자 로그인 상태를 확인하지 못해 네이버 작업을 중지했습니다. 관리자 화면을 새로고침해 로그인 상태와 기존 결과를 확인하세요.';
ERRORS.group_missing='네이버 이웃 그룹에서 광고 그룹을 찾지 못해 중지했습니다. spymedia 블로그의 기존 이웃 그룹 이름을 확인하세요. 다른 그룹을 선택하거나 새 그룹을 만들지 않았습니다.';
ERRORS.group_ambiguous='네이버 이웃 그룹에서 광고 그룹을 하나로 확인하지 못해 중지했습니다. 같은 이름의 그룹이 있는지 확인하세요. 다른 그룹을 선택하거나 새 그룹을 만들지 않았습니다.';
export function naverNeighborErrorMessage(code){return typeof code==='string'&&Object.hasOwn(ERRORS,code)?ERRORS[code]:'네이버 이웃추가 작업을 확인하지 못해 중지했습니다.';}
const node=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;};
const exact=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));

export function normalizeNaverNeighborSelection(current){
  const profiles=[];let invalid=0,derived=0,own=0,duplicates=0;
  for(const value of current.profiles||[]){
    const safe=searchResultUrl('blog',value),id=safe&&new URL(safe.url).pathname.split('/')[1];
    if(!safe||!['profile','post'].includes(safe.kind)||! /^[a-z0-9_-]{1,50}$/.test(id)||RESERVED.has(id)){invalid++;continue;}
    if(id===NAVER_NEIGHBOR_ACTOR){own++;continue;}
    if(safe.kind==='post')derived++;
    const profile='https://blog.naver.com/'+id;if(profiles.includes(profile)){duplicates++;continue;}profiles.push(profile);
  }
  return {...current,profiles,invalid,derived,own,duplicates};
}

export function validateNaverNeighborJob(job,selected,action,prior){
  if(!exact(job,['expectedAccount','expectedName','profiles','expiresAt','index','started','running','terminalError','results'])||job.expectedAccount!==NAVER_NEIGHBOR_ACTOR||job.expectedName!==NAVER_NEIGHBOR_ACTOR||JSON.stringify(job.profiles)!==JSON.stringify(selected.profiles)||job.expiresAt!==selected.expiresAt||!Number.isInteger(job.index)||job.index<0||job.index>selected.profiles.length||typeof job.started!=='boolean'||typeof job.running!=='boolean'||job.terminalError!==null||!Array.isArray(job.results)||job.results.length!==job.index||Array.from(job.results).some((result,index)=>!Object.hasOwn(job.results,index)||!exact(result,['index','state'])||result.index!==index||typeof result.state!=='string'||!Object.hasOwn(RESULTS,result.state)))return false;
  if(action==='PREPARE')return !job.started&&!job.running&&job.index===0;
  if(action==='START')return job.started&&job.running&&job.index===0;
  return action==='STEP'&&!!prior&&job.started&&job.index===prior.index+1&&job.running===(job.index<selected.profiles.length)&&JSON.stringify(job.results.slice(0,-1))===JSON.stringify(prior.results);
}

// Keep selection and confirmed progress in page memory; no relationship sync or persistence.
export function attachNaverNeighborActions({mount,status,getSelection,prefix}){
  const box=node('section',undefined,'follow-actions');box.id=prefix+'-naver-neighbor';
  const title=node('h3','선택한 블로그 이웃추가'),hint=node('p',undefined,'field-hint'),actions=node('div',undefined,'candidate-actions');
  const run=node('button','선택한 블로그 이웃추가','outline-button');run.type='button';run.id=prefix+'-naver-neighbor-prepare';
  const stop=node('button','네이버 이웃추가 중지','outline-button');stop.type='button';stop.hidden=true;
  const download=node('a',`네이버 이웃추가 도구 ${NAVER_NEIGHBOR_VERSION} 받기`,'outline-button');download.href='/api/admin/tools/naver-neighbor.zip';download.download='spymedia-naver-neighbor.zip';
  const help=node('details');help.append(node('summary','네이버 도구 설치·실행 방법'),node('p',`네이버 이웃추가 도구 ${NAVER_NEIGHBOR_VERSION} 이상을 별도로 설치하세요. 압축을 풀고 Chrome·Edge 확장 프로그램 관리에서 개발자 모드 → 압축 해제된 확장 프로그램 로드를 선택합니다. 설치 권한을 직접 확인·허용한 뒤 관리자 화면을 새로고침하세요.`),node('p','SNS 관리자와 네이버를 같은 브라우저 프로필에서 사용하고, 내 블로그가 spymedia인 계정으로 로그인하세요. 일반 이웃만 기존 광고 그룹에 추가하며 서로이웃 신청 메시지는 보내지 않습니다.'),node('p','도구가 이웃추가 팝업에서 이웃 → 다음 → 광고 그룹 선택 → 다음 순서로 처리한 뒤 완료 화면을 확인합니다. 광고 그룹이 없거나 같은 이름의 그룹이 여러 개이면 중지합니다. 다른 그룹을 선택하거나 새 그룹을 만들지 않습니다.'),node('p','아래에서 실제 대상 블로그 주소를 확인하고 시작합니다. 선택한 글 주소는 URL에 포함된 블로그 ID로 블로그 주소를 만들고, 같은 블로그는 한 번만 처리합니다. 도구는 이미 이웃인 대상을 건너뜁니다. 로그인·계정 불일치·추가 인증·이용 제한·불확실한 결과가 나오면 중지하며 자동 재시도하지 않습니다.'));
  const feedback=node('p');feedback.id=prefix+'-naver-neighbor-feedback';feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');
  const review=node('div');review.id=prefix+'-naver-neighbor-review';actions.append(run,stop,download);box.append(title,hint,actions,help,feedback,review);mount.before(box);
  let key='',version=0,busy=false,expired=false,requestId=null,pending=null,selected=null,state=null,expiryTimer;
  const post=value=>window.postMessage({source:'spymedia-admin-naver-neighbor',...value},location.origin);
  const selection=()=>normalizeNaverNeighborSelection(getSelection());
  function cancel(){version++;clearTimeout(expiryTimer);if(pending){clearTimeout(pending.timer);pending.reject(Object.assign(Error('cancelled'),{code:'cancelled'}));pending=null;}if(requestId)post({type:'CANCEL',requestId});requestId=null;selected=null;state=null;busy=false;review.replaceChildren();}
  function update(){
    const current=selection(),next=JSON.stringify([current.platform,current.profiles,current.invalid,current.derived,current.own,current.duplicates,current.expiresAt]);
    if(key!==next){cancel();key=next;feedback.textContent='';}
    box.hidden=current.platform!=='blog';run.disabled=!status.authenticated||expired||!!current.disabled||busy||!!selected||!!requestId||current.invalid>0||current.profiles.length<1||current.profiles.length>10;
    stop.hidden=!selected&&!requestId;stop.disabled=false;
    hint.textContent='블로그를 1~10개 선택하고 대상 주소를 확인하세요. spymedia 블로그의 기존 광고 그룹에 일반 이웃으로 순서대로 추가합니다.'+(current.derived?` 선택한 글 ${current.derived}개의 주소에서 블로그 주소를 정리했습니다.`:'')+(current.duplicates?` 같은 블로그 중복 ${current.duplicates}개를 합쳤습니다.`:'')+(current.own?` 자기 블로그 ${current.own}개는 제외했습니다.`:'')+(current.invalid?' 블로그를 확인할 수 없는 주소가 있습니다. 네이버 블로그 또는 해당 블로그의 글 주소만 선택하세요.':'');
  }
  function render(snapshot,job,active){
    review.replaceChildren(node('p','실행 블로그 spymedia · 일반 이웃추가 · 광고 그룹','follow-actor'));
    if(snapshot.derived)review.append(node('p',`선택한 글 주소 ${snapshot.derived}개에 포함된 블로그 ID를 사용해 아래 블로그 주소로 정리했습니다. 같은 블로그는 한 번만 실행합니다.`,'field-hint'));
    const list=node('ol',undefined,'follow-progress');snapshot.profiles.forEach((url,index)=>{const row=node('li'),target=node('a',url,'follow-target');target.href=url;target.target='_blank';target.rel='noopener noreferrer';const result=job?.results?.find(item=>item.index===index);row.append(target,node('span',result?RESULTS[result.state]:index===(job?.index||0)&&active?active:'실행 전','follow-result'));list.append(row);});review.append(list);
  }
  function bridge(action,body={},timeout=5000){
    if(pending||!requestId)return Promise.reject(Object.assign(Error('invalid_message'),{code:'invalid_message'}));
    return new Promise((resolve,reject)=>{const item={action,resolve,reject,id:requestId};item.timer=setTimeout(()=>{if(pending!==item)return;pending=null;const code=action==='PING'?'extension_update':'bridge_timeout';reject(Object.assign(Error(code),{code}));},timeout);pending=item;post({type:action,requestId,...body});});
  }
  async function checkAdminSession(mine){
    try{
      const response=await fetch('/api/admin/status',{method:'GET',cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(10000)});
      if(mine!==version)return false;
      if(response.status===401){window.dispatchEvent(new Event('sns-auth-expired'));return false;}
      if(!response.ok)throw Error('authentication_check_failed');
      const current=await response.json();if(mine!==version)return false;
      if(current?.authenticated!==true||typeof current.csrfToken!=='string'||!current.csrfToken||current.csrfToken!==status.csrfToken){window.dispatchEvent(new Event('sns-auth-expired'));return false;}
      return true;
    }catch{if(mine!==version)return false;throw Object.assign(Error('authentication_check_failed'),{code:'authentication_check_failed'});}
  }
  async function start(snapshot,mine){
    if(snapshot!==selected||mine!==version||busy||expired||!status.authenticated||getSelection().disabled||Date.now()>=snapshot.expiresAt)return;
    busy=true;requestId=crypto.randomUUID();render(snapshot,null,'연결 확인 중');update();feedback.textContent='네이버 이웃추가 확장 도구 확인 중…';
    try{
      if(!await checkAdminSession(mine)||mine!==version)return;
      const ready=await bridge('PING');if(mine!==version)return;
      const value=String(ready.version||''),parts=value.split('.').map(Number),minimum=NAVER_NEIGHBOR_VERSION.split('.').map(Number),difference=parts.findIndex((n,i)=>n!==minimum[i]);
      if(!/^\d+\.\d+\.\d+$/.test(value)||parts.some(n=>!Number.isSafeInteger(n))||difference!==-1&&parts[difference]<minimum[difference])throw Object.assign(Error('extension_update'),{code:'extension_update'});
      for(const action of ['PREPARE','START']){const response=await bridge(action,action==='PREPARE'?{platform:'blog',control:'admin',expectedAccount:NAVER_NEIGHBOR_ACTOR,profiles:snapshot.profiles,expiresAt:snapshot.expiresAt}:{confirmed:true});if(mine!==version)return;if(!validateNaverNeighborJob(response.job,snapshot,action,state))throw Object.assign(Error('invalid_message'),{code:'invalid_message'});state=response.job;}
      while(state.running){const prior=state;if(!await checkAdminSession(mine)||mine!==version)return;render(snapshot,prior,'계정 확인·이웃추가 진행 중');feedback.textContent=`네이버 이웃추가 ${prior.index+1}/${snapshot.profiles.length} 처리 중… 관리자 화면에서 기다려 주세요.`;const response=await bridge('STEP',{index:prior.index},120000);if(mine!==version)return;if(!validateNaverNeighborJob(response.job,snapshot,'STEP',prior))throw Object.assign(Error('invalid_message'),{code:'invalid_message'});state=response.job;render(snapshot,state);}
      feedback.textContent='선택한 블로그 처리가 끝났습니다. 각 블로그의 이웃추가 완료·기존 이웃 상태를 확인하세요.';
    }catch(error){if(mine!==version)return;render(snapshot,state,'중지 · 결과 확인 필요');feedback.textContent=naverNeighborErrorMessage(error.code)+' 자동 재시도하지 않습니다.';if(error.code==='extension_update')help.open=true;if(requestId)post({type:'CANCEL',requestId});requestId=null;
    }finally{if(mine===version){busy=false;update();}}
  }
  run.addEventListener('click',()=>{
    update();if(run.disabled)return;const current=selection(),mine=++version;
    const expiresAt=Math.min(current.expiresAt||Date.now()+900000,Date.now()+900000);if(!Number.isFinite(expiresAt)||expiresAt<=Date.now()){feedback.textContent=ERRORS.expired;return;}
    selected={profiles:[...current.profiles],expiresAt,derived:current.derived};state=null;const snapshot=selected;render(snapshot,null);
    const confirm=node('button','확인한 블로그 이웃추가 시작','outline-button');confirm.type='button';confirm.id=prefix+'-naver-neighbor-start';review.append(confirm);feedback.textContent='실행 블로그와 위 대상 주소를 확인하세요. 아래 시작 버튼을 누르면 네이버의 기존 광고 그룹에 실제 일반 이웃추가가 실행됩니다.';
    confirm.addEventListener('click',()=>{confirm.disabled=true;start(snapshot,mine);});expiryTimer=setTimeout(()=>{if(selected!==snapshot)return;cancel();feedback.textContent=ERRORS.expired;update();},Math.max(0,snapshot.expiresAt-Date.now()));update();
  });
  stop.addEventListener('click',()=>{const snapshot=selected,previous=state,inFlight=pending?.action==='STEP';cancel();if(snapshot){render(snapshot,previous,inFlight?'중지 요청 · 결과 확인 필요':'중지됨');const mine=version;expiryTimer=setTimeout(()=>{if(mine!==version)return;cancel();feedback.textContent=ERRORS.expired;update();},Math.max(0,snapshot.expiresAt-Date.now()));}feedback.textContent='네이버 이웃추가 중지를 요청했습니다. 진행 중이던 블로그의 실제 상태를 확인하세요. 완료된 이웃추가는 유지되며 자동 재전송하지 않습니다.';update();});
  window.addEventListener('message',event=>{const data=event.data,item=pending;if(event.source!==window||event.origin!==location.origin||data?.source!=='spymedia-naver-neighbor-extension'||!item||!requestId||data.requestId!==requestId||data.requestId!==item.id||data.action!==item.action||data.type!=='ERROR'&&data.type!==(item.action==='PING'?'READY':'STATE'))return;clearTimeout(item.timer);pending=null;if(data.type==='ERROR')item.reject(Object.assign(Error('extension_error'),{code:typeof data.code==='string'?data.code:'invalid_message'}));else item.resolve(data);});
  window.addEventListener('pagehide',cancel);
  window.addEventListener('sns-auth-expired',()=>{expired=true;cancel();feedback.textContent='관리자 로그인이 만료되어 네이버 이웃추가 작업을 중지했습니다.';update();});
  update();return {update,clear:()=>{cancel();key='';feedback.textContent='';}};
}
