import {parseYouTubeUrl} from './youtube-url.js';
export const CHANNELS = [
  { id: 'youtube', name: '유튜브', account: '@spymedia3645', initial: '▶', type: 'source', format: '영상 · 가로 / 세로', ratio: '16:9' },
  { id: 'instagram', name: '인스타그램', account: 'spymedia_kr', initial: '◎', type: 'separate', format: 'Meta Business Suite에서 별도 게시', ratio: '4:5' },
  { id: 'x', name: 'X', account: '@spymedia_kor', initial: '𝕏', type: 'both', format: '유튜브 링크 소개글', ratio: '16:9' },
  { id: 'facebook', name: '페이스북', account: '스파이미디어', initial: 'f', type: 'both', format: '유튜브 링크 소개글', ratio: '16:9' },
  { id: 'blog', name: '블로그', account: 'spymedia', initial: 'N', type: 'both', format: '원고 준비 · 반자동', ratio: '16:9' }
];

export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGES = 10;
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const videoTypes = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

export function validateMedia(file, kind) {
  if (!file || file.size === 0) return '내용이 없는 파일입니다.';
  const accepted = kind === 'video' ? videoTypes : imageTypes;
  if (!accepted.has(file.type)) return kind === 'video' ? 'MP4, WebM 또는 MOV 영상을 선택하세요.' : 'JPG, PNG 또는 WebP 이미지를 선택하세요.';
  if (file.size > (kind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES)) return kind === 'video' ? '로컬 미리보기는 500MB 이하 영상을 지원합니다.' : '이미지는 한 장당 8MB 이하로 선택하세요.';
  return '';
}

export function parseTags(value) {
  return [...new Set(String(value).split(/[\s,#]+/u).map(tag => tag.normalize('NFKC').replace(/[^\p{L}\p{N}_]/gu, '').slice(0, 40)).filter(Boolean))].slice(0, 30);
}

export function recommendTags(title, description, region = '', shootType = '') {
  const text = `${title} ${description}`.toLowerCase();
  if (!text.trim()) return [];
  const tags = ['SpyMedia'];
  const rules = [
    [/제주/, ['제주', '제주촬영']], [/부산/, ['부산', '부산촬영']], [/서울/, ['서울']],
    [/드론|항공|하늘/, ['드론촬영', '항공촬영']], [/fpv|씨네후프/, ['FPV', '씨네후프']],
    [/해안|바다|파도/, ['해안풍경', '바다']], [/부동산|아파트|건물/, ['부동산촬영']],
    [/관광|여행/, ['여행영상', '관광지']], [/기업|브랜드/, ['기업홍보']],
    [/vr|파노라마|360/, ['VR', '360영상']], [/매핑|맵핑/, ['3D매핑']], [/보안|수색/, ['보안수색']]
  ];
  for (const [pattern, matches] of rules) if (pattern.test(text)) tags.push(...matches);
  if (region.trim()) tags.push(...parseTags(region));
  if (shootType) tags.push(...parseTags(shootType));
  return parseTags(tags.join(' '));
}

export function composeCaption(title, description, tags) {
  return [title.trim(), description.trim(), tags.map(tag => `#${tag}`).join(' ')].filter(Boolean).join('\n\n');
}

export function xTextLength(text){return [...String(text).replace(/https?:\/\/\S+/g,'x'.repeat(23))].reduce((n,ch)=>n+(/[\u1100-\u11ff\u2e80-\ua4cf\uac00-\ud7af\uf900-\ufaff]/u.test(ch)||ch.codePointAt(0)>0xffff?2:1),0);}
export function shortXText(title,description,tags=[]) {
  let text=composeCaption(title,description,tags);
  while(xTextLength(text)>250)text=[...text].slice(0,-1).join('');
  return text.trim();
}
export function draftIssues({title,description,youtubeUrl,channels,xText=''}) {
  const issues=[];
  if(!title.trim())issues.push('제목을 입력하세요.');
  if(!description.trim())issues.push('설명을 입력하세요.');
  if(!parseYouTubeUrl(youtubeUrl))issues.push('올바른 유튜브 영상 주소를 입력하세요.');
  if(!channels.size)issues.push('소개할 채널을 하나 이상 선택하세요.');
  if([...channels].some(channel=>!['facebook','x','blog'].includes(channel)))issues.push('유튜브 원본과 인스타그램은 링크 전송 대상이 아닙니다.');
  if(channels.has('x')&&(!xText.trim()||xTextLength(xText+'\n\n'+(parseYouTubeUrl(youtubeUrl)?.url||''))>280))issues.push('X 소개글은 주소를 포함해 280자 이내로 준비하세요.');
  return issues;
}

export function formatBytes(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
