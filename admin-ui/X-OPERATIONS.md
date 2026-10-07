# X 공식 API 링크 자동화

대상은 `@spymedia_kor`입니다. 사용자가 검토한 짧은 소개글과 정규화된 YouTube 주소만 `POST /2/tweets`로 전송합니다. 사진·영상 업로드와 `media.write`는 이 흐름에 필요하지 않습니다. 기존 Facebook 성공 게시·토큰, compact 목록, 홈페이지 API와 저장 자료를 유지합니다.

## 기존 인증 재사용

이전 X API 연결·테스트는 사용자 확인 사항입니다. 저장소에는 실제 인증 방식·운영 설정의 증거가 없어 현재 연결 성공을 단정하지 않습니다. 기존 Render Environment에서 **값을 가린 변수 이름과 OAuth 방식만** 먼저 확인합니다. 키·시크릿·토큰을 채팅, 소스, Git, 로그로 전달하지 않습니다.

| 방식 | 서버 변수 이름 | 동작 |
|---|---|---|
| OAuth 1.0a | `X_AUTH_MODE=oauth1`, `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` | 기존 사용자 네 개 키로 매 요청 HMAC-SHA1 서명. 기존 앱과 사용자 인증에 Read and Write 권한이 필요합니다. |
| OAuth 2.0 사용자 토큰 | `X_AUTH_MODE=oauth2`, 기존 `X_USER_ACCESS_TOKEN` | 사용자 Bearer 인증. App-only Bearer 또는 OAuth 1.0a Access Token 하나를 여기에 넣지 않습니다. |
| OAuth 2.0 자동 갱신 | 위 설정과 `X_OAUTH_CLIENT_ID`, `X_OAUTH_REFRESH_TOKEN`, `X_TOKEN_ENCRYPTION_KEY`; confidential client이면 기존 `X_OAUTH_CLIENT_SECRET` | 이미 발급된 `offline.access` refresh grant를 재사용하고 회전된 토큰을 암호화 저장합니다. |

한 방식만 설정되어 있으면 자동 판별합니다. 두 방식의 설정이 함께 있으면 `X_AUTH_MODE`로 선택해야 하며, 불완전한 인증은 API 호출 전에 차단합니다. OAuth 2.0 링크 전송의 최소 권한은 `tweet.read users.read tweet.write`입니다. OAuth 2.0 access token 기본 유효기간은 2시간입니다. 선택적으로 `X_USER_ACCESS_TOKEN_EXPIRES_AT`에 기존 access token의 ISO 만료 시각을 지정할 수 있습니다. 시각을 알 수 없으면 계정 조회의 HTTP 401에서만 한 번 갱신하며 POST는 재실행하지 않습니다.

`offline.access`가 없는 기존 OAuth 2.0 연결은 사용자 재인증이 별도로 필요할 수 있습니다. 이 구현은 새 grant·권한·토큰을 자동 발급하지 않습니다. 실제 비밀 입력과 필요한 새 연결은 사용자 승인 후 X/Render의 안전한 입력 경로에서 사용자가 수행합니다. 기존 변수 이름이 다르면 비밀 값을 이동시키기 전에 이름 매핑을 확인합니다.

## 갱신과 비밀 보관

기존 `SNS_DATA_DIR` 영구 저장소와 single-instance 확인을 재사용합니다. 갱신에는 `X_TOKEN_ENCRYPTION_KEY`의 32바이트 hex 키가 필요하며 사용자가 직접 Render에 입력합니다. 암호화 키를 기존 미디어 서명 키와 겸용하지 않습니다. 키를 채팅으로 요청하거나 출력하는 관리 API는 없습니다.

access/refresh token은 AES-256-GCM으로 암호화한 `x-oauth2.enc.json`에 저장합니다. client ID를 인증된 추가 데이터에 묶고, 임시 파일 기록·fsync·원자적 교체로 회전 상태를 보존합니다. 파일은 저장소/public 밖에 두고 Unix 권한 0600을 사용합니다. 심볼릭 링크·변조·다른 client/key는 실패로 처리하며 기존 파일을 자동 덮어쓰거나 삭제해 복구하지 않습니다. 환경변수 초기 토큰보다 저장된 최신 회전 토큰을 우선합니다.

같은 프로세스의 병렬 갱신은 하나의 요청을 공유합니다. 외부 갱신 POST 전 암호화된 진행 표시를 저장합니다. 네트워크 실패·응답 불확실·토큰 저장 실패·재시작으로 갱신 완료를 입증하지 못하면 추가 갱신과 게시를 중단합니다. 이때 기존 토큰을 재사용하거나 새 토큰을 임의 발급하지 않고, 승인된 연결 복구가 필요합니다. 여러 인스턴스로 변경하려면 먼저 공유 잠금과 저장 설계를 추가해야 합니다.

## 연결 진단

관리자의 **X 연결 확인**은 기존 사용자 인증으로 `GET https://api.x.com/2/users/me`만 실행합니다. 로그인·동일 Origin·CSRF가 필요하고 `POST /api/admin/x/check` 입력은 빈 JSON 객체만 허용합니다. 모든 관리자 세션을 합쳐 60초에 한 번만 허용하며 진행 중 중복과 실패한 확인도 제한에 포함합니다.

페이지 로딩·목록 갱신·작업 준비는 X API를 호출하지 않습니다. 연결 확인은 조회 비용 안내 후 명시적 버튼 확인이 필요합니다. 진단에서는 OAuth 갱신 POST·실제 게시를 실행하지 않습니다. 대상 username과 안전한 숫자 user ID만 확인하고 원격 name/메시지/토큰은 표시하지 않습니다. 인증 성공도 글쓰기 권한·잔액·지출 상한·게시 성공을 증명하지 않습니다.

HTTP 상태, 허용한 정수 오류 코드·고정 오류 종류·확인 단계만 응답과 작업 이력에 보관합니다. 요청/응답 원문·URL·Authorization 헤더·시크릿은 기록하지 않습니다.

### 거절 응답 해석과 안전한 확인

X의 HTTP 401은 `x_unauthorized`(인증 거절), 403은 `x_forbidden`(접근 거절), 402는 `x_payment_required`(이용 상태 확인)로 구분합니다. 관리자 세션 만료와 혼동하지 않도록 외부 401·403은 로컬 HTTP 409로 반환하고 실제 X 상태는 진단 상세에 표시합니다. 403만으로 토큰 만료·재발급 필요 또는 추가 결제 필요를 판단하지 않습니다.

X v2의 최상위 오류 또는 `errors` 항목에서 알려진 problem URI만 `x_client_forbidden`, `x_not_authorized_for_resource`, `x_usage_capped`, `x_rate_limit_exceeded`, `x_invalid_request`, `x_resource_not_found`로 정규화합니다. 알려진 정확한 제목도 유형이 없을 때만 정규화하며, 제공된 알 수 없는 유형을 제목으로 덮어 해석하지 않습니다. 원격 URI·제목·detail은 반환하지 않고 고정 유형과 고정 제목만 보존합니다. 상세 유형이 없으면 화면에 **세부 원인: 알 수 없음**을 표시합니다. 연결 실패 로그의 `sns_connection_failed`도 고정 오류 코드·HTTP 상태·단계·정규화된 유형/제목만 포함합니다. 게시 실패 로그와 저장 이력도 동일한 필터를 사용합니다.

추가 API 호출 없이 사용자가 Developer Console과 Render에서 다음 상태만 확인할 수 있습니다. 키를 재발급하거나 비용을 추가하기 전에 현재 상태를 먼저 확인합니다.

1. 네 값의 출처가 모두 같은 앱 **31176138**인지 확인합니다. `API Key → X_API_KEY`, `API Key Secret → X_API_SECRET`, `Access Token → X_ACCESS_TOKEN`, `Access Token Secret → X_ACCESS_TOKEN_SECRET` 이름만 대조합니다. 저장된 값을 로컬 앱 세션에서 사용자가 직접 확인하고 채팅·스크린샷·로그에 전달하지 않습니다. 과거 기록으로 출처를 입증할 수 없으면 “동일 앱 여부 미확인”으로 남깁니다.
2. 그 앱의 소속 프로젝트/현재 API 접근 상태·비활성 또는 차단 표시를 확인합니다. 결제한 계정의 프로젝트와 기존 앱의 연결을 별도로 확인합니다. 잔액이 있다는 사실만으로 앱 접근이 허용됐다고 판단하지 않습니다.
3. 사용자 인증의 현재 Read and Write 표시, 기존 Access Token의 계정과 권한 표시(제공되는 경우), 이전 폐기·재발급·권한 변경 이력을 확인합니다. 확인 대상 계정은 `@spymedia_kor`입니다. 앱의 현재 권한과 기존 토큰의 유효성을 동일하게 취급하지 않습니다.
4. 이미 확인한 무료 크레딧과 자동충전 off 상태를 유지하며, 현재 잔액·지출 한도·차단 안내만 읽습니다. 더 충전하거나 토큰을 다시 발급해 보라는 자동 권고는 하지 않습니다. 안전한 오류 유형이 없으면 원인이 아직 밝혀지지 않았음을 명시하고 새 유료 조회는 별도 승인 전까지 중단합니다.

OAuth 1.0a 사용자 토큰에는 고정 만료시간이 없고 사용자 폐기는 가능합니다. 오래 사용하지 않았다는 사실만으로 만료됐다고 판단하지 않습니다. 자료: [사용자 토큰](https://docs.x.com/fundamentals/authentication/oauth-1-0a/obtaining-user-access-tokens), [오류 유형](https://docs.x.com/x-api/fundamentals/response-codes-and-errors).

비용 확인 설정이 꺼져 있으면 버튼을 **X 조회 사용 중지**로 표시하고 옆에 **조회 사용 중지(비용 확인 필요). 현재 X 조회는 실행되지 않습니다.**를 안내합니다. 이는 새 조회 실패나 화면 멈춤을 의미하지 않습니다. 인증 설정이 없으면 같은 위치에서 **인증 설정 필요**를 구분해 안내합니다. 화면 표시를 위해 비용/게시 설정을 자동으로 켜지 않습니다.

## 비용과 전송

공식 요금표 확인 기준 2026-10-06: URL 포함 글 생성은 요청당 **US$0.200**, 일반 글 생성은 **US$0.015**입니다. 계정 조회는 User Read 단가 US$0.010, 게시 결과 조회는 Post Read 단가 US$0.005가 별도로 적용될 수 있습니다. 실제 가격과 계정 적용 조건은 Developer Console에서 확인합니다. 조회도 무료라고 가정하지 않습니다.

`X_COST_LIMIT_ACKNOWLEDGED=true`는 사용자가 비용을 확인했다는 전송/진단 허용값입니다. **숫자 예산이나 실제 비용 상한을 적용하지 않습니다.** 실제 billing-cycle spending limit과 잔액·자동충전은 X Developer Console에서 관리합니다. 크레딧 구매·자동충전·플랜 변경을 자동 실행하지 않습니다. 코드가 기본값을 true로 바꾸지 않습니다.

실제 전송에는 기존 공통 `SNS_PUBLISH_ENABLED=true`와 `X_PUBLISH_ENABLED=true`, 비용 확인값, 완전한 사용자 인증이 모두 필요합니다. 준비는 무료 로컬 작업이며 게시하지 않습니다. 선택한 저장 문구·주소와 X 링크 생성 건수/가격을 확인한 뒤 요청합니다. 게시 전 계정을 조회하고 POST 전에 저널 체크포인트를 기록하며 응답의 게시 ID를 다시 조회합니다. 성공 이력과 중복 키를 유지하고 불확실한 결과는 `unknown`으로 정지합니다. 자동 게시 재시도나 새 중복 작업 생성은 하지 않습니다.

## 현재 검증과 다음 단계

이번 로컬 오류 표시 개선은 합성 자격증명·임시 저장소·모의 API만 사용해 검증했습니다. 개발자의 실제 X API 호출·게시·갱신·크레딧 구매·인증정보 변경은 0건이고, push·배포는 아직 하지 않았습니다.

사용자는 기존 OAuth 1.0a 네 값을 Render에 직접 입력했고, 별도 승인한 계정 조회를 2회 실행했습니다. 첫 조회의 HTTP 403은 확인됐고, 두 번째는 같은 공통 오류 문구만 보고되어 HTTP 숫자가 미확인입니다. 무료 크레딧 등록과 자동충전 off는 사용자 측 확인 사항이며, 이것만으로 실제 앱의 API 접근 또는 토큰 유효성을 입증하지 않습니다. 조회 비용 확인·X 게시 설정은 조회 후 꺼두는 운영 상태를 유지합니다. 비활성 버튼 옆 비용 안내는 새 조회의 실패 결과가 아닙니다.

1. 위 안전한 확인 절차로 네 값의 동일 앱 출처와 앱/프로젝트 접근 상태를 먼저 확인합니다. 기존 값을 채팅에 전달하거나 무조건 재발급·추가 결제하지 않습니다.
2. 오류 표시 개선의 배포를 승인받으면 기존 Render 서비스에만 반영하고 꺼진 조회/게시 설정과 Facebook 공통 설정·인증정보를 보존합니다.
3. 과거 오류의 버려진 세부 응답은 복원할 수 없습니다. 추가 조회를 승인받기 전까지 X 요청을 중단합니다. 이후 별도 승인된 조회에서 안전한 유형·HTTP 상태를 확인합니다.
4. 실제 게시에는 정확한 테스트 문구·YouTube 주소·대상과 게시 승인이 별도로 필요합니다. 연결 진단 성공만으로 게시 설정을 켜지 않습니다.

자료: [X OAuth 1.0a 서명](https://docs.x.com/fundamentals/authentication/oauth-1-0a/creating-a-signature), [X OAuth 2.0](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code), [권한 매핑](https://docs.x.com/fundamentals/authentication/guides/v2-authentication-mapping), [공식 요금](https://docs.x.com/x-api/getting-started/pricing), [RFC 5849](https://www.rfc-editor.org/rfc/rfc5849).
