const form = document.querySelector('#login-form');
const button = document.querySelector('#login-submit');
const feedback = document.querySelector('#login-feedback');
const password = document.querySelector('#login-password');
if(new URLSearchParams(location.search).get('reason')==='session_expired')feedback.textContent='로그인이 만료됐습니다. 서버 재시작이나 로그인 제한 시간 경과 때 발생할 수 있습니다. 다시 로그인하면 서버에 보관한 콘텐츠를 확인할 수 있습니다.';
document.querySelector('#toggle-password').addEventListener('click', event => {
  const show = password.type === 'password';
  password.type = show ? 'text' : 'password';
  event.currentTarget.textContent = show ? '숨기기' : '보기';
  event.currentTarget.setAttribute('aria-label', show ? '비밀번호 숨기기' : '비밀번호 표시');
  event.currentTarget.setAttribute('aria-pressed', String(show));
});
try {
  const response = await fetch('/api/admin/status', {cache: 'no-store'});
  if (!response.ok) throw new Error('status');
  const status = await response.json();
  if (status.authenticated) location.replace('/admin');
  button.disabled = !status.authenticationConfigured || status.mode === 'preview';
  document.querySelector('#preview-entry').hidden = status.mode !== 'preview';
  if (button.disabled) {
    document.querySelector('#login-id').disabled = true;
    password.disabled = true;
    document.querySelector('#toggle-password').disabled = true;
    feedback.textContent = '인증 연결 전 · 실사용 비밀번호를 입력하지 마세요.';
  }
} catch {
  feedback.textContent = '서버 상태를 확인할 수 없습니다. 서버 실행 상태를 확인하세요.';
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (button.disabled || !form.reportValidity()) return;
  button.disabled = true;
  feedback.textContent = '로그인 확인 중…';
  try {
    const response = await fetch('/api/admin/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({username: document.querySelector('#login-id').value, password: password.value})});
    password.value = '';
    if (!response.ok) throw new Error(response.status === 429 ? '잠시 후 다시 시도하세요.' : '로그인 정보를 확인하세요.');
    location.replace('/admin');
  } catch (error) { password.value = ''; feedback.textContent = error.message; button.disabled = false; }
});
