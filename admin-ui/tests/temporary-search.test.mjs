import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {randomBytes,scryptSync} from 'node:crypto';
import {config} from '../backend/config.cjs';
import {Service} from '../backend/service.cjs';
import {Store} from '../backend/store.cjs';
import {TemporarySearch,ENDPOINT,RESULTS_PER_REQUEST} from '../backend/temporary-search.cjs';
import {searchResultUrl} from '../public/search-result-url.js';
import {createAdminHandler} from '../server-core.cjs';
const keyword='합성 검색어 & + #',key=randomBytes(24).toString('hex');
const body=(patch={})=>({platform:'instagram',keyword,region:'충청도',page:0,...patch});
const result=(url,title='합성 제목',description='합성 검색 설명')=>({url,title,description});
const payload=(results=[],more=false)=>({status:200,data:{query:{more_results_available:more},web:{results}}});
const code=(value,status)=>e=>e.code===value&&e.status===status;
function fixture(options={}){
  let time=100000,calls=[];
  const settings=config({BRAVE_SEARCH_ENABLED:'true',BRAVE_SEARCH_API_KEY:key,...options.env});
  const search=new TemporarySearch(settings,{now:()=>time,get:async(...args)=>{calls.push(args);return (options.get||(()=>payload()))(...args);}});
  return {settings,search,calls,advance:(ms=3000)=>time+=ms};
}

test('no existing key/enable flag means no request and no fake result; status never exposes a credential',async()=>{
  for(const env of [{BRAVE_SEARCH_API_KEY:''},{BRAVE_SEARCH_ENABLED:'false'},{BRAVE_SEARCH_API_KEY:'bad\nheader'}]){
    const f=fixture({env});assert.equal(f.search.describe().ready,false);await assert.rejects(()=>f.search.search(body()),code('temporary_search_unconfigured',503));assert.equal(f.calls.length,0);assert.ok(!JSON.stringify(f.search.describe()).includes(key));
  }
});

test('only the fixed Brave HTTPS endpoint is queried with bounded options and one selected SNS domain',async()=>{
  for(const [platform,domain]of Object.entries({instagram:'site:instagram.com',facebook:'site:facebook.com',x:'(site:x.com OR site:twitter.com)',blog:'site:blog.naver.com'})){
    const f=fixture();await f.search.search(body({platform,page:9}));const [url,options]=f.calls[0];assert.equal(url,ENDPOINT);assert.equal(new URL(url).origin,'https://api.search.brave.com');assert.equal(options.params.count,20);assert.equal(options.params.offset,9);assert.equal(options.maxRedirects,0);assert.equal(options.timeout,8000);assert.equal(options.maxContentLength,1024*1024);assert.equal(options.responseType,'json');assert.equal(options.headers['X-Subscription-Token'],key);assert.equal(options.headers['Cache-Control'],'no-cache');assert.ok(options.params.q.endsWith(domain));assert.ok(options.params.q.includes(keyword));assert.ok(options.params.q.includes('충북 OR 충남 OR 대전 OR 세종'));assert.equal(options.params.result_filter,'web');assert.equal(options.params.text_decorations,false);
  }
  const f=fixture();await f.search.search(body({region:'전국'}));assert.equal(f.calls[0][1].params.q,keyword+' site:instagram.com');
});

test('strict input validation bounds pages 0–9, fields, strings and provider query limits before any request',async()=>{
  const f=fixture();
  for(const bad of [null,[],{},body({platform:'youtube'}),body({keyword:' '}),body({keyword:'x'.repeat(201)}),body({keyword:'bad\nline'}),body({region:null}),body({region:'x'.repeat(101)}),body({page:-1}),body({page:10}),body({page:'0'}),body({page:0.5}),{...body(),url:'http://127.0.0.1'},body({keyword:'x '.repeat(95)})])await assert.rejects(()=>f.search.search(bad),code('invalid_temporary_search',400));
  assert.equal(f.calls.length,0);
});

test('four SNS normalize profile aliases and identify supported posts without inventing a profile identity',()=>{
  const cases=[
    ['instagram','https://instagram.com/Fixture/?igsh=track','https://www.instagram.com/fixture/','profile'],
    ['instagram','https://www.instagram.com/p/CaseSensitive/?igsh=track','https://www.instagram.com/p/CaseSensitive/','post'],
    ['instagram','https://instagram.com/reel/Case_123','https://www.instagram.com/reel/Case_123/','post'],
    ['facebook','https://m.facebook.com/Fixture/?ref=track','https://www.facebook.com/fixture','profile'],
    ['facebook','https://facebook.com/people/합성/12345','https://www.facebook.com/profile.php?id=12345','profile'],
    ['facebook','https://facebook.com/profile.php?id=12345&ref=track','https://www.facebook.com/profile.php?id=12345','profile'],
    ['facebook','https://facebook.com/Fixture/posts/pfbidAbC123?tracking=x','https://www.facebook.com/fixture/posts/pfbidAbC123','post'],
    ['facebook','https://facebook.com/watch/?v=12345&ref=x','https://www.facebook.com/watch/?v=12345','post'],
    ['facebook','https://facebook.com/photo.php?fbid=12345&ref=x','https://www.facebook.com/photo.php?fbid=12345','post'],
    ['facebook','https://facebook.com/permalink.php?story_fbid=12345&id=56789&ref=x','https://www.facebook.com/permalink.php?story_fbid=12345&id=56789','post'],
    ['x','https://mobile.twitter.com/Fixture?ref=x','https://x.com/fixture','profile'],
    ['x','https://twitter.com/Fixture/status/12345?ref=x','https://x.com/fixture/status/12345','post'],
    ['blog','https://m.blog.naver.com/Fixture','https://blog.naver.com/fixture','profile'],
    ['blog','https://blog.naver.com/PostList.naver?blogId=Fixture','https://blog.naver.com/fixture','profile'],
    ['blog','https://m.blog.naver.com/Fixture/12345?ref=x','https://blog.naver.com/fixture/12345','post'],
    ['blog','https://blog.naver.com/PostView.naver?blogId=Fixture&logNo=12345&ref=x','https://blog.naver.com/fixture/12345','post']
  ];
  for(const [platform,url,expected,kind]of cases)assert.deepEqual(searchResultUrl(platform,url),{url:expected,kind});
});

test('unsafe domains, redirects, login/private paths and malformed URLs cannot become result links',()=>{
  for(const [platform,url]of [
    ['instagram','javascript:alert(1)'],['instagram','http://instagram.com/fixture'],['instagram','https://instagram.com.evil.invalid/fixture'],['instagram','https://instagram.com@evil.invalid/fixture'],['instagram','https://u:p@instagram.com/fixture'],['instagram','https://instagram.com:8443/fixture'],['instagram','https://127.0.0.1/fixture'],['instagram','https://instagram.com/fixture\\other'],['instagram','https://instagram.com/fixture\n'],['instagram','https://instagram.com/accounts/login'],['instagram','https://instagram.com/stories/fixture/123'],['instagram','https://instagram.com/fixture%2fother'],['facebook','https://fb.me/fixture'],['facebook','https://facebook.com/l.php?u=https://evil.invalid'],['facebook','https://facebook.com/login'],['facebook','https://facebook.com/profile.php?id=1&id=2'],['x','https://t.co/fixture'],['x','https://x.com/home'],['blog','https://naver.com/fixture'],['blog','https://blog.naver.com/PostView.naver?blogId=fixture&logNo=x'],['blog','https://blog.naver.com/PostView.naver?blogId=fixture&blogId=evil&logNo=1'],['instagram','https://facebook.com/fixture']
  ])assert.equal(searchResultUrl(platform,url),null,url);
});

test('provider output is whitelisted, deduplicated and bounded; no thumbnails, account or location verification are returned',async()=>{
  const f=fixture({get:()=>payload([result('https://instagram.com/Fixture/','<script>literal</script>','<b>literal & text</b>'),result('https://www.instagram.com/fixture/?tracking=1'),result('https://evil.invalid/bad'),result('https://instagram.com/p/post123/'),result('https://instagram.com/other/', 'x'.repeat(500),'y'.repeat(1000))],true)});
  const data=await f.search.search(body());assert.equal(data.items.length,3);assert.equal(data.omitted,2);assert.equal(data.hasMore,true);assert.equal(data.items[0].title,'<script>literal</script>');assert.equal(data.items[2].title.length,200);assert.equal(data.items[2].snippet.length,600);assert.equal(data.regionVerified,false);assert.deepEqual(Object.keys(data.items[0]).sort(),['kind','snippet','title','url']);assert.equal(RESULTS_PER_REQUEST,20);assert.ok(!JSON.stringify(data).includes(key));
  assert.deepEqual(Object.keys(f.search).sort(),['busy','count','get','nextAt','now','settings','windowAt']);
});

test('empty/filtered-empty pages and final provider page do not invent counts or extra availability',async()=>{
  const empty=fixture();const a=await empty.search.search(body());assert.deepEqual(a.items,[]);assert.equal(a.hasMore,false);
  const nullable=fixture({get:()=>({status:200,data:{type:'search',query:null,web:{results:[result('https://instagram.com/fixture/')]}}})});const n=await nullable.search.search(body());assert.equal(n.items.length,1);assert.equal(n.hasMore,false);assert.equal(n.paginationKnown,false);
  const filtered=fixture({get:()=>payload([result('https://evil.invalid/only')],true)});const b=await filtered.search.search(body());assert.deepEqual(b.items,[]);assert.equal(b.hasMore,true);
  const final=fixture({get:()=>payload([],true)});const c=await final.search.search(body({page:9}));assert.equal(c.hasMore,false);assert.equal(c.limitReached,true);assert.equal(c.maxProviderPages,10);
});

test('server rate limits all admin sessions, includes failed requests, and has no automatic retries',async()=>{
  const f=fixture();await f.search.search(body());await assert.rejects(()=>f.search.search(body()),code('temporary_search_rate_limited',429));assert.equal(f.calls.length,1);
  f.advance();for(let i=1;i<20;i++){await f.search.search(body());f.advance(2100);}await assert.rejects(()=>f.search.search(body()),code('temporary_search_rate_limited',429));assert.equal(f.calls.length,20);
  f.advance(60000);await f.search.search(body());assert.equal(f.calls.length,21);
  let release;const gate=new Promise(resolve=>release=resolve),busy=fixture({get:async()=>{await gate;return payload();}});const first=busy.search.search(body());await new Promise(resolve=>setImmediate(resolve));busy.advance();await assert.rejects(()=>busy.search.search(body()),code('temporary_search_rate_limited',429));release();await first;
});

test('provider failure, auth, quota, timeout, oversized/malformed output are sanitized with no retries or raw errors',async()=>{
  for(const [status,name,expected]of [[401,'temporary_search_access',503],[403,'temporary_search_access',503],[402,'temporary_search_quota',503],[429,'temporary_search_provider_limit',429],[500,'temporary_search_failed',502],[302,'temporary_search_failed',502]]){
    const f=fixture({get:()=>({status,data:{error:'raw-private-provider-message',key}})});await assert.rejects(()=>f.search.search(body()),code(name,expected));assert.equal(f.calls.length,1);assert.equal(f.search.busy,false);
  }
  for(const failure of [{code:'ECONNABORTED',name:'temporary_search_timeout',status:504},{code:'ETIMEDOUT',name:'temporary_search_timeout',status:504},{code:'ERR_BAD_RESPONSE',name:'temporary_search_failed',status:502}]){const f=fixture({get:()=>{throw Object.assign(Error('raw '+key+' '+keyword),{code:failure.code});}});await assert.rejects(()=>f.search.search(body()),e=>e.code===failure.name&&e.status===failure.status&&!e.message.includes(key)&&!e.message.includes(keyword));assert.equal(f.calls.length,1);}
  for(const data of [null,{},[],{error:'raw'}, {query:{more_results_available:'true'},web:{results:[]}},{query:{more_results_available:false},web:{results:'raw'}},payload(Array.from({length:21},()=>result('https://instagram.com/fixture/'))).data]){const f=fixture({get:()=>({status:200,data})});await assert.rejects(()=>f.search.search(body()),code('temporary_search_invalid_response',502));}
});

async function app(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'spymedia-search-http-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const f=fixture({get:()=>payload([result('https://instagram.com/fixture/')])});
  const settings=config({SNS_DATA_DIR:dir,SNS_STORAGE_PERSISTENCE:'confirmed',SNS_SINGLE_INSTANCE:'confirmed'}),store=new Store(settings);await store.init();const before=await fs.readFile(path.join(dir,'journal.json'),'utf8');
  const service=new Service({settings,store,temporarySearch:f.search});const salt=randomBytes(16),password=randomBytes(24).toString('hex');
  const handler=createAdminHandler({mode:'authenticated',username:'fixture',passwordHash:salt.toString('hex')+':'+scryptSync(password,salt,64).toString('hex'),secureCookie:false,service}),server=http.createServer((req,res)=>handler(req,res).then(done=>{if(!done){res.writeHead(404);res.end();}}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));const origin='http://127.0.0.1:'+server.address().port;
  const login=await fetch(origin+'/api/admin/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'fixture',password})});const Cookie=login.headers.get('set-cookie').split(';')[0];const status=await(await fetch(origin+'/api/admin/status',{headers:{Cookie}})).json();
  const headers={Cookie,Origin:origin,'Content-Type':'application/json','X-CSRF-Token':status.csrfToken};
  return {...f,dir,store,before,origin,headers};
}
test('HTTP search requires auth, CSRF, same Origin, JSON POST with no query and returns no-store data without changing journal',async t=>{
  const f=await app(t),request=(patch={})=>fetch(f.origin+'/api/admin/temporary-search',{method:'POST',headers:{...f.headers,...patch},body:JSON.stringify(body())});
  assert.equal((await request({Cookie:''})).status,401);assert.equal((await request({'X-CSRF-Token':''})).status,403);assert.equal((await request({Origin:'https://evil.invalid'})).status,403);assert.equal((await request({'Content-Type':'text/plain'})).status,415);
  assert.equal((await fetch(f.origin+'/api/admin/temporary-search?q=never',{method:'POST',headers:f.headers,body:JSON.stringify(body())})).status,400);assert.equal(f.calls.length,0);
  const response=await request();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('pragma'),'no-cache');assert.equal(response.headers.get('expires'),'0');assert.equal((await response.json()).items.length,1);
  const limited=await request();assert.equal(limited.status,429);assert.ok(Number(limited.headers.get('retry-after'))>=1);assert.ok(!JSON.stringify(await limited.json()).includes(key));
  assert.equal((await fetch(f.origin+'/api/admin/temporary-search',{headers:f.headers})).status,404);assert.equal(await fs.readFile(path.join(f.dir,'journal.json'),'utf8'),f.before);assert.deepEqual(Object.keys(f.store.state).sort(),['jobs','media','version']);
});
