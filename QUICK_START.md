# 🚀 빠른 시작 가이드

## 📋 체크리스트

### Step 1️⃣: YouTube API 키 준비
- [x] Google Cloud Console에서 API 키 생성: `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`
- [ ] YouTube Data API v3 활성화 확인
- [ ] API 키 복사

### Step 2️⃣: GitHub에 코드 업로드

#### Option A: 명령어로 업로드

```bash
# 1. GitHub 저장소 클론
git clone https://github.com/spymediavr-create/spymedia.git
cd spymedia

# 2. 새로운 백엔드 디렉토리 생성
mkdir backend
cd backend

# 3. 코드 파일 추가 (아래 파일들을 backend/ 폴더에 복사)
- server.js
- package.json
- .env.example
- .gitignore
- README.md
- public/index.html
- integration.js

# 4. Git에 추가
git add .
git commit -m "Add YouTube automation backend"
git push origin main
```

#### Option B: GitHub 웹사이트에서 업로드

1. https://github.com/spymediavr-create/spymedia 접속
2. "Add file" → "Create new file"
3. 각 파일 생성

---

## 🔧 로컬에서 테스트

### 1단계: 환경 설정

```bash
# backend 폴더로 이동
cd backend

# .env 파일 생성
cp .env.example .env
```

**`.env` 파일 수정:**
```
YOUTUBE_API_KEY=AIzaSyDXXXXXX...  # ← 실제 API 키 입력
PORT=3000
NODE_ENV=development
```

### 2단계: 패키지 설치

```bash
npm install
```

### 3단계: 서버 실행

```bash
npm run dev
```

**출력:**
```
🚀 SpyMedia YouTube Automation 서버 실행 중
📍 http://localhost:3000
📌 API: http://localhost:3000/api/videos
```

### 4단계: 테스트

브라우저에서 접속:
```
http://localhost:3000
```

---

## ☁️ Render에 배포

### 1단계: GitHub에 최종 푸시

```bash
git add .
git commit -m "Final version: YouTube automation ready"
git push origin main
```

### 2단계: Render 배포

1. [Render.com](https://render.com) 접속
2. **"Create New" → "Web Service"** 클릭
3. **GitHub 계정 연결** (처음이면)
4. **저장소 선택**: `spymedia` (또는 `spymedia/backend`)
5. **Settings:**
   - Name: `spymedia-youtube-automation`
   - Build Command: `cd backend && npm install`
   - Start Command: `cd backend && npm start`
   - Environment Variables:
     ```
     YOUTUBE_API_KEY=AIzaSyDXXXXXX...
     ```

### 3단계: 배포 확인

배포 완료 후:
```
https://spymedia-youtube-automation.onrender.com
```

---

## 🔌 홈페이지에 연동

### 현재 홈페이지에 추가

**HTML 파일 끝에 추가:**

```html
<!-- YouTube 자동화 스크립트 -->
<script>
  // API URL 설정 (배포 URL로 변경)
  const YOUTUBE_API_URL = 'https://spymedia-youtube-automation.onrender.com/api';
</script>
<script src="integration.js"></script>
```

또는 로컬에서:

```html
<script src="https://your-domain.com/integration.js"></script>
```

### JavaScript 수동 호출

```javascript
// 포트폴리오 영상 로드
loadPortfolioVideos();

// 자동 새로고침 활성화 (선택)
enableAutoRefresh(60); // 1시간마다
```

---

## 🧪 API 테스트

### 모든 영상 조회

```bash
curl "https://spymedia-youtube-automation.onrender.com/api/videos"
```

### 카테고리별 조회

```bash
# FPV 영상만
curl "https://spymedia-youtube-automation.onrender.com/api/videos?tag=fpv"

# 부동산 영상만
curl "https://spymedia-youtube-automation.onrender.com/api/videos?tag=real"

# VR/3D 매핑 영상만
curl "https://spymedia-youtube-automation.onrender.com/api/videos?tag=map"
```

### 카테고리 목록

```bash
curl "https://spymedia-youtube-automation.onrender.com/api/categories"
```

---

## 📊 해시태그 규칙

YouTube 영상 제목/설명에 다음 해시태그를 추가하면 자동 분류됩니다:

```
#부동산      → 부동산 카테고리
#FPV         → FPV 드론 촬영
#씨네후프    → FPV 드론 촬영
#VR          → VR 파노라마
#3D매핑      → 3D 매핑 & VR
#360도       → 3D 매핑 & VR
#보안        → 보안 수색
#관광지      → 관광지 홍보
#기업        → 기업 홍보
```

**예시:**
```
제목: "강남 아파트 드론 촬영 #부동산 #FPV"
→ 자동으로 "부동산"과 "FPV" 카테고리 모두에 표시
```

---

## 🐛 문제 해결

### "API 키가 유효하지 않습니다"

```
1. Google Cloud Console 확인
2. YouTube Data API v3 활성화 확인
3. .env 파일에 올바르게 입력 확인
```

### "서버에 연결할 수 없습니다"

```
1. Render 배포 상태 확인
2. API URL 확인 (http vs https)
3. CORS 설정 확인
```

### "영상을 찾을 수 없습니다"

```
1. YouTube 채널 공개 설정 확인
2. 영상에 해시태그 추가 확인
3. /api/refresh로 수동 새로고침
```

---

## 📞 다음 단계

### 완료 후:

1. ✅ GitHub에 코드 업로드
2. ✅ Render에 배포
3. ✅ API URL 확인
4. ✅ 홈페이지에 연동
5. ✅ YouTube에 영상 업로드 (해시태그 포함)
6. ✅ 홈페이지에서 자동으로 표시되는지 확인

---

## 💡 추가 기능 (향후)

- [ ] 영상 자동 동기화 주기 설정
- [ ] 썸네일 자동 크롭
- [ ] 조회수 기반 정렬
- [ ] 재생목록 지원
- [ ] Instagram/Facebook 자동 공유

---

**준비 완료! 시작하세요!** 🚀✨
