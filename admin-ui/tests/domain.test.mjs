import test from 'node:test';
import assert from 'node:assert/strict';
import {CHANNELS,validateMedia,parseTags,recommendTags,draftIssues,composeCaption,MAX_IMAGE_BYTES,xTextLength,shortXText} from '../public/domain.js';
test('photo selection excludes empty, unsupported and oversized files',()=>{
  assert.ok(validateMedia({size:0,type:'image/png'},'image'));assert.ok(validateMedia({size:500,type:'image/svg+xml'},'image'));
  assert.ok(validateMedia({size:MAX_IMAGE_BYTES+1,type:'image/jpeg'},'image'));assert.equal(validateMedia({size:500,type:'image/png'},'image'),'');
});
test('hashtags normalize, deduplicate and do not carry markup',()=>{
  assert.deepEqual(parseTags('#제주, #제주 #FPV <script>'),['제주','FPV','script']);
  assert.equal(parseTags(Array.from({length:50},(_,i)=>'tag'+i).join(' ')).length,30);
  assert.deepEqual(recommendTags('','','서울','드론촬영'),[]);assert.ok(recommendTags('제주 해안 드론 영상','파도를 담았습니다').includes('항공촬영'));
});
test('link drafts require a safe YouTube source and permitted channels',()=>{
  const draft={title:'제목',description:'설명',youtubeUrl:'https://youtu.be/AbCdEf123_-',channels:new Set(['facebook','blog'])};
  assert.deepEqual(draftIssues(draft),[]);assert.equal(draftIssues({...draft,channels:new Set(['instagram'])}).length,1);
  assert.equal(draftIssues({...draft,title:' ',description:' ',youtubeUrl:'javascript:alert(1)',channels:new Set()}).length,4);
  assert.ok(draftIssues({...draft,channels:new Set(['x']),xText:'가'.repeat(140)}).length);
});
test('X draft default fits the weighted limit including the source URL and preserves Korean characters',()=>{
  assert.equal(xTextLength('가😀a'),5);assert.equal(xTextLength('https://youtu.be/AbCdEf123_-'),23);
  const text=shortXText('촬영 영상','제주 바다 '.repeat(150),['제주']);
  assert.ok(xTextLength(text+'\n\nhttps://www.youtube.com/watch?v=AbCdEf123_-')<=280);assert.ok(!text.includes('�'));
});
test('five channel labels and blog draft preserve the agreed wording',()=>{
  assert.deepEqual(CHANNELS.map(item=>item.name),['유튜브','인스타그램','X','페이스북','블로그']);assert.equal(composeCaption(' 제목 ',' 설명 ',['제주']),'제목\n\n설명\n\n#제주');
});
