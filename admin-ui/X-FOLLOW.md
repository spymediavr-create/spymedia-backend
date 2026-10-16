# X에서 검토한 계정 한 개 팔로우

`backend/x-follows.cjs`는 기존 X 인증 객체와 저장소를 재사용하여 관리자가 확인한 계정 **한 개**에 공식 API 요청을 보낸다. 대량 팔로우, 자동 맞팔, 예약 실행, 검색 결과 반복 실행 기능은 제공하지 않는다. X는 공식 팔로우 API를 제공하지만 대량·공격적·무차별 팔로우는 자동화 규칙에서 금지한다.

- 공식 엔드포인트: <https://docs.x.com/x-api/users/follow-user>
- 인증 방식과 OAuth 2.0 범위: <https://docs.x.com/fundamentals/authentication/guides/v2-authentication-mapping>
- 자동화 규칙: <https://help.x.com/en/rules-and-policies/x-automation>

## 기존 서비스 연결

```js
const {XFollows} = require('./x-follows.cjs');
this.xFollows = new XFollows(this.settings, this.store, this.connectors.xAuth);
```

인증된 관리자 요청과 기존 CSRF 검증 뒤에서 다음 메서드에 연결한다. 외부 공급자 오류 내용이나 요청 본문을 로그에 기록하지 않는다.

| 메서드 | 용도 |
| --- | --- |
| `status()` | 로컬 설정 준비 여부. 네트워크 요청 없음 |
| `prepare({username, selectionExpiresAt?})` | `/2/users/me`와 `/2/users/by/username/{username}` GET으로 실제 계정 확인 |
| `execute({preparationId, confirmationToken, confirmUsername, confirmTargetUserId, confirmed:true})` | 검토한 단일 계정에 정확히 한 번 POST |
| `result(operationId)` | 저장한 결과 조회. 추가 외부 요청 없음 |

`prepare` 응답은 다음 형태다. 이름·사용자명·프로필 주소·확인 토큰은 메모리에서만 유지하며 DB에 보관하지 않는다.

```js
{
  preparationId, confirmationToken, expiresAt, // ISO 날짜
  source: {userId, username: 'spymedia_kor'},
  target: {userId, username, name, profileUrl},
  existingResult: null // 기존 시도 기록이 있으면 결과 객체
}
```

UI는 출발 계정, 대상 계정의 이름·사용자명·숫자 ID를 보여주고 별도 확인 동작을 받아야 한다. 선택만으로 `execute`를 호출하지 않는다. 여러 계정을 반복해서 확인/전송하는 루프를 추가하지 않는다. `existingResult`가 있으면 새 전송 대신 기존 결과를 표시한다.

`selectionExpiresAt`은 검색 결과 만료 시각의 Unix 밀리초 정수다. 최대 현재 시각 + 15분이며 확인 준비 유효기간은 `min(현재 + 5분, selectionExpiresAt)`이다. 이를 지정하면 임시 검색 결과의 원래 수명을 연장하지 않는다. 저장 후보는 이 필드를 생략한다. 서버의 `unref()` 타이머가 유효기간 종료 시 메모리를 지우며, 요청 시에도 만료 여부를 확인한다. 최대 10개 준비 객체, 조회 간격 5초는 실수와 중복 조회를 줄이기 위한 내부 제한이다. 플랫폼이 보장한 안전한 팔로우 속도가 아니다.

## 운영 설정과 권한

- 새 `X_FOLLOW_ENABLED=true`가 있어야 실행할 수 있다. 기본값은 비활성이다.
- 기존 `X_COST_LIMIT_ACKNOWLEDGED=true`, 유효한 기존 X 인증 정보, 영속 저장소·단일 인스턴스 확인 설정도 필요하다.
- 소스 계정은 GET으로 확인한 `spymedia_kor`여야 하며 실행 직전 같은 숫자 사용자 ID인지 다시 확인한다.
- OAuth 1.0a는 기존 `XAuth` 서명 로직을 그대로 사용한다. OAuth 2.0은 기존 사용자 토큰을 사용한다. 공식 문서의 OAuth 2.0 요구 범위는 `tweet.read users.read follows.write`다.
- 이 기능은 토큰 갱신, 재인증, 권한 추가, 과금 설정 변경을 하지 않는다. 토큰이 만료되었으면 중단한다. `XAuth.call`에 항상 `allowRefresh:false`를 전달한다.
- `status().ready`는 로컬 설정만 뜻한다. 실제 팔로우 권한이나 요금제 접근 가능 여부를 검증한 뜻이 아니다. 실제 API 요청을 수행하기 전까지 `followPermissionsVerified:false`다.
- 활성화, 새 권한/토큰, 추가 비용, 실제 테스트 팔로우는 사용자와 별도로 확인한다. 구현·모의 테스트 과정에서는 실제 X 계정에 요청하지 않는다.

## 중복 방지와 결과 의미

`journal.json`에 `xFollows: {version:1, records:{...}}`를 추가한다. 기존 저장소는 추가 키를 보존하므로 기존 `Store` 스키마 변경이 필요 없다. 기존 게시물·사진·릴스·후보 데이터는 변경하지 않는다.

외부 POST **이전**에 `unknown` 상태를 디스크에 원자적으로 저장한다. 보관 내용은 임의 작업 ID, 검증된 발신·대상 숫자 ID, 상태, 시각, 고정 오류 코드뿐이다. 레코드 키는 `SHA256(발신 ID + ':' + 대상 ID)`다. 임시 검색 결과의 원문·이름·사용자명·프로필 링크, 토큰, 공급자 응답·오류 원문은 기록하지 않는다.

같은 계정 쌍의 기록이 있으면 재시도, 서버 재시작, 새 확인 준비에서도 두 번째 POST를 하지 않는다. 서버 공유 잠금은 동시 실행을 거부하며 저장소 트랜잭션도 같은 쌍의 예약을 직렬화한다. 운영은 기존 단일 인스턴스 영속 저장소 전제를 유지한다. 실행 기록은 최대 2,000개이며 초과 시 중단한다. 기록을 자동 삭제하거나 자동 재시도하지 않는다.

| 결과 | 의미 |
| --- | --- |
| `followed` | X 응답에서 팔로우 상태가 참이며 대기 상태가 아님 |
| `requested` | 비공개 계정 등에 팔로우 요청 대기 중. 수락 완료가 아님 |
| `failed` | 명시적인 인증·권한·비용·제한 오류 또는 미완료 응답 |
| `unknown` | 응답 불명, 중단 또는 결과 저장 실패. X에서 직접 확인 필요 |

결과 객체에는 `operationId`, `status`, `sourceUserId`, `targetUserId`, `createdAt`, `updatedAt`, `requestAttempted:true`, 필요 시 `errorCode`가 있다. `requestAttempted`는 쓰기 시도 예약이 남아 있다는 뜻이며, `unknown`이면 외부 반영 여부를 증명하지 않는다. 중복 차단 응답에는 `duplicatePrevented:true`, 최종 결과 저장 실패 응답에는 `resultPersistenceFailed:true`가 추가된다. 두 경우 모두 자동 재전송하지 않는다.

명시적으로 실패한 기록도 임의로 초기화하지 않는다. 운영자가 X 상태와 오류 원인을 확인한 뒤 별도의 복구 작업이 필요하다. 자동 초기화/재시도 엔드포인트는 제공하지 않는다.

## 테스트

```powershell
node --test admin-ui/tests/x-follows.test.mjs
```

외부 요청은 모두 모의 객체로 대체한다. 기능 기본 비활성, 비용·저장소·인증 차단, 정확한 계정 확인, 명시적 단일 확인, 자기 자신 차단, 만료, 동시 클릭, 재시작 중복 차단, 저장 전 실패·저장 후 실패, 결과 불명, 공급자 오류 비노출, 대기 상태 구분, 검색 정보 비영속성을 검증한다.
