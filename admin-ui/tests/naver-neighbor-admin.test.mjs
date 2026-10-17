import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const moduleUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const source=await fs.readFile(new URL('../public/naver-neighbor-actions.js',import.meta.url),'utf8');
const searchSource=await fs.readFile(new URL('../public/search-result-url.js',import.meta.url),'utf8');
const {normalizeNaverNeighborSelection:selection,validateNaverNeighborJob:valid,naverNeighborErrorMessage:errorMessage,NAVER_NEIGHBOR_ACTOR:ACTOR,NAVER_NEIGHBOR_VERSION:VERSION}=await import(moduleUrl(source.replace("'./search-result-url.js'",JSON.stringify(moduleUrl(searchSource)))));
const selected={profiles:['https://blog.naver.com/fixture_one','https://blog.naver.com/fixture-two'],expiresAt:123456};
const prepared=()=>({expectedAccount:ACTOR,expectedName:ACTOR,profiles:[...selected.profiles],expiresAt:selected.expiresAt,index:0,started:false,running:false,terminalError:null,results:[]});

test('Naver missing or ambiguous advertising group errors explain why execution stopped without suggesting another group',()=>{
  assert.match(errorMessage('group_missing'),/광고 그룹을 찾지 못해 중지/);
  assert.match(errorMessage('group_ambiguous'),/광고 그룹을 하나로 확인하지 못해 중지/);
  for(const code of ['group_missing','group_ambiguous'])assert.match(errorMessage(code),/다른 그룹을 선택하거나 새 그룹을 만들지 않았습니다/);
  assert.match(errorMessage('authentication_check_failed'),/관리자 로그인 상태/);
  const fallback=errorMessage('unknown');
  for(const code of ['__proto__','constructor','toString',null,undefined,{},['group_missing']])assert.equal(errorMessage(code),fallback);
});

test('Naver selection maps only explicit blog/post URLs to canonical blogs, deduplicates, and reports derived reasons',()=>{
  const result=selection({platform:'blog',profiles:['https://m.blog.naver.com/Fixture_One/123456?tracking=1','https://blog.naver.com/fixture_one','https://blog.naver.com/PostView.naver?blogId=Fixture-Two&logNo=998877','https://blog.naver.com/PostList.naver?blogId=fixture-two','https://blog.naver.com/spymedia','https://m.blog.naver.com/SPYMEDIA/123456'],expiresAt:selected.expiresAt});
  assert.deepEqual(result.profiles,selected.profiles);assert.equal(result.derived,2);assert.equal(result.duplicates,2);assert.equal(result.own,2);assert.equal(result.invalid,0);assert.equal(result.platform,'blog');assert.equal(result.expiresAt,selected.expiresAt);
  assert.deepEqual(selection({profiles:['https://blog.naver.com/spymedia']}).profiles,[]);
  assert.equal(selection({profiles:['https://blog.naver.com/spymedia']}).own,1);
});

test('Naver selection rejects service routes, unknown post identities, credentials, other domains and malformed paths',()=>{
  const reserved=['me','myblog','admin','login','logout','help','search','feed','postlist','postview','bloghome','blogpeople','neighbor','neighbors','buddy','buddyadd','manage','settings','write','section','service','notice'];
  const unsafe=['https://evil.invalid/fixture_one','http://blog.naver.com/fixture_one','https://blog.naver.com:8443/fixture_one','https://user:password@blog.naver.com/fixture_one','https://www.naver.com/fixture_one','https://blog.naver.com/fixture_one/not-a-post','https://blog.naver.com/fixture_one/123/extra','https://blog.naver.com/fixture%2fone','https://blog.naver.com/PostView.naver?blogId=fixture_one&blogId=other&logNo=123','https://blog.naver.com/PostView.naver?logNo=123','https://blog.naver.com/PostView.naver?blogId=fixture_one&logNo=abc','https://blog.naver.com/fixture_one\\other','https://blog.naver.com/fixture_one\n',...reserved.map(name=>'https://blog.naver.com/'+name),...reserved.map(name=>'https://m.blog.naver.com/'+name+'/123')];
  const result=selection({profiles:unsafe});assert.deepEqual(result.profiles,[]);assert.equal(result.invalid,unsafe.length);assert.equal(result.derived,0);
  assert.equal(selection({profiles:['https://blog.naver.com/'+'a'.repeat(51)]}).invalid,1);
});

test('Naver canonical profile deduplication allows distinct-blog counting while preserving the actual reviewed order',()=>{
  const many=Array.from({length:12},(_,i)=>'https://blog.naver.com/fixture_one/'+(100+i));
  const mapped=selection({profiles:many});assert.deepEqual(mapped.profiles,[selected.profiles[0]]);assert.equal(mapped.duplicates,11);assert.equal(mapped.derived,12);
  const distinct=selection({profiles:Array.from({length:11},(_,i)=>'https://blog.naver.com/fixture_'+i)});assert.equal(distinct.profiles.length,11);assert.equal(distinct.invalid,0);
  assert.deepEqual(selection({profiles:[selected.profiles[1],selected.profiles[0],selected.profiles[1]]}).profiles,[selected.profiles[1],selected.profiles[0]]);
});

test('Naver job validation requires the exact actor, reviewed blogs, selection TTL, and confirmed PREPARE/START state',()=>{
  assert.equal(ACTOR,'spymedia');assert.equal(VERSION,'0.1.0');const first=prepared();assert.equal(valid(first,selected,'PREPARE'),true);
  assert.equal(valid({...first,started:true,running:true},selected,'START'),true);
  for(const patch of [{expectedAccount:'other'},{expectedName:'스파이미디어'},{profiles:[selected.profiles[1],selected.profiles[0]]},{profiles:['https://blog.naver.com/other']},{expiresAt:123457},{started:1},{running:'true'},{index:-1},{index:3},{terminalError:'uncertain'},{capability:'never expose'}])assert.equal(valid({...first,...patch},selected,'PREPARE'),false);
  assert.equal(valid({...first,results:{}},selected,'PREPARE'),false);assert.equal(valid(null,selected,'PREPARE'),false);
  assert.equal(valid({...first,started:true},selected,'PREPARE'),false);assert.equal(valid({...first,running:true},selected,'PREPARE'),false);assert.equal(valid(first,selected,'START'),false);
});

test('Naver STEP accepts added/existing only, advances once, preserves previous results, and never treats a request as completion',()=>{
  const start={...prepared(),started:true,running:true};
  const first={...start,index:1,results:[{index:0,state:'existing'}]};assert.equal(valid(first,selected,'STEP',start),true);
  const final={...first,index:2,running:false,results:[...first.results,{index:1,state:'added'}]};assert.equal(valid(final,selected,'STEP',first),true);
  assert.equal(valid(final,selected,'STEP',start),false);assert.equal(valid(first,selected,'STEP',first),false);assert.equal(valid(final,selected,'STEP',null),false);assert.equal(valid(final,selected,'UNKNOWN',first),false);
  assert.equal(valid({...final,results:[{index:0,state:'added'},{index:1,state:'added'}]},selected,'STEP',first),false);
  for(const state of ['followed','following','requested','mutual_requested','pending','uncertain','failed','__proto__'])assert.equal(valid({...final,results:[...first.results,{index:1,state}]},selected,'STEP',first),false);
  assert.equal(valid({...final,running:true},selected,'STEP',first),false);
  assert.equal(valid({...final,results:[...first.results,{index:1,state:'added',message:'not allowed'}]},selected,'STEP',first),false);
  assert.equal(valid({...final,results:[...first.results,{index:0,state:'added'}]},selected,'STEP',first),false);
});

test('Naver STEP rejects sparse/inherited result indices and array states without type coercion',()=>{
  const start={...prepared(),started:true,running:true};
  const step={...start,index:1,results:[{index:0,state:'added'}]};assert.equal(valid(step,selected,'STEP',start),true);
  assert.equal(valid({...step,results:new Array(1)},selected,'STEP',start),false);
  const inherited=new Array(1);Object.setPrototypeOf(inherited,{0:{index:0,state:'added'},[Symbol.iterator]:Array.prototype[Symbol.iterator]});
  assert.equal(valid({...step,results:inherited},selected,'STEP',start),false);
  for(const state of [['added'],['existing'],new String('added'),{toString:()=> 'added'},null,undefined,1])assert.equal(valid({...step,results:[{index:0,state}]},selected,'STEP',start),false);
  assert.equal(valid({...step,results:[undefined]},selected,'STEP',start),false);
});
