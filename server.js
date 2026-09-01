require('dotenv').config();

const axios = require('axios');
const cors = require('cors');
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID || 'UCw7OnhgTIih0M5PoMkwCDug';
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS) || 15 * 60 * 1000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const HASHTAG_MAP = {
  '부동산': 'real',
  '부동산촬영': 'real',
  'fpv': 'fpv',
  'fpv드론': 'fpv',
  'fpv드론촬영': 'fpv',
  '씨네후프': 'fpv',
  'vr': 'map',
  'vr파노라마': 'map',
  '360vr': 'map',
  '3d매핑': 'map',
  '3d맵핑': 'map',
  '보안': 'security',
  '보안수색': 'security',
  '수색드론': 'security',
  '순찰': 'security',
  '관광': 'tour',
  '관광지홍보': 'tour',
  '관광홍보': 'tour',
  '기업': 'etc',
  '기업홍보': 'etc',
  '기업홍보영상': 'etc',
  '뮤직비디오': 'etc'
};

let videoCache = [];
let cacheUpdatedAt = 0;

function requireYouTubeApiKey() {
  if (!YOUTUBE_API_KEY) {
    throw new Error('YOUTUBE_API_KEY is not configured.');
  }
}

async function getUploadsPlaylistId() {
  const response = await axios.get(`${YOUTUBE_API_BASE}/channels`, {
    params: {
      key: YOUTUBE_API_KEY,
      id: CHANNEL_ID,
      part: 'contentDetails'
    }
  });

  const playlistId = response.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!playlistId) {
    throw new Error(`Uploads playlist was not found for channel ${CHANNEL_ID}.`);
  }

  return playlistId;
}

async function getAllUploadVideoIds(playlistId) {
  const videoIds = [];
  let pageToken;

  do {
    const response = await axios.get(`${YOUTUBE_API_BASE}/playlistItems`, {
      params: {
        key: YOUTUBE_API_KEY,
        playlistId,
        part: 'contentDetails',
        maxResults: 50,
        pageToken
      }
    });

    for (const item of response.data.items || []) {
      const videoId = item.contentDetails?.videoId;
      if (videoId) videoIds.push(videoId);
    }

    pageToken = response.data.nextPageToken;
  } while (pageToken);

  return [...new Set(videoIds)];
}

async function getVideoDetails(videoIds) {
  const videos = [];

  for (let index = 0; index < videoIds.length; index += 50) {
    const batch = videoIds.slice(index, index + 50);
    const response = await axios.get(`${YOUTUBE_API_BASE}/videos`, {
      params: {
        key: YOUTUBE_API_KEY,
        id: batch.join(','),
        part: 'snippet,contentDetails,statistics',
        maxResults: 50
      }
    });

    videos.push(...(response.data.items || []));
  }

  return videos;
}

async function getYouTubeVideos() {
  requireYouTubeApiKey();
  const uploadsPlaylistId = await getUploadsPlaylistId();
  const videoIds = await getAllUploadVideoIds(uploadsPlaylistId);
  return getVideoDetails(videoIds);
}

function extractHashtags(text) {
  if (!text) return [];

  return (text.match(/#[^\s#]+/gu) || []).map(tag =>
    tag.slice(1).normalize('NFKC').toLowerCase()
  );
}

function categorizeByHashtags(hashtags) {
  const categories = new Set();

  for (const tag of hashtags) {
    const cleanTag = tag.normalize('NFKC').toLowerCase();

    if (HASHTAG_MAP[cleanTag]) {
      categories.add(HASHTAG_MAP[cleanTag]);
      continue;
    }

    for (const [key, value] of Object.entries(HASHTAG_MAP)) {
      if (cleanTag.includes(key) || key.includes(cleanTag)) {
        categories.add(value);
      }
    }
  }

  if (!categories.size) categories.add('all');
  return [...categories];
}

function processVideos(videos) {
  return videos
    .map(video => {
      const title = video.snippet?.title || '';
      const description = video.snippet?.description || '';
      const hashtags = [...new Set(extractHashtags(`${title} ${description}`))];

      return {
        videoId: video.id,
        title,
        description,
        thumbnail:
          video.snippet?.thumbnails?.maxres?.url ||
          video.snippet?.thumbnails?.high?.url ||
          video.snippet?.thumbnails?.medium?.url ||
          video.snippet?.thumbnails?.default?.url ||
          `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`,
        publishedAt: video.snippet?.publishedAt || '',
        channelTitle: video.snippet?.channelTitle || '',
        hashtags,
        categories: categorizeByHashtags(hashtags),
        viewCount: video.statistics?.viewCount || '0',
        likeCount: video.statistics?.likeCount || '0',
        duration: video.contentDetails?.duration || 'PT0S'
      };
    })
    .filter(video => video.videoId && video.title)
    .sort((a, b) => {
      const bTime = Date.parse(b.publishedAt) || 0;
      const aTime = Date.parse(a.publishedAt) || 0;
      return bTime - aTime;
    });
}

async function loadVideos(forceRefresh = false) {
  const cacheIsFresh = videoCache.length && Date.now() - cacheUpdatedAt < CACHE_TTL_MS;
  if (!forceRefresh && cacheIsFresh) return videoCache;

  try {
    const videos = processVideos(await getYouTubeVideos());
    videoCache = videos;
    cacheUpdatedAt = Date.now();
    return videoCache;
  } catch (error) {
    if (videoCache.length && !forceRefresh) {
      console.error('YouTube refresh failed; serving cached videos:', error.message);
      return videoCache;
    }
    throw error;
  }
}

app.get('/api/videos', async (req, res) => {
  try {
    const tag = req.query.tag || 'all';
    const videos = await loadVideos();
    const filteredVideos = tag === 'all'
      ? videos
      : videos.filter(video => video.categories.includes(tag));

    res.json({
      success: true,
      count: filteredVideos.length,
      tag,
      lastUpdate: cacheUpdatedAt ? new Date(cacheUpdatedAt).toISOString() : null,
      videos: filteredVideos
    });
  } catch (error) {
    console.error('Video API error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/categories', (req, res) => {
  res.json({
    success: true,
    categories: [
      { id: 'all', name: 'ALL', label: '전체' },
      { id: 'fpv', name: 'FPV / 씨네후프', label: 'FPV / 씨네후프' },
      { id: 'real', name: '부동산', label: '부동산' },
      { id: 'tour', name: '관광지 홍보', label: '관광지 홍보' },
      { id: 'security', name: '보안 수색', label: '보안 수색' },
      { id: 'map', name: '3D 매핑 / VR', label: '3D 매핑 / VR' },
      { id: 'etc', name: '기업 홍보', label: '기업 홍보' }
    ]
  });
});

app.get('/api/refresh', async (req, res) => {
  try {
    const videos = await loadVideos(true);
    res.json({
      success: true,
      message: 'YouTube video cache refreshed',
      count: videos.length,
      lastUpdate: new Date(cacheUpdatedAt).toISOString()
    });
  } catch (error) {
    console.error('Refresh error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'Server is running',
    cachedVideoCount: videoCache.length,
    lastUpdate: cacheUpdatedAt ? new Date(cacheUpdatedAt).toISOString() : null,
    timestamp: new Date().toISOString()
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`SpyMedia YouTube API running on port ${PORT}`);
  });
}

module.exports = {
  app,
  categorizeByHashtags,
  extractHashtags,
  getAllUploadVideoIds,
  getVideoDetails,
  processVideos
};
