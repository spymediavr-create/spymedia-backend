require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// 미들웨어
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// YouTube API 설정
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const CHANNEL_ID = 'UCw7OnhgTIih0M5PoMkwCDug'; // SpyMedia 채널 ID

// 해시태그 매핑
const HASHTAG_MAP = {
  '부동산': 'real',
  '부동산촬영': 'real',
  'fpv': 'fpv',
  'fpv드론': 'fpv',
  '씨네후프': 'fpv',
  'vr': 'map',
  'vr파노라마': 'map',
  '360도': 'map',
  '3d매핑': 'map',
  '3d지도': 'map',
  '보안': 'security',
  '보안수색': 'security',
  '관광': 'tour',
  '관광지': 'tour',
  '관광홍보': 'tour',
  '기업': 'etc',
  '기업홍보': 'etc',
  '기업영상': 'etc'
};

// YouTube에서 영상 정보 가져오기
async function getYouTubeVideos() {
  try {
    const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: {
        key: YOUTUBE_API_KEY,
        channelId: CHANNEL_ID,
        part: 'snippet',
        order: 'date',
        maxResults: 50,
        type: 'video'
      }
    });

    const videoIds = response.data.items.map(item => item.id.videoId);
    
    // 각 영상의 상세 정보 가져오기
    const detailResponse = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
      params: {
        key: YOUTUBE_API_KEY,
        id: videoIds.join(','),
        part: 'snippet,contentDetails,statistics'
      }
    });

    return detailResponse.data.items;
  } catch (error) {
    console.error('YouTube API 오류:', error.message);
    return [];
  }
}

// 해시태그 추출
function extractHashtags(text) {
  if (!text) return [];
  
  const hashtagRegex = /#[^\s#]+/g;
  const hashtags = text.match(hashtagRegex) || [];
  
  return hashtags.map(tag => 
    tag.toLowerCase().replace('#', '')
  );
}

// 해시태그를 카테고리로 분류
function categorizeByHashtags(hashtags) {
  const categories = new Set();
  
  hashtags.forEach(tag => {
    const cleanTag = tag.toLowerCase();
    
    // 정확한 매칭 먼저 시도
    if (HASHTAG_MAP[cleanTag]) {
      categories.add(HASHTAG_MAP[cleanTag]);
    } else {
      // 부분 매칭
      Object.entries(HASHTAG_MAP).forEach(([key, value]) => {
        if (cleanTag.includes(key) || key.includes(cleanTag)) {
          categories.add(value);
        }
      });
    }
  });
  
  // 기본값: 모든 영상은 'all'에 포함
  if (categories.size === 0) {
    categories.add('all');
  }
  
  return Array.from(categories);
}

// 영상 데이터 가공
function processVideos(videos) {
  return videos.map(video => {
    const title = video.snippet.title;
    const description = video.snippet.description;
    const fullText = `${title} ${description}`;
    
    const hashtags = extractHashtags(fullText);
    const categories = categorizeByHashtags(hashtags);
    
    return {
      videoId: video.id,
      title: title,
      description: video.snippet.description,
      thumbnail: video.snippet.thumbnails.high?.url || video.snippet.thumbnails.default.url,
      publishedAt: video.snippet.publishedAt,
      channelTitle: video.snippet.channelTitle,
      hashtags: hashtags,
      categories: categories,
      viewCount: video.statistics?.viewCount || '0',
      likeCount: video.statistics?.likeCount || '0',
      duration: video.contentDetails?.duration || 'PT0S'
    };
  });
}

// API 엔드포인트: 모든 영상 가져오기
app.get('/api/videos', async (req, res) => {
  try {
    const tag = req.query.tag || 'all';
    
    // 캐시된 데이터 사용 (실제로는 Redis 사용 권장)
    const videos = await getYouTubeVideos();
    const processedVideos = processVideos(videos);
    
    let filteredVideos = processedVideos;
    
    if (tag !== 'all') {
      filteredVideos = processedVideos.filter(video => 
        video.categories.includes(tag)
      );
    }
    
    res.json({
      success: true,
      count: filteredVideos.length,
      tag: tag,
      videos: filteredVideos
    });
  } catch (error) {
    console.error('API 오류:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// API 엔드포인트: 카테고리 목록
app.get('/api/categories', (req, res) => {
  res.json({
    success: true,
    categories: [
      { id: 'all', name: 'ALL', label: '전체' },
      { id: 'fpv', name: 'FPV·씨네후프', label: 'FPV 드론 촬영' },
      { id: 'real', name: '부동산', label: '부동산 항공 촬영' },
      { id: 'tour', name: '관광지 홍보', label: '관광지 홍보' },
      { id: 'security', name: '보안 수색', label: '보안 수색' },
      { id: 'map', name: '3D매핑·VR', label: '3D 매핑 & VR 파노라마' },
      { id: 'etc', name: '기업 홍보', label: '기업 홍보' }
    ]
  });
});

// API 엔드포인트: 수동 새로고침
app.get('/api/refresh', async (req, res) => {
  try {
    const videos = await getYouTubeVideos();
    const processedVideos = processVideos(videos);
    
    res.json({
      success: true,
      message: '영상 정보 새로고침 완료',
      count: processedVideos.length,
      lastUpdate: new Date().toISOString()
    });
  } catch (error) {
    console.error('새로고침 오류:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 헬스 체크
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`🚀 SpyMedia YouTube Automation 서버 실행 중`);
  console.log(`📍 http://localhost:${PORT}`);
  console.log(`📌 API: http://localhost:${PORT}/api/videos`);
  console.log(`📌 카테고리: http://localhost:${PORT}/api/categories`);
  console.log(`🔄 새로고침: http://localhost:${PORT}/api/refresh`);
});
