# SpyMedia Instagram 선택 팔로우 도구

Chrome 또는 Edge에서 검토한 Instagram 계정을 순서대로 팔로우하는 별도의 Manifest V3 확장 기능입니다. Instagram 공식 API가 아니며 Instagram의 운영 정책과 활동 제한이 적용됩니다. 제한을 우회하거나 숨기는 기능, 자동 로그인, CAPTCHA 처리, 프록시, 무작위 동작, 비공개 API, 자동 재시도는 없습니다.

**실제 Instagram 화면에서의 동작은 아직 검증하지 않았습니다.** 현재 검증은 합성 DOM과 모의 Chrome API로 실시합니다. Instagram 화면 구조가 다르면 아무 팔로우도 하지 않고 중지하도록 설계했습니다. 사용자 계정의 실사용 검증은 별도 확인 후 해야 합니다.

## 설치

1. 이 디렉터리의 파일을 로컬 폴더에 압축 해제합니다. 빌드나 Node 설치는 필요 없습니다.
2. Chrome은 `chrome://extensions`, Edge는 `edge://extensions`를 열고 개발자 모드를 켭니다.
3. ‘압축해제된 확장 프로그램을 로드합니다’로 `manifest.json`이 들어 있는 폴더를 선택합니다.
4. **같은 브라우저 프로필**에서 SpyMedia 관리자와 Instagram `spymedia_kr` 계정에 직접 로그인합니다. Codex의 내장 브라우저와 일반 Chrome 로그인은 별개입니다.
5. 관리자 페이지를 새로고침한 뒤 Instagram 검색 결과를 검토하고 최대 10개를 선택해 준비합니다.
6. 열린 확장 기능 탭에서 실행 계정과 대상 목록을 다시 확인하고 동의 체크 후 시작합니다. 준비하거나 체크하는 것만으로 팔로우하지 않습니다.

브라우저에 확장 기능을 설치하는 것은 사용자가 수행하는 별도 단계입니다. Render 배포만으로 PC 브라우저에 자동 설치되지 않습니다. 스토어 등록이나 새 유료 서비스는 필요하지 않습니다.

## 작동 방식

- 허용된 출발 화면은 정확히 `https://spymedia-backend.onrender.com/admin`입니다. 로그인 페이지, 하위 경로, 하위 프레임, 다른 호스트의 요청은 거부합니다.
- 관리자 원본 창의 `window.postMessage`만 받습니다. 임의 프로필·게시물 URL이나 계정 변경값은 허용하지 않습니다.
- 준비된 작업은 최대 15분, 대상은 1~10개입니다. `spymedia_kr` 자기 자신, 중복, 쿼리·해시·예약 경로는 거부합니다.
- 여러 관리자 탭을 열어도 확장 기능 전체에서 작업 하나만 허용합니다. 시작한 작업은 재시작할 수 없으며, 오류가 나면 기존 결과를 확인한 후 명시적으로 지워야 새 작업을 준비할 수 있습니다.
- 검색어, 검색 결과 설명, 개인 정보, 토큰은 전달받지 않습니다. 선택한 정규 프로필 URL만 사용합니다.
- 대상과 결과는 확장 기능의 메모리에만 존재합니다. `chrome.storage`, DB, 로그, 파일, localStorage, sessionStorage, 실행기 URL 등에 저장하지 않습니다. 서비스 워커가 재시작되면 작업은 소실되며 자동 재개하지 않습니다.
- 실제 Instagram 방문은 일반 브라우저 탐색이므로 현재 프로필이 주소창과 **브라우저 자체 방문 기록**에 남을 수 있습니다. 확장 기능은 브라우저의 방문 기록을 별도로 읽거나 저장하지 않습니다.
- Instagram 탭 하나를 열어 대상별로 이동합니다. 계정 이름을 탐색 메뉴의 명시적인 ‘Profile/프로필’ 링크로 확인하고, 본문 프로필 헤더의 이름과 대상 URL도 함께 확인합니다.
- 정확한 ‘Follow/팔로우’ 버튼 하나만 클릭합니다. ‘Following/팔로잉’ 및 ‘Requested/요청됨’은 건너뜁니다. 추천 목록 버튼, ‘Follow back/맞팔로우’, 알 수 없는 언어, 여러 후보 버튼은 클릭하지 않습니다.
- 한 번 클릭한 뒤 표시 상태가 바뀌었는지 읽기만 합니다. 불명확하면 중지하며 다시 클릭하지 않습니다. 비공개 계정의 ‘요청 전송’은 ‘팔로우 완료’와 구분합니다.
- 중간 오류가 발생해도 앞서 확인한 완료 결과와 현재 확인이 필요한 행은 원래 유효 시간 동안 실행기에 남습니다. 명시적인 작업 지우기, 창 닫기, 관리자 이탈·로그아웃, 만료 시에는 목록과 결과를 지웁니다.
- 관리자 로그아웃·이탈·탭 닫기, 실행기 또는 작업용 Instagram 탭 닫기, TTL 만료, 계정 불일치, 로그인·추가 인증·제한 화면에서 중지합니다. 중지 전에 완료된 팔로우는 취소하지 않습니다.

### 화면 구조 제한

현재 DOM 계약은 탐색 영역 `nav`, `aside`, `[role="navigation"]`의 명시적인 ‘Profile/프로필’ 링크와 `main header` 안의 일치하는 `h1/h2` 이름을 필요로 합니다. 이 영역이 없는 Instagram 버전은 안전하게 중지합니다. 동작하지 않는다고 전체 페이지의 아무 ‘팔로우’ 버튼이나 선택하는 식으로 완화하면 잘못된 계정을 팔로우할 수 있으므로 금지합니다. 실제 화면을 확인한 후 계정과 대상 식별 조건을 보존하면서 호환성을 수정해야 합니다.

## 관리자 인터페이스

`window.postMessage(message, 'https://spymedia-backend.onrender.com')`

```js
{
  source: 'spymedia-admin-follow', type: 'PREPARE', requestId: crypto.randomUUID(),
  platform: 'instagram', expectedAccount: 'spymedia_kr',
  profiles: ['https://www.instagram.com/reviewed_studio/'],
  expiresAt: Date.now() + 15 * 60 * 1000
}
```

`PING`과 `CANCEL`은 `source`, `type`, `requestId`만 받습니다. 관리자 측은 로그아웃·작업 취소 시 같은 `requestId`로 `CANCEL`을 보내야 합니다. 브리지도 `pagehide` 때 취소합니다. 응답의 `source`는 `spymedia-follow-extension`이고 `type`은 `READY`, `ACCEPTED`, `ERROR`이며, 일치하는 `requestId`와 버전 `0.1.0`을 포함합니다. `ERROR`에는 제한된 오류 코드만 포함합니다. `ACCEPTED`는 확장 기능에 준비한 상태이며 팔로우 성공을 뜻하지 않습니다. 실제 결과는 실행기 창에만 표시합니다.

## 테스트

저장소 루트에서 `node --test admin-ui/tests/instagram-follow-extension.test.mjs`.

검증 범위: URL·계정·TTL·선택 수 검사, 원본 관리자 탭과 메시지 출처 검증, 메모리 만료·취소, 잘못된 계정/프로필·로그인·제한 화면, 이미 팔로우/요청, 추천 버튼·맞팔로우 무시, 명시적 실행 동의, 모의 Chrome 순차 동작 및 중복 단계 방지.

미검증: 실제 Instagram DOM, 실제 계정 제한과 공개 팔로우 결과, 사용자의 브라우저 확장 설치와 세션 연동. 자동화를 플랫폼이 허용한다거나 일정 건수 이하가 안전하다는 보장은 하지 않습니다.
