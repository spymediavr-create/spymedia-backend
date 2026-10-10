import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createAdminHandler} from '../server-core.cjs';

async function fixture(t,preview=false){
  const handler=createAdminHandler({mode:preview?'preview':'disabled',allowPreview:preview});
  const server=http.createServer((req,res)=>handler(req,res).then(handled=>{if(!handled){res.writeHead(404);res.end();}}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  return `http://127.0.0.1:${server.address().port}`;
}
test('browser media runtime is unavailable without a session or explicit local preview',async t=>{
  const url=await fixture(t);
  for(const file of ['ffmpeg/index.js','ffmpeg/worker.js','ffmpeg-core/ffmpeg-core.js','ffmpeg-core/ffmpeg-core.wasm']){
    const response=await fetch(url+'/admin-assets/vendor/'+file);
    assert.equal(response.status,401);assert.equal(response.headers.get('cache-control'),'no-store');
  }
});
test('browser runtime assets have correct MIME and narrow Wasm CSP with no unrestricted eval',async t=>{
  const url=await fixture(t,true);
  const worker=await fetch(url+'/admin-assets/vendor/ffmpeg/worker.js');
  assert.equal(worker.status,200);assert.match(await worker.text(),/ffmpeg\.ffprobe/);
  const policy=worker.headers.get('content-security-policy');
  assert.match(policy,/'wasm-unsafe-eval'/);assert.doesNotMatch(policy,/(?:^|\s)'unsafe-eval'/);
  const wasm=await fetch(url+'/admin-assets/vendor/ffmpeg-core/ffmpeg-core.wasm',{method:'HEAD'});
  assert.equal(wasm.status,200);assert.equal(wasm.headers.get('content-type'),'application/wasm');
  assert.ok(Number(wasm.headers.get('content-length'))>30000000);assert.equal(wasm.headers.get('vary'),'Cookie');
  const page=await fetch(url+'/admin/preview');
  assert.match(page.headers.get('content-security-policy'),/worker-src 'self'/);
  assert.doesNotMatch(page.headers.get('content-security-policy'),/unsafe-eval/);
});
test('runtime allowlist rejects package files, traversal, unsupported methods, and foreign preview hosts',async t=>{
  const url=await fixture(t,true);
  for(const file of ['ffmpeg/package.json','ffmpeg/classes.d.ts','ffmpeg-core/package.json','ffmpeg/../../server-core.cjs']){
    assert.equal((await fetch(url+'/admin-assets/vendor/'+file)).status,404);
  }
  assert.equal((await fetch(url+'/admin-assets/vendor/ffmpeg/index.js',{method:'POST'})).status,405);
  const foreign=await new Promise(resolve=>http.get(url+'/admin-assets/vendor/ffmpeg/index.js',{headers:{Host:'foreign.invalid'}},res=>{res.resume();resolve(res.statusCode);}));
  assert.equal(foreign,401);
});
