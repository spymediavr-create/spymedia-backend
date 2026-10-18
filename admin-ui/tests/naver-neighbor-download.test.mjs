import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import {randomBytes,scryptSync} from 'node:crypto';
import {createAdminHandler} from '../server-core.cjs';

const download='/api/admin/tools/naver-neighbor.zip';
const asset='/admin-assets/naver-neighbor-actions.js';
const files=['README.md','background.mjs','bridge.js','core.mjs','dom-agent.mjs','manifest.json'];

async function localServer(t){
  const salt=randomBytes(16),password=randomBytes(24).toString('hex');
  const service={settings:{production:false},status:async()=>({})};
  const handler=createAdminHandler({mode:'authenticated',username:'download-fixture',passwordHash:salt.toString('hex')+':'+scryptSync(password,salt,64).toString('hex'),secureCookie:false,service});
  const server=http.createServer((req,res)=>handler(req,res).then(handled=>{if(!handled){res.writeHead(404);res.end();}}));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const origin='http://127.0.0.1:'+server.address().port;
  const login=async()=>{
    const response=await fetch(origin+'/api/admin/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'download-fixture',password})});
    assert.equal(response.status,200);
    const Cookie=response.headers.get('set-cookie').split(';')[0];
    const status=await fetch(origin+'/api/admin/status',{headers:{Cookie}});
    const body=await status.json();assert.equal(body.authenticated,true);
    return {Cookie,Origin:origin,'X-CSRF-Token':body.csrfToken};
  };
  return {origin,login};
}

function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let n=0;n<8;n++)crc=crc&1?(crc>>>1)^0xedb88320:crc>>>1;}return(crc^0xffffffff)>>>0;}

// Read the distribution as a ZIP consumer would: verify the central directory,
// local records, integrity and exact payload. No archive is extracted to disk.
function storedZipEntries(zip){
  const end=zip.length-22;
  assert.equal(zip.readUInt32LE(end),0x06054b50,'Expected a complete, comment-free ZIP');
  assert.equal(zip.readUInt16LE(end+4),0);assert.equal(zip.readUInt16LE(end+6),0);
  const count=zip.readUInt16LE(end+10),size=zip.readUInt32LE(end+12),start=zip.readUInt32LE(end+16);
  assert.equal(zip.readUInt16LE(end+8),count);assert.equal(zip.readUInt16LE(end+20),0);assert.equal(start+size,end);
  const entries=new Map();let cursor=start,expectedLocalOffset=0;
  for(let index=0;index<count;index++){
    assert.equal(zip.readUInt32LE(cursor),0x02014b50);
    const flags=zip.readUInt16LE(cursor+8),method=zip.readUInt16LE(cursor+10),crc=zip.readUInt32LE(cursor+16);
    const compressed=zip.readUInt32LE(cursor+20),length=zip.readUInt32LE(cursor+24),nameLength=zip.readUInt16LE(cursor+28),extraLength=zip.readUInt16LE(cursor+30),commentLength=zip.readUInt16LE(cursor+32),offset=zip.readUInt32LE(cursor+42);
    const name=zip.subarray(cursor+46,cursor+46+nameLength).toString('utf8');
    assert.equal(flags,0x800,'UTF-8 names, without encryption or deferred records');assert.equal(method,0);assert.equal(compressed,length);
    assert.equal(offset,expectedLocalOffset,'No unlisted payload may precede an entry');assert.equal(entries.has(name),false,'No duplicate filenames');
    assert.equal(zip.readUInt32LE(offset),0x04034b50);assert.equal(zip.readUInt16LE(offset+6),flags);assert.equal(zip.readUInt16LE(offset+8),method);
    assert.equal(zip.readUInt32LE(offset+14),crc);assert.equal(zip.readUInt32LE(offset+18),length);assert.equal(zip.readUInt32LE(offset+22),length);
    const localNameLength=zip.readUInt16LE(offset+26),localExtraLength=zip.readUInt16LE(offset+28);
    assert.equal(zip.subarray(offset+30,offset+30+localNameLength).toString('utf8'),name);
    const dataStart=offset+30+localNameLength+localExtraLength,data=zip.subarray(dataStart,dataStart+length);
    assert.equal(data.length,length);assert.equal(crc32(data),crc,'ZIP entry checksum: '+name);
    entries.set(name,data);expectedLocalOffset=dataStart+length;cursor+=46+nameLength+extraLength+commentLength;
  }
  assert.equal(cursor,end);assert.equal(expectedLocalOffset,start);return entries;
}

test('Naver administrator module is public, exact and served as JavaScript without making account actions',async t=>{
  const {origin}=await localServer(t);
  const response=await fetch(origin+asset);assert.equal(response.status,200);
  assert.match(response.headers.get('content-type'),/^text\/javascript/);assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal(response.headers.get('cache-control'),'no-store');
  const source=await response.text();assert.equal(source,await fs.readFile(new URL('../public/naver-neighbor-actions.js',import.meta.url),'utf8'));
  assert.match(source,/attachNaverNeighborActions/);
  assert.equal((await fetch(origin+'/admin-assets/naver-neighbor-actions.js.map')).status,404);
  assert.equal((await fetch(origin+'/admin-assets/naver-neighbor-actions.js/other')).status,404);
});

test('Naver ZIP requires a live administrator session, permits GET/HEAD only and rejects alternate paths or query parameters',async t=>{
  const {origin,login}=await localServer(t);
  for(const method of ['GET','HEAD','POST'])assert.equal((await fetch(origin+download,{method})).status,401);
  assert.equal((await fetch(origin+download,{headers:{Cookie:'spymedia_admin='+'a'.repeat(64)}})).status,401);
  const headers=await login();
  const response=await fetch(origin+download,{headers});assert.equal(response.status,200);
  const zip=Buffer.from(await response.arrayBuffer());
  assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('content-type'),'application/zip');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  assert.equal(response.headers.get('content-disposition'),'attachment; filename="spymedia-naver-neighbor.zip"');assert.equal(Number(response.headers.get('content-length')),zip.length);
  assert.deepEqual(zip,await fs.readFile(new URL('../downloads/naver-neighbor.zip',import.meta.url)));
  const head=await fetch(origin+download,{method:'HEAD',headers});assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
  for(const name of ['content-type','content-length','content-disposition','cache-control'])assert.equal(head.headers.get(name),response.headers.get(name));
  for(const suffix of ['?file=other.zip','?token=not-a-credential','?download=1','/','/../private.zip'])assert.equal((await fetch(origin+download+suffix,{headers})).status,404,suffix);
  for(const method of ['POST','PUT','PATCH','DELETE','OPTIONS'])assert.equal((await fetch(origin+download,{method,headers})).status,404,method+' must not invoke a ZIP or mutation route even with valid CSRF');
  assert.equal((await fetch(origin+'/api/admin/logout',{method:'POST',headers})).status,200);
  assert.equal((await fetch(origin+download,{headers})).status,401,'Logging out revokes access to the same download');
});

test('Naver ZIP contains only the six installable extension files and each payload matches the reviewed source',async()=>{
  const zip=await fs.readFile(new URL('../downloads/naver-neighbor.zip',import.meta.url)),entries=storedZipEntries(zip);
  assert.deepEqual([...entries.keys()].sort(),files.slice().sort());
  for(const name of files)assert.deepEqual(entries.get(name),await fs.readFile(new URL('../../browser-tools/naver-neighbor/'+name,import.meta.url)),'Packaged source must be current: '+name);
  const manifest=JSON.parse(entries.get('manifest.json').toString('utf8'));
  assert.equal(manifest.manifest_version,3);assert.equal(manifest.version,'0.1.1');assert.equal(manifest.background.service_worker,'background.mjs');
  assert.deepEqual(manifest.permissions,['scripting']);assert.deepEqual(manifest.host_permissions,['https://blog.naver.com/*','https://spymedia-backend.onrender.com/*']);
});
