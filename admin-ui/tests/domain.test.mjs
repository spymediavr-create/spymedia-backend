import test from 'node:test';
import assert from 'node:assert/strict';
import {CHANNELS, validateMedia, parseTags, recommendTags, draftIssues, composeCaption, MAX_VIDEO_BYTES} from '../public/domain.js';
test('media validation rejects empty, wrong type and oversize files', () => {
  assert.ok(validateMedia({size:0,type:'video/mp4'},'video'));
  assert.ok(validateMedia({size:500,type:'image/svg+xml'},'image'));
  assert.ok(validateMedia({size:MAX_VIDEO_BYTES+1,type:'video/mp4'},'video'));
  assert.equal(validateMedia({size:500,type:'image/png'},'image'),'');
});
test('hashtags normalize, deduplicate and do not carry markup', () => {
  assert.deepEqual(parseTags('#제주, #제주 #FPV <script>'),['제주','FPV','script']);
  assert.equal(parseTags(Array.from({length:50},(_,i)=>`tag${i}`).join(' ')).length,30);
  assert.deepEqual(recommendTags('','','제주','드론촬영'),[]);
  assert.ok(recommendTags('제주 해안 드론 영상','파도를 기록했습니다').includes('항공촬영'));
});
test('draft validation distinguishes missing video on YouTube', () => {
  const draft={title:'제목',description:'설명',video:null,images:[{}],channels:new Set(['youtube'])};
  assert.equal(draftIssues(draft).length,1);
  assert.match(draftIssues(draft)[0],/영상/);
  assert.equal(draftIssues({...draft,channels:new Set(['instagram'])}).length,0);
  assert.equal(draftIssues({...draft,title:' ',description:' ',images:[],channels:new Set()}).length,4);
});
test('channel names and blog draft preserve the agreed wording', () => {
  assert.deepEqual(CHANNELS.map(item=>item.name),['유튜브','인스타그램','X','페이스북','블로그']);
  assert.equal(composeCaption(' 제목 ',' 설명 ',['제주']), '제목\n\n설명\n\n#제주');
});
