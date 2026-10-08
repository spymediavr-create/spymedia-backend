# Instagram 사진 1장 전송

관리자 `/admin/instagram`에서 기존 제목·설명·해시태그를 사용해 JPEG 사진 1장을 저장하고, 준비 목록에서 사진과 저장된 문구를 확인한 뒤 명시적으로 전송한다. 기존 Instagram 메인 카드·미리보기 탭과 Business Suite 준비 도우미를 유지한다. 영상 변환과 Reels 직접 전송은 이번 범위에 포함하지 않는다.

## 이번 구현의 제한

- JPEG 1장, 최대 8MB, 가로 320–1,440px, 비율 4:5–1.91:1, 제목·설명·태그 총 2,200자 이하.
- 사진 바이트를 변환하지 않는다. 다른 형식이나 크기는 준비 단계에서 거절한다. 기존 사진 업로더의 JPEG 헤더 검증을 사용하며 전체 이미지 디코딩·색 공간·EXIF 보정은 하지 않는다.
- YouTube 시청 URL, 영상, 복수 사진을 사진 게시 요청으로 받지 않는다. 기존 영상 작업의 변환·재시도 제한을 해제하지 않는다.
- 계정 확인은 기존 Instagram Login 토큰을 사용하는 GET 요청만 실행한다. 페이지 로드와 작업 목록 조회는 Instagram API를 호출하지 않는다. 토큰 갱신이나 신규 OAuth 권한 요청은 구현하지 않는다.

Meta 공식 참고: [Content Publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing), [IG User Media](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media). 이미지 제한에 관한 공식 검색 결과는 확인했으나 문서 본문은 도구 접근 오류로 전체 열람하지 못했다. 실제 파일 게시 시험 전 기존 앱의 현행 권한과 동작을 추가 확인해야 한다.

## 기존 설정과 실제 연결의 구분

서버는 기존 `META_GRAPH_VERSION`, `IG_USER_ID`, `IG_ACCESS_TOKEN`을 사용한다. 사진 전달에는 기존 `PUBLIC_ORIGIN`, `MEDIA_SIGNING_KEY`, 영구 사진 저장 공간 설정이 필요하다. 전송에는 `SNS_PUBLISH_ENABLED=true`와 `IG_PUBLISH_ENABLED=true`도 필요하다. 이 수정안은 운영 환경변수를 변경하지 않는다. Facebook과 X의 현재 활성화 설정도 유지한다.

로그인한 관리자에게 인증·사진 전달·전송 설정의 존재 여부만 보여 준다. 인증정보 값은 클라이언트에 전달하지 않는다. 계정 확인은 `fields=id,user_id,username`을 요청하고, 두 ID가 숫자 문자열인지 검증한 뒤 프로페셔널 계정 ID인 `user_id`가 기존 `IG_USER_ID`와 일치하고 계정명이 `spymedia_kr`인지 확인한다. 앱 범위 `id`로 대신 통과시키지 않는다. 성공 반환값과 미디어 등록·게시 대상은 검증된 `user_id`로 통일한다. 계정 확인 성공은 기존 토큰으로 이 계정을 조회했다는 뜻이다. `publishingPermissionsVerified`는 항상 false이며 게시 권한·앱 심사·운영 토큰 갱신 완료를 의미하지 않는다.

Instagram Login 앱 ID는 **1030189823411067**이다. 사용자가 확인한 기존 권한은 `instagram_business_basic`, `instagram_business_content_publish`이다. Business Suite의 게시 대상 확인은 이 앱의 API 인증을 검증하지 않는다.

## 전송과 복구

1. 로그인 후 **계정 확인**으로 `spymedia_kr`를 확인한다. 서버 전체에 걸쳐 1분 제한을 적용한다. 확인 실패나 다른 계정은 전송을 차단한다.
2. 사진과 문구를 입력하고 **사진·문구 준비**를 누른다. 사진 저장과 작업 준비는 SNS 게시 요청을 보내지 않는다. 같은 사진 바이트와 같은 문구는 기존 작업을 재사용한다.
3. 준비 목록의 사진·문구를 확인하고 **선택한 사진 전송**을 누른다. 최종 확인 창은 저장된 파일명·크기·계정·문구를 표시한다. 입력란의 저장하지 않은 수정은 이전 작업을 변경하지 않는다.
4. 서버는 계정을 다시 확인하고 컨테이너 생성 → 처리 확인 → 게시 시도 기록 저장 → 게시 → 결과 ID 확인 순서로 진행한다. 사진 전달은 기존 서명 URL을 사용한다.
5. 게시 전 실패는 **다시 준비**할 수 있지만 이 동작은 전송하지 않는다. 게시 시도 후 오류·응답 불확실·재시작은 `확인 필요`로 보존하며 재전송을 차단한다. 먼저 Instagram에서 게시 여부를 확인한다. 성공·불확실 작업의 중복 키는 재시작과 휴지통 복원 후에도 유지된다.

## 로컬 검증과 다음 단계

`node --test admin-ui/tests/*.test.mjs`와 `node admin-ui/scripts/check.mjs`로 검증한다. 화면 시험은 `node admin-ui/scripts/instagram-browser-test.mjs`를 사용한다. Playwright 모듈 경로는 `PLAYWRIGHT_MODULE`, 별도 브라우저 실행 파일은 `CHROMIUM_EXECUTABLE`로 지정할 수 있다. 화면 시험은 새로운 임시 브라우저 세션·합성 JPEG·모의 API만 사용하며 사용자 로그인 세션을 사용하지 않는다.

실제 인증 유효성·게시 권한·운영 설정은 이 로컬 시험으로 확인할 수 없다. 이후 승인된 배포와 연결 확인 단계에서 다음을 확인한다.

- 기존 앱의 위 두 권한과 연결 계정 `spymedia_kr`가 여전히 유효한지 확인한다. 토큰 값은 채팅·코드·Git·로그에 요청하거나 출력하지 않는다.
- 기존 보안 설정 화면에서 필요한 설정의 존재 여부를 확인한다. 만료 또는 권한 부족이면 기존 앱의 안전한 재연결 경로를 사용자에게 안내하고 승인 후 진행한다. 현재 작업에서 새 토큰 생성·입력·권한 확대는 수행하지 않는다.
- 승인된 JPEG 파일과 최종 문구, 게시 대상에 대해 사용자의 명시적 게시 승인을 받은 뒤 1건만 시험한다.

현재 수정안은 로컬 검토용이다. push·운영 배포·실제 SNS 게시를 실행하지 않았다.
