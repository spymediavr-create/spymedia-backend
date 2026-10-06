const PHASES=new Set(['facebook_identity','facebook_link_create','facebook_link_verify']);
const SAFE_ERRORS=new Set(['channel_auth_or_permission','channel_rate_limit','channel_request_failed','channel_network_failure','channel_not_configured','account_mismatch','verify_publication','invalid_channel_response']);
const TYPES=new Set(['OAuthException','GraphMethodException','FacebookApiException','APIException','Exception']);
const integer=(value,max)=>Number.isInteger(value)&&value>=0&&value<=max?value:null;
function failureDetails(value={}) {
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const source=value.providerDetails&&typeof value.providerDetails==='object'&&!Array.isArray(value.providerDetails)?value.providerDetails:value;
  const result={};
  const http=integer(source.httpStatus,599);if(http!==null&&http>=100)result.httpStatus=http;
  const code=integer(source.providerCode,2147483647);if(code!==null)result.providerCode=code;
  const subcode=integer(source.providerSubcode,2147483647);if(subcode!==null)result.providerSubcode=subcode;
  if(TYPES.has(source.providerType))result.providerType=source.providerType;
  if(PHASES.has(value.phase||value.errorPhase))result.phase=value.phase||value.errorPhase;
  return Object.keys(result).length?result:null;
}
function providerFailure(response,method,host) {
  const meta=host==='graph.facebook.com'||host==='graph-video.facebook.com'||host==='graph.instagram.com';
  const provider=meta&&response.data?.error&&typeof response.data.error==='object'?response.data.error:{};
  const details=failureDetails({httpStatus:response.status,providerCode:provider.code,providerSubcode:provider.error_subcode,providerType:provider.type});
  const code=details?.providerCode;
  const auth=response.status===401||response.status===403||meta&&[10,102,190,200].includes(code);
  const limited=response.status===429||meta&&[4,17,32,613].includes(code);
  const errorCode=auth?'channel_auth_or_permission':limited?'channel_rate_limit':'channel_request_failed';
  return {status:auth?409:limited?429:502,code:errorCode,uncertain:method!=='GET'&&response.status>=500,providerDetails:details};
}
function safeFailureCode(value){return SAFE_ERRORS.has(value)||['facebook_check_rate_limited','invalid_connection_check_input'].includes(value)?value:'request_failed';}
function logJobFailure(job={},details) {
  const entry={event:'sns_job_failed',channel:'facebook',error:SAFE_ERRORS.has(job.error)?job.error:'channel_request_failed',...failureDetails(details)};
  if(typeof job.id==='string'&&/^[a-f0-9-]{36}$/.test(job.id))entry.jobId=job.id;
  // Never log provider messages, request/response bodies, URLs, headers or credentials.
  console.error(JSON.stringify(entry));
}
module.exports={failureDetails,providerFailure,logJobFailure,safeFailureCode};
