# 🎬 SpyMedia YouTube 자동화 플랫폼

YouTube 채널의 영상을 해시태그 기반으로 자동 분류하여 홈페이지에 동적으로 표시하는 자동화 시스템입니다.

---

## 📋 기능

✅ **YouTube API 연동**
- 스파이미디어 채널의 모든 영상 자동 수집
- 영상 제목, 설명, 썸네일, 조회수 등 정보 추출

✅ **해시태그 기반 자동 분류**
- #부동산 → 부동산 카테고리
- #FPV → FPV 드론 촬영
- #VR → VR 파노라마
- #3D매핑 → 3D 매핑
- #보안 → 보안 수색
- #관광 → 관광지 홍보
- #기업 → 기업 홍보

✅ **REST API 제공**
- GET `/api/videos` - 모든 영상
- GET `/api/videos?tag=fpv` - 카테고리별 영상
- GET `/api/categories` - 카테고리 목록
- GET `/api/refresh` - 수동 새로고침

✅ **테스트 대시보드**
- 로컬 테스트용 웹 UI
- 실시간 영상 검색 및 필터링

---

## 🚀 빠른 시작

### **1단계: 필수 요구사항**

```
- Node.js 18.x 이상
- npm 또는 yarn
- YouTube API 키
```

### **2단계: 설치**

```bash
# 저장소 클론
git clone https://github.com/spymediavr-create/spymedia.git
cd spymedia

# 의존성 설치
npm install
```

### **3단계: 환경 설정**

```bash
# .env 파일 생성
cp .env.example .env
```

`.env` 파일 수정:
```
YOUTUBE_API_KEY=YOUR_API_KEY_HERE
PORT=3000
```

### **4단계: 서버 실행**

```bash
# 개발 모드
npm run dev

# 또는 프로덕션 모드
npm start
```

서버가 시작됩니다:
```
🚀 SpyMedia YouTube Automation 서버 실행 중
📍 http://localhost:3000
📌 API: http://localhost:3000/api/videos
```

### **5단계: 테스트**

브라우저에서 접속:
```
http://localhost:3000
```

---

## 📡 API 엔드포인트

### **모든 영상 조회**
```bash
GET /api/videos
GET /api/videos?tag=all
```

응답:
```json
{
  "success": true,
  "count": 25,
  "tag": "all",
  "videos": [
    {
      "videoId": "XXXXXXXXX",
      "title": "영상 제목",
      "thumbnail": "https://...",
      "publishedAt": "2026-05-12T...",
      "hashtags": ["#부동산", "#FPV"],
      "categories": ["real", "fpv"],
      "viewCount": "1000",
      "likeCount": "50"
    }
  ]
}
```

### **카테고리별 영상 조회**
```bash
GET /api/videos?tag=fpv
GET /api/videos?tag=real
GET /api/videos?tag=tour
GET /api/videos?tag=security
GET /api/videos?tag=map
GET /api/videos?tag=etc
```

### **카테고리 목록**
```bash
GET /api/categories
```

응답:
```json
{
  "success": true,
  "categories": [
    { "id": "all", "name": "ALL", "label": "전체" },
    { "id": "fpv", "name": "FPV·씨네후프", "label": "FPV 드론 촬영" },
    { "id": "real", "name": "부동산", "label": "부동산 항공 촬영" },
    ...
  ]
}
```

### **새로고침**
```bash
GET /api/refresh
```

---

## 🏗️ 프로젝트 구조

```
spymedia-youtube-automation/
├── server.js              # 메인 서버 파일
├── package.json           # 의존성 정의
├── .env                   # 환경 변수 (Git에 커밋 X)
├── .env.example           # 환경 변수 예제
├── .gitignore             # Git 무시 파일
├── public/
│   └── index.html         # 테스트 대시보드
└── README.md              # 이 파일
```

---

## 🔧 설정

### **YouTube API 키 발급**

1. [Google Cloud Console](https://console.cloud.google.com) 접속
2. 새 프로젝트 생성: "SpyMedia Automation"
3. "YouTube Data API v3" 활성화
4. 자격증명 → API 키 생성
5. 생성된 키를 `.env` 파일에 복사

### **환경 변수**

```env
# YouTube API
YOUTUBE_API_KEY=AIzaSyD...

# Google OAuth (향후 사용)
GOOGLE_CLIENT_ID=968473193675...
GOOGLE_CLIENT_SECRET=GOCSPX-...

# 서버
PORT=3000
NODE_ENV=development

# 채널
YOUTUBE_CHANNEL_ID=UCw7OnhgTIih0M5PoMkwCDug
```

---

## 📤 Render에 배포

### **1단계: GitHub에 Push**

```bash
git add .
git commit -m "Initial commit: YouTube automation"
git push origin main
```

### **2단계: Render 접속**

1. [Render.com](https://render.com) 접속
2. GitHub로 로그인
3. "Create New" → "Web Service"
4. 저장소 선택: `spymedia`

### **3단계: 환경 변수 설정**

Render 대시보드에서:

```
Key: YOUTUBE_API_KEY
Value: YOUR_API_KEY
```

### **4단계: 배포**

```
- Build Command: npm install
- Start Command: npm start
```

배포 완료! 
```
https://spymedia.onrender.com
```

---

## 🔌 홈페이지 연동

기존 HTML에서 API 호출:

```javascript
// 모든 영상 로드
fetch('https://spymedia.onrender.com/api/videos')
  .then(res => res.json())
  .then(data => {
    // 영상 카드 동적 생성
    data.videos.forEach(video => {
      const card = document.createElement('div');
      card.className = 'vcard';
      card.onclick = () => openV(video.videoId);
      card.innerHTML = `
        <img src="${video.thumbnail}" alt="${video.title}">
        <div class="vcard-info">
          <div class="vcard-cat">${video.categories[0]}</div>
          <div class="vcard-title">${video.title}</div>
        </div>
      `;
      document.getElementById('portfolio').appendChild(card);
    });
  });

// 카테고리별 필터링
function filterByTag(tag) {
  fetch(`https://spymedia.onrender.com/api/videos?tag=${tag}`)
    .then(res => res.json())
    .then(data => {
      // 화면 업데이트
    });
}
```

---

## 🐛 문제 해결

### **"API 키가 유효하지 않습니다"**
- Google Cloud Console에서 API 키 확인
- YouTube Data API v3 활성화 확인
- `.env` 파일에 올바르게 입력 확인

### **"Channel not found"**
- 채널 ID 확인: `UCw7OnhgTIih0M5PoMkwCDug`
- YouTube 채널 공개 설정 확인

### **"CORS 오류"**
- 서버와 클라이언트 도메인 확인
- CORS 설정 확인

---

## 📞 지원

문제가 발생하면:
1. [Issues](https://github.com/spymediavr-create/spymedia/issues) 작성
2. 에러 메시지 첨부
3. `.env` 파일 설정 확인

---

## 📝 라이선스

MIT License - SpyMedia

---

## 🎬 업데이트 기록

### v1.0.0 (2026-05-12)
- ✅ YouTube API 기본 연동
- ✅ 해시태그 자동 분류
- ✅ REST API 제공
- ✅ 테스트 대시보드

---

**만든이**: SpyMedia  
**채널**: [@spymedia3645](https://www.youtube.com/@spymedia3645)
