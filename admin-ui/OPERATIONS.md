# 운영 연결과 승인 범위

대상은 기존 [Render spymedia-backend](https://dashboard.render.com/web/srv-d81bo0rtqb8s738pcv6g), 저장소 `spymediavr-create/spymedia-backend`, `main`, https://spymedia-backend.onrender.com 입니다. 원래 작업에서 확인한 화면은 Node Starter / Auto-Deploy입니다. 코드의 `render.yaml`에 있는 free 선언을 실제 요금이라고 해석하거나 덮어쓰지 마세요.

## 먼저 읽기 확인할 설정

1. **Disks**: 기존 디스크 유무, 마운트 경로, 현재 용량과 여유 공간. 새 디스크는 만들지 않습니다. 없으면 기존 외부 객체 저장소와 DB의 유무만 확인합니다.
2. **Environment**: 변수 이름과 설정 여부만 확인합니다. 비밀 값을 펼치거나 공유하지 않습니다. 기존 `YOUTUBE_API_KEY`와 기존 자동 실행 설정을 보존합니다.
3. **Settings**: 저장소·main·실행 명령 `npm start`, Build Command, 인스턴스 수, Node 런타임. 영구 디스크 방식은 단일 인스턴스를 전제로 합니다. 기존 서비스 설정을 임의 변경하지 않습니다.
4. **Events**: 배포 커밋과 성공 여부. 공개 `/api/admin/status`의 `commit`은 Render가 제공하는 `RENDER_GIT_COMMIT`이며 라이브 코드 확인용입니다.
5. **Shell 또는 운영 도구**: `ffmpeg -version`, `ffprobe -version`이 성공하는지 확인합니다. 부재 시 설치 방법과 실행 환경 변경을 별도로 검토합니다. 현재 코드는 부재 시 업로드를 차단합니다.

선택지는 기존 영구 디스크 재사용, 기존 객체 저장소/DB 어댑터 연결, 또는 비활성 배포 상태 유지입니다. 새 유료 저장소와 요금 변경은 별도 승인 없이 하지 않습니다.

## 관리자 인증

새 영구 접근 설정 전에 승인할 action은 **선택한 관리자 ID 한 개에 대한 로그인 자격증명 등록**, target은 **이 Render 서비스의 관리자 `/admin`**, 접근 범위는 **콘텐츠 업로드·미리보기·선택한 스파이미디어 채널 전송과 작업 조회**입니다. Render 계정 이메일을 관리자 ID로 자동 채택하지 않습니다.

승인 후 비밀번호는 사용자 로컬의 숨김 입력 또는 안전한 비밀 관리 입력에서 받고 scrypt 해시만 Render Environment의 `ADMIN_PASSWORD_SCRYPT`에 저장합니다. 형식은 `<16바이트 이상 salt hex>:<64바이트 scrypt 결과 hex>`입니다. 현재 코드의 scrypt 매개변수는 Node 기본 N=16384, r=8, p=1입니다. 실사용 비밀번호/해시는 채팅에 붙여 넣지 마세요. 운영 비밀은 Render Environment에서만 등록하며 `.env.example`에는 값이 없습니다.

필수 변수: `APP_MODE=authenticated`, `ADMIN_LOGIN_ID`, `ADMIN_PASSWORD_SCRYPT`, `PUBLIC_ORIGIN=https://spymedia-backend.onrender.com`. 운영 환경은 HTTPS Secure 쿠키를 강제합니다. 메모리 세션과 로그인 제한은 단일 인스턴스에만 적용되고 재시작 시 종료됩니다. 관리자 인증 비활성으로 돌아가려면 `APP_MODE=disabled`로 두고 배포 상태를 확인하세요.

## 원본·작업 보관

이미 존재하는 영구 마운트가 확인된 경우에만 `SNS_DATA_DIR`을 해당 마운트 안의 전용 절대 경로로 지정합니다. 저장소 체크아웃/public 밖이어야 합니다. `SNS_STORAGE_PERSISTENCE=confirmed`, `SNS_SINGLE_INSTANCE=confirmed`는 실제 확인 후 입력하는 운영 확인값이며 디스크를 생성하지 않습니다. `SNS_MAX_STORAGE_BYTES` 기본 상한은 2GiB이며 실제 남은 공간보다 작게 설정합니다. 상한을 초과하면 업로드를 중단합니다.

`FFMPEG_PATH`, `FFPROBE_PATH`는 기존 실행 파일의 경로입니다. 없으면 PATH의 명령을 확인합니다. 변환은 스레드 2개와 작업별 제한 시간을 사용합니다. Starter의 실제 CPU/메모리 적합성은 승인된 미디어 테스트에서 확인해야 합니다. 성공을 위해 요금제를 자동 변경하지 않습니다.

Meta가 미디어를 가져갈 때 사용할 서명 키 등록도 새로운 영구 접근 설정에 포함됩니다. action은 **변환 파일에 대한 최대 1시간 읽기 링크 서명 키 등록**, target은 **이 서비스의 `/sns-media/:id`**, scope는 **해당 변환 파일의 GET/HEAD**입니다. 승인 후 암호학적 난수 32바이트 이상의 hex를 `MEDIA_SIGNING_KEY`에 비밀로 저장합니다. 키를 채팅에 공유하지 않습니다. 원본에는 공개 링크를 만들지 않습니다.

## SNS 연결별 action / target / scopes

모든 신규 OAuth 승인·재발급·지속 토큰 저장은 실행 시점에 해당 계정과 아래 권한을 명시해 승인받습니다. 기존 토큰의 존재나 이전 테스트 준비를 전체 앱 심사 승인으로 해석하지 않습니다. 실제 토큰 입력은 로그인된 플랫폼 OAuth 화면 또는 Render의 비밀 Environment 입력으로만 진행합니다.

| 연결 action | 정확한 target | 필요한 권한 / 조건 | 서버 변수 이름 |
|---|---|---|---|
| Instagram Login 토큰 연결 또는 재발급 후 안전한 저장 | `spymedia_kr`, IG 앱 `1030189823411067` | `instagram_business_basic`, `instagram_business_content_publish`; Creator 확인, 앱 운영/심사·토큰 만료 확인 | `IG_USER_ID`, `IG_ACCESS_TOKEN`, `IG_PUBLISH_ENABLED=true` |
| Facebook Page 전용 토큰 연결 또는 재발급 후 안전한 저장 | 스파이미디어 Page `1387247911137772`, Meta 앱 `1577001733647513` | `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`; CREATE_CONTENT 접근과 앱 상태 확인; 필요성을 확인하지 않은 `business_management` 추가 금지 | `FB_PAGE_ID=1387247911137772`, `FB_PAGE_ACCESS_TOKEN`, `FB_PUBLISH_ENABLED=true` |
| X 기존 연결 재사용 | `spymedia_kor` | 사용자가 기존 API 연결·테스트 완료를 확인함. API 값이나 새 설정을 재요청하지 않음. 현재 앱에서 기존 구성을 사용할 수 있는지만 확인 | 이 checkout에는 기존 X 설정이 없으며 Render의 기존 설정 접근은 미확인. 기존 운영 구성을 보존 |
| YouTube 업로드 OAuth와 갱신 토큰 연결 | `@spymedia3645`, 채널 `UCw7OnhgTIih0M5PoMkwCDug` | `https://www.googleapis.com/auth/youtube.upload` 및 게시 대상 본인 채널 검증을 위한 `https://www.googleapis.com/auth/youtube.readonly`; 기존 조회 API 키는 업로드 권한이 아님 | `YOUTUBE_OAUTH_CLIENT_ID`, `YOUTUBE_OAUTH_CLIENT_SECRET`, `YOUTUBE_OAUTH_REFRESH_TOKEN`, `YOUTUBE_PUBLISH_ENABLED=true` |

Meta 두 어댑터의 `META_GRAPH_VERSION`은 해당 앱에서 확인한 지원 버전(형식 `v숫자.숫자`)으로 지정합니다. 기본 버전을 추측하지 않습니다. Instagram Login은 `graph.instagram.com`, Facebook Page는 `graph.facebook.com` / `graph-video.facebook.com`을 사용합니다. 노출됐던 과거 Meta 토큰 폐기 확인은 여전히 필요하며 새 토큰 값은 모델에 전달하지 않습니다.

`SNS_PUBLISH_ENABLED=true`는 계정·권한·비용과 승인된 테스트 콘텐츠가 준비된 뒤 운영자가 활성화하는 전체 전송 스위치입니다. 현재 기본값은 false입니다. 채널별 개별 스위치와 토큰 설정이 모두 필요합니다. 미설정 채널은 전송할 수 없습니다. 인스타그램/페이스북/X의 만료·권한 오류는 작업을 멈추고 재연결을 요구합니다. 자동 OAuth 신규 권한 생성이나 무단 재발급은 없습니다. YouTube만 승인된 기존 갱신 토큰으로 서버에서 액세스 토큰을 갱신합니다.

X는 연결과 테스트를 다시 요구하는 작업이 아닙니다. 사용자 확인으로 기존 연결·테스트 완료 상태를 기록했습니다. 이 PC의 현재 프로세스와 checkout에서는 기존 X 설정의 존재가 확인되지 않았고, Render 환경설정은 읽을 권한/도구가 없어 확인하지 못했습니다. 이는 기존 연결이 없다는 뜻이 아닙니다. X 기능과 어댑터는 유지하며 기존 설정에 안전하게 접근할 수 있을 때 재사용합니다. 추가 지속 자격증명 등록이 필요하면 자동으로 진행하지 않습니다.

## 마지막 검증과 한계

설정 등록과 실제 게시 승인은 별개입니다. 승인된 파일·제목·설명·태그·정확한 채널·YouTube 공개 범위/아동용 여부를 먼저 확인합니다. 실제 콘텐츠로 파일 변환과 미리보기를 확인한 후 선택 작업 전송을 실행합니다. YouTube 미검증 API 프로젝트는 공개 요청이 비공개로 제한될 수 있어 응답의 실제 공개 상태를 표시합니다.

외부 POST 타임아웃이나 처리 중 재시작 시 자동 재시도를 하지 않습니다. `unknown` 작업은 실제 채널 결과를 확인한 후 수동으로 조정해야 합니다. 이 버전은 수동 조정 API를 제공하지 않으므로 저널을 임의 수정하지 말고 후속 복구 구현을 요청하세요. 게시 시도 전 실패만 **실패 작업 다시 준비**를 지원합니다. 원본·작업 삭제와 백업 복구 도구는 후속 운영 작업입니다.

자료: [Render 디스크](https://render.com/docs/disks), [YouTube 업로드](https://developers.google.com/youtube/v3/docs/videos/insert), [resumable 업로드](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol), [X 글 생성](https://docs.x.com/x-api/posts/create-post), [X 미디어 초기화](https://docs.x.com/x-api/media/initialize-media-upload), [Meta 제공 Instagram 컬렉션](https://www.postman.com/meta/workspace/instagram/documentation/23987686-9386f468-7714-490f-9bfc-9442db5c8f00), [Instagram 공식 게시 문서](https://developers.facebook.com/documentation/instagram-platform/content-publishing). Meta 직접 문서 전체는 현재 읽기 오류가 있어 실행 전 앱의 최신 계약을 확인해야 합니다.
