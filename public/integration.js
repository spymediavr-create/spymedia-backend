// API 주소를 정확히 설정하세요
const YOUTUBE_API_URL = 'https://spymedia-backend.onrender.com/api'; 

/**
 * 유튜브 영상 로드 함수
 */
async function loadPortfolioVideos() {
  try {
    console.log("📡 데이터 불러오기 및 최신순 정렬 시작...");
    const response = await fetch(`${YOUTUBE_API_URL}/videos`);
    
    if (!response.ok) throw new Error("네트워크 응답 에러");
    
    const data = await response.json();
    let videos = data.videos || []; 

    // --- 최신 날짜순 정렬 로직 추가 ---
    videos.sort((a, b) => {
      // publishedAt 값을 비교하여 최신 날짜가 앞으로 오게 정렬
      return new Date(b.publishedAt) - new Date(a.publishedAt);
    });
    // --------------------------------

    const container = document.querySelector('.vgrid');
    
    if (container && videos.length > 0) {
      // 기존 유튜브 카드만 삭제
      container.querySelectorAll('.vcard[data-source="youtube"]').forEach(c => c.remove());
      
      videos.forEach(v => {
        // 정렬된 순서대로 카드 생성 및 추가
        container.appendChild(createVideoCard(v));
      });
      console.log(`✅ ${videos.length}개의 영상이 최신순으로 정렬되었습니다.`);
    }
  } catch (e) {
    console.error("❌ 데이터 로드 실패:", e);
  }
}
/**
 * 영상 카드 생성 (해시태그 기반 분류)
 */
function createVideoCard(v) {
  const card = document.createElement('div');
  card.className = 'vcard';
  card.setAttribute('data-source', 'youtube');
  
  // 데이터 키값이 videoid 인지 확인 (스크린샷 기준)
  const vId = v.videoid || v.videoId;
  const title = v.title || "";
  
  // 해시태그별 카테고리 분류
  let tag = 'etc';
  if (title.includes('#부동산')) tag = 'real';
  else if (title.includes('#FPV') || title.includes('#씨네후프')) tag = 'fpv';
  else if (title.includes('#관광지')) tag = 'tour';
  else if (title.includes('#보안')) tag = 'security';
  else if (title.includes('#매핑') || title.includes('#VR')) tag = 'map';

  card.setAttribute('data-tag', tag);
  card.onclick = () => typeof openV === 'function' ? openV(vId) : console.log("Video ID:", vId);

  card.innerHTML = `
    <img src="${v.thumbnail}" alt="${title}" loading="lazy">
    <div class="vcard-hud"></div>
    <div class="vcard-br"></div>
    <div class="vcard-play"><div class="vcard-play-ic">▶</div></div>
    <div class="vcard-info">
      <div class="vcard-cat">${tag.toUpperCase()}</div>
      <div class="vcard-title">${title.split('#')[0].substring(0, 40)}</div>
    </div>
  `;
  return card;
}

// 페이지 로드 시 실행
window.addEventListener('load', loadPortfolioVideos);