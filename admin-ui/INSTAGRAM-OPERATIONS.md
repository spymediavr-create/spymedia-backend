# Instagram Meta Business Suite 준비와 기존 전송 기능

## 메인 관리자 기본 흐름: Meta Business Suite

`/admin`의 기본 Instagram 영역은 공통 제목·설명·해시태그를 조합한 문구 미리보기, 문구 복사, **Meta Business Suite 열기**를 제공한다. 이 흐름에서는 관리자 서버로 영상 파일을 올리거나 검사·변환하지 않는다. 문구를 복사한 후 Meta 새 창에서 게시 대상 `spymedia_kr`와 릴스를 선택하고, 컴퓨터의 원본 영상 선택·문구 붙여넣기·최종 게시 또는 예약을 직접 진행한다. Meta가 파일을 수락하는지와 게시 결과는 Meta 화면에서 확인한다.

연결 주소는 기존 Facebook Page `1387247911137772`를 사용하는 `https://business.facebook.com/latest/home?asset_id=1387247911137772`이다. 링크에는 파일·문구·토큰을 넣지 않는다. 작성 폼을 iframe으로 복제하지 않으며 파일 자동 전달, Meta 입력란 자동 채우기, 브라우저 매크로, 게시 결과 자동 동기화를 구현하지 않는다. 복사 권한이 거절되면 읽기 전용 문구란을 선택해 수동으로 복사한다. 신규 인증 권한이나 유료 서비스가 필요하지 않다.

이전 관리자 릴스 전송 기능과 저장된 결과는 기본 화면 아래의 닫힌 **기존 관리자 전송·작업 이력**에서 계속 접근할 수 있다. 별도 Instagram 사진 도우미와 Facebook·X의 YouTube 링크 소개 기능은 유지한다.

## 기존 관리자 릴스 전송

`/admin`의 접힌 기존 전송 영역에서 MP4/MOV 파일을 선택하고 로컬 미리보기 → 영상 검사·저장 → 릴스 작업 준비 → 연결 확인 → 저장된 작업 선택·최종 확인 → 전송·결과 확인 순서로 사용한다. 위 공통 제목·설명·해시태그를 사용하며 YouTube 주소는 필요하지 않다. 전송은 저장된 작업의 원본과 문구를 사용한다. 입력을 나중에 수정해도 기존 작업의 문구는 바뀌지 않는다.

`POST /api/admin/reels`는 기존 관리자 인증·Origin·CSRF 검사 후 raw 파일을 스트리밍 저장한다. 용량 상한은 **앱 기준 300,000,000바이트**이다. 파일 전체를 메모리에 올리지 않고 SHA-256과 ISO BMFF 구조를 검사한 다음 FFprobe 메타데이터만 읽는다. FFmpeg·디코딩 프레임 출력·리사이즈·재인코딩은 실행하지 않는다. 실패 또는 취소 시 임시 파일을 제거한다. 사진과 릴스 업로드는 하나의 잠금으로 디스크 용량을 보호한다.

앱의 통과 기준:

- MP4/MOV, 영상 트랙 1개, H.264/HEVC, 4:2:0 8bit, 인터레이스 아님, 회전 메타데이터 없음.
- 3~900초, 23~60fps, 가로 최대 1920px. 세로 9:16은 권장사항이며 다른 비율은 경고 후 원본 비율을 유지한다.
- 영상 최대 25Mbps. 오디오가 있으면 AAC, 최대 48kHz, 모노/스테레오, 최대 128kbps. 무음 영상도 허용한다.
- moov가 mdat 앞에 있는 Fast Start 파일이며 edit list가 없어야 한다. 규격이 맞지 않으면 원본을 자동 수정하지 않고 편집 프로그램의 다시 내보내기 항목을 안내한다.

FFprobe는 기존 `FFPROBE_PATH` 또는 `ffprobe`를 사용한다. 도구가 없으면 검사를 통과시키지 않는다. [Render native runtime](https://render.com/docs/native-runtimes)은 FFmpeg 도구를 기본 제공하지만 기존 서비스에서 실제 검사를 확인해야 한다. 새 서비스·디스크·인증 권한을 만들지 않는다.

업로드 100%의 **파일 전송 완료 · 검사 결과 대기**는 브라우저의 전송 완료를 뜻하며, 서버 저장 성공이나 Instagram 게시 완료를 뜻하지 않는다. 서버 응답이 60초 이상 없으면 영상 아래에 지연 안내를 표시하고 자동 취소·재전송하지 않는다. 오류나 취소가 확정되면 진행 표시를 지우고 같은 위치에 이유를 표시한다. FFprobe의 30초 제한 초과는 `reel_probe_timeout`(503)으로 구분한다.

업로드 실패 로그 `sns_reel_upload_failed`는 허용된 오류 코드와 HTTP 상태만 기록한다. 파일명·영상 내용·문구·요청 본문·인증정보는 기록하지 않는다. 취소나 네트워크 단절 이후 서버에 저장됐는지는 보관 콘텐츠에서 확인한다.

기존 Instagram Login의 검증된 `user_id`에 `media_type=REELS`, 원본 서명 HTTPS `video_url`을 전달한다. 컨테이너 상태를 최대 6회, 60초 간격으로 확인하고 준비 완료 후에만 게시 시도 체크포인트를 기록한다. 게시 응답 ID의 `media_product_type=REELS`와 결과 ID를 확인한다. 사진과 같은 중복 키·재시작 보호를 적용한다. 준비·검사·목록 조회는 공개 게시를 하지 않으며, 게시 결과가 불확실하면 자동 재전송하지 않는다.

형식 참고: [Meta 공식 Reels 샘플](https://github.com/fbsamples/reels_publishing_apis/blob/main/insta_reels_publishing_api_sample/README.md), [Meta 공식 Postman](https://www.postman.com/meta/instagram/folder/f95kq5e/reels-publishing). 공식 자료의 파일 최대 용량 표기가 서로 달라 300MB를 보수적인 앱 제한으로 사용한다. Meta의 최종 게시 수락을 로컬 검사만으로 보장하지 않는다.

## 기존 사진 기능

관리자 `/admin/instagram`에서 기존 제목·설명·해시태그를 사용해 JPEG 사진 1장을 저장하고, 준비 목록에서 사진과 저장된 문구를 확인한 뒤 명시적으로 전송한다. 기존 Instagram 메인 카드·미리보기 탭과 Business Suite 준비 도우미를 유지한다. 이 사진 기능의 형식과 전송 방식은 유지한다.

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

릴스 회귀 시험은 `node admin-ui/scripts/instagram-reels-browser-test.mjs`로 실행한다. 실제 합성 MP4 재생과 FFprobe 검사·원본 다운로드를 시험하려면 `REAL_REEL_FILE`, `FFPROBE_PATH`를 지정해 `node admin-ui/scripts/reels-media-test.mjs`를 실행한다. 브라우저 변수는 위 사진 시험과 같다. 이 테스트는 임시 저장소와 합성 로그인만 사용하며 SNS 전송 스위치를 끄고 외부 요청을 차단한다. 테스트용 영상 생성은 개발 환경에서만 하며 운영 업로드 경로에는 인코더가 없다.

운영 배포와 실제 공개 게시는 별개다. 운영 코드 반영 후에도 실제 Instagram 공개 시험에는 사용할 원본·문구·계정에 대한 사용자 확인이 필요하다. 새 유료 서비스나 인증 권한 변경도 먼저 확인한다.
