/**
 * SpyMedia YouTube API 연동 스크립트
 * 홈페이지의 포트폴리오 섹션에서 사용
 * 
 * 사용 방법:
 * 1. 이 파일을 HTML에 포함
 * 2. API_URL을 Render 배포 URL로 변경
 * 3. loadPortfolioVideos() 호출
 */

// API 설정
const YOUTUBE_API_URL = 'https://spymedia-backend.onrender.com/api'; // Render 배포 URL로 변경
// 로컬 테스트: const YOUTUBE_API_URL = 'http://localhost:3000/api';

// 카테고리 매핑
const CATEGORY_MAP = {
  'all': 'ALL',
  'fpv': 'FPV · 씨네후프',
  'real': '부동산',
  'tour': '관광지 홍보',
  'security': '보안 수색',
  'map': '3D매핑 · VR',
  'etc': '기업 홍보'
};

/**
 * YouTube API에서 영상 로드
 */
async function loadPortfolioVideos() {
  try {
    console.log('📺 포트폴리오 영상 로드 중...');

    // API에서 모든 영상 가져오기
    const response = await fetch(`${YOUTUBE_API_URL}/videos?tag=all`);
    
    if (!response.ok) {
      throw new Error(`API 오류: ${response.status}`);
    }

    const data = await response.json();

    if (data.success && data.videos && data.videos.length > 0) {
      console.log(`✅ ${data.count}개의 영상 로드 완료`);
      
      // 포트폴리오 섹션에 카드 추가
      displayPortfolioCards(data.videos);
      
      // 필터 버튼 생성
      createFilterButtons();
      
      return data.videos;
    } else {
      console.warn('⚠️ 영상을 찾을 수 없습니다');
      return [];
    }
  } catch (error) {
    console.error('❌ 포트폴리오 영상 로드 오류:', error);
    return [];
  }
}

/**
 * 포트폴리오 카드 표시
 */
function displayPortfolioCards(videos) {
  const portfolio = document.getElementById('portfolio') || 
                   document.querySelector('.vgrid') ||
                   document.querySelector('.portfolio-grid');

  if (!portfolio) {
    console.error('❌ 포트폴리오 그리드를 찾을 수 없습니다');
    return;
  }

  // 기존 카드 유지하고 새 카드 추가
  const existingCards = portfolio.querySelectorAll('.vcard[data-source="youtube"]');
  existingCards.forEach(card => card.remove());

  // YouTube 영상으로 만든 카드 추가
  videos.forEach(video => {
    const card = createVideoCard(video);
    portfolio.appendChild(card);
  });

  console.log(`📍 ${videos.length}개의 카드 추가됨`);
}

/**
 * 영상 카드 생성 (해시태그 파싱 로직 추가)
 */
function createVideoCard(video) {
  const card = document.createElement('div');
  card.className = 'vcard'; // HTML 스타일과 일치
  card.setAttribute('data-source', 'youtube');
  
  // --- 해시태그 파싱 로직 추가 ---
  let assignedTag = 'etc'; // 기본값 (기업홍보)
  const title = video.title;

  if (title.includes('#부동산')) assignedTag = 'real';
  else if (title.includes('#FPV') || title.includes('#씨네후프')) assignedTag = 'fpv';
  else if (title.includes('#관광지')) assignedTag = 'tour';
  else if (title.includes('#보안')) assignedTag = 'security';
  else if (title.includes('#매핑') || title.includes('#VR')) assignedTag = 'map';

  // HTML의 fTab 함수와 호환되도록 data-tag 속성 설정
  card.setAttribute('data-tag', assignedTag);
  // ------------------------------

  card.onclick = () => openV(video.videoId);

  const categoryLabel = CATEGORY_MAP[assignedTag] || 'AERIAL VIDEO';

  card.innerHTML = `
    <img src="${video.thumbnail}" alt="${title}" loading="lazy">
    <div class="vcard-hud"></div>
    <div class="vcard-br"></div>
    <div class="vcard-play"><div class="vcard-play-ic">▶</div></div>
    <div class="vcard-coord">N 37.37° E 126.80°</div>
    <div class="vcard-info">
      <div class="vcard-cat">${categoryLabel}</div>
      <div class="vcard-title">${truncateTitle(title.split('#')[0], 50)}</div>
    </div>
  `;

  return card;
}
/**
 * 제목 길이 제한
 */
function truncateTitle(title, maxLength) {
  if (title.length > maxLength) {
    return title.substring(0, maxLength) + '...';
  }
  return title;
}

/**
 * 필터 버튼 생성
 */
async function createFilterButtons() {
  try {
    // 카테고리 목록 가져오기
    const response = await fetch(`${YOUTUBE_API_URL}/categories`);
    const data = await response.json();

    if (data.success && data.categories) {
      const tabsContainer = document.querySelector('.cat-tabs');
      
      if (tabsContainer) {
        // 기존 필터 버튼 다시 만들기
        // (영상 로드 후에도 필터가 정상 작동하도록)
        console.log('✅ 필터 버튼 준비 완료');
      }
    }
  } catch (error) {
    console.error('필터 로드 오류:', error);
  }
}

/**
 * 카테고리별 필터링 (기존 fTab 함수 오버라이드)
 */
const originalFTab = window.fTab || null;

window.fTab = function(btn, category) {
  // 기존 필터 로직 실행
  if (originalFTab) {
    originalFTab(btn, category);
  }

  // YouTube 영상 필터링
  filterVideosByCategory(category);
};

/**
 * 카테고리별로 영상 필터링
 */
function filterVideosByCategory(category) {
  const cards = document.querySelectorAll('.vcard[data-source="youtube"]');
  
  if (category === 'all') {
    // 모든 카드 표시
    cards.forEach(card => {
      card.style.display = '';
      card.classList.remove('hidden');
    });
  } else {
    // 해당 카테고리의 카드만 표시
    cards.forEach(card => {
      const categories = card.getAttribute('data-categories').split(',');
      
      if (categories.includes(category)) {
        card.style.display = '';
        card.classList.remove('hidden');
      } else {
        card.style.display = 'none';
        card.classList.add('hidden');
      }
    });
  }

  console.log(`🔍 필터: ${category}`);
}

/**
 * 자동 새로고침 (선택사항)
 * 매 1시간마다 YouTube 영상 업데이트
 */
function enableAutoRefresh(intervalMinutes = 60) {
  setInterval(async () => {
    console.log('🔄 YouTube 영상 자동 새로고침...');
    
    try {
      const response = await fetch(`${YOUTUBE_API_URL}/refresh`);
      const data = await response.json();
      
      if (data.success) {
        console.log(`✅ ${data.count}개 영상 새로고침 완료`);
        // 영상 다시 로드
        await loadPortfolioVideos();
      }
    } catch (error) {
      console.error('새로고침 오류:', error);
    }
  }, intervalMinutes * 60 * 1000);

  console.log(`⏰ ${intervalMinutes}분 간격으로 자동 새로고침 활성화`);
}

/**
 * 페이지 로드 시 자동 실행
 */
document.addEventListener('DOMContentLoaded', () => {
  console.log('🚀 SpyMedia YouTube 자동화 스크립트 로드');
  
  // 포트폴리오 영상 로드
  loadPortfolioVideos();
  
  // 자동 새로고침 활성화 (선택사항)
  // enableAutoRefresh(60); // 1시간마다
});

// 전역 함수로 내보내기
window.loadPortfolioVideos = loadPortfolioVideos;
window.filterVideosByCategory = filterVideosByCategory;
window.enableAutoRefresh = enableAutoRefresh;

console.log('📡 YouTube 자동화 API 준비 완료');
console.log('📌 API URL:', YOUTUBE_API_URL);
