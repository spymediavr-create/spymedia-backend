const PHASES=new Set(['facebook_identity','facebook_link_create','facebook_link_verify','x_identity','x_link_create','x_link_verify','x_token_refresh']);
const SAFE_ERRORS=new Set(['channel_auth_or_permission','channel_rate_limit','channel_request_failed','channel_network_failure','channel_not_configured','account_mismatch','verify_publication','invalid_channel_response','x_auth_configuration','x_auth_expired','x_unauthorized','x_forbidden','x_payment_required','x_scope_missing','x_cost_confirmation_required','x_token_storage_unavailable','x_refresh_reauthorization_required']);
const TYPES=new Set(['OAuthException','GraphMethodException','FacebookApiException','APIException','Exception','invalid_grant','invalid_client','unauthorized_client','invalid_scope','unsupported_grant_type','temporarily_unavailable']);
// Exact problem URIs and titles become fixed identifiers. Never forward upstream prose or URLs.
const X_PROBLEMS=new Map([
  ['x_invalid_request','Invalid Request'],
  ['x_resource_not_found','Resource Not Found'],
  ['x_not_authorized_for_resource','Not Authorized For Resource'],
  ['x_client_forbidden','Client Forbidden'],
  ['x_usage_capped','Usage Cap Exceeded'],
  ['x_rate_limit_exceeded','Rate Limit Exceeded']
]);
const X_PROBLEM_URIS=new Map([...X_PROBLEMS.keys()].flatMap(type=>['api.x.com','api.twitter.com'].map(host=>['https://'+host+'/2/problems/'+type.slice(2).replaceAll('_','-'),type])));
const X_PROBLEM_TITLES=new Map([...X_PROBLEMS].map(([type,title])=>[title,type]));
X_PROBLEM_TITLES.set('Not Found Error','x_resource_not_found');
const integer=(value,max)=>Number.isInteger(value)&&value>=0&&value<=max?value:null;
function failureDetails(value={}) {
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const source=value.providerDetails&&typeof value.providerDetails==='object'&&!Array.isArray(value.providerDetails)?value.providerDetails:value;
  const result={};
  const http=integer(source.httpStatus,599);if(http!==null&&http>=100)result.httpStatus=http;
  const code=integer(source.providerCode,2147483647);if(code!==null)result.providerCode=code;
  const subcode=integer(source.providerSubcode,2147483647);if(subcode!==null)result.providerSubcode=subcode;
  if(X_PROBLEMS.has(source.providerType)){
    result.providerType=source.providerType;result.providerTitle=X_PROBLEMS.get(source.providerType);
  }else if(TYPES.has(source.providerType))result.providerType=source.providerType;
  if(PHASES.has(value.phase||value.errorPhase))result.phase=value.phase||value.errorPhase;
  return Object.keys(result).length?result:null;
}
function xProvider(data) {
  const candidates=[data,...(Array.isArray(data?.errors)?data.errors.slice(0,5):[])].filter(value=>value&&typeof value==='object'&&!Array.isArray(value));
  const code=candidates.map(value=>integer(value.code,2147483647)).find(value=>value!==null);
  // A supplied unknown type stays unknown; a familiar title cannot override it.
  const typed=candidates.find(value=>value.type!==undefined&&value.type!=='about:blank');
  const type=typed?X_PROBLEM_URIS.get(typed.type):candidates.map(value=>X_PROBLEM_TITLES.get(value.title)).find(Boolean);
  return {code,type:type||(!typed&&TYPES.has(data?.error)?data.error:undefined)};
}
function providerFailure(response,method,host) {
  const meta=host==='graph.facebook.com'||host==='graph-video.facebook.com'||host==='graph.instagram.com';
  const x=host==='api.x.com';
  const provider=meta&&response.data?.error&&typeof response.data.error==='object'?response.data.error:x?xProvider(response.data):{};
  const details=failureDetails({httpStatus:response.status,providerCode:provider.code,providerSubcode:provider.error_subcode,providerType:provider.type});
  const code=details?.providerCode;
  const auth=response.status===401||response.status===403||meta&&[10,102,190,200].includes(code);
  const limited=response.status===429||meta&&[4,17,32,613].includes(code);
  const errorCode=x&&response.status===401?'x_unauthorized':x&&response.status===403?'x_forbidden':x&&response.status===402?'x_payment_required':auth?'channel_auth_or_permission':limited?'channel_rate_limit':'channel_request_failed';
  // Remote authentication failures are local 409s, so they cannot expire the administrator session.
  return {status:auth||x&&response.status===402?409:limited?429:502,code:errorCode,uncertain:method!=='GET'&&response.status>=500,providerDetails:details};
}
function safeFailureCode(value){return SAFE_ERRORS.has(value)||['facebook_check_rate_limited','x_check_rate_limited','invalid_connection_check_input'].includes(value)?value:'request_failed';}
function logJobFailure(job={},details) {
  const entry={event:'sns_job_failed',channel:job.channel==='x'?'x':'facebook',error:SAFE_ERRORS.has(job.error)?job.error:'channel_request_failed',...failureDetails(details)};
  if(typeof job.id==='string'&&/^[a-f0-9-]{36}$/.test(job.id))entry.jobId=job.id;
  // Never log provider messages, request/response bodies, URLs, headers or credentials.
  console.error(JSON.stringify(entry));
}
function logXConnectionFailure(value) {
  const details=failureDetails(value);
  if(!details?.phase?.startsWith('x_')||!details.httpStatus)return;
  console.error(JSON.stringify({event:'sns_connection_failed',channel:'x',error:safeFailureCode(value.code),...details}));
}
module.exports={failureDetails,providerFailure,logJobFailure,logXConnectionFailure,safeFailureCode};
