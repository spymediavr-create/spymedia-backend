import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import {randomBytes,scryptSync} from 'node:crypto';
import {createAdminHandler} from '../server-core.cjs';

const moduleUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const source=await fs.readFile(new URL('../public/facebook-follow-actions.js',import.meta.url),'utf8');
const searchSource=await fs.readFile(new URL('../public/search-result-url.js',import.meta.url),'utf8');
const {normalizeFacebookFollowSelection:selection,validateFacebookFollowJob:valid,FACEBOOK_FOLLOW_ACTOR:ACTOR,FACEBOOK_FOLLOW_NAME:NAME}=await import(moduleUrl(source.replace("'./search-result-url.js'",JSON.stringify(moduleUrl(searchSource)))));
const selected={profiles:['https://www.facebook.com/fixture.page','https://www.facebook.com/profile.php?id=123456789'],expiresAt:123456};
const prepared=()=>({expectedAccount:ACTOR,expectedName:NAME,profiles:[...selected.profiles],expiresAt:selected.expiresAt,index:0,started:false,running:false,terminalError:null,results:[]});

test('Facebook admin selection canonicalizes only selected profiles and rejects own page/posts/unsafe URLs',()=>{
  const result=selection({platform:'facebook',profiles:['https://m.facebook.com/Fixture.Page?tracking=1','https://www.facebook.com/fixture.page','https://www.facebook.com/people/Fixture/123456789/','https://www.facebook.com/profile.php?id='+ACTOR,'https://www.facebook.com/fixture.page/posts/123','https://evil.invalid/fixture'],expiresAt:123456});
  assert.deepEqual(result.profiles,selected.profiles);assert.equal(result.invalid,3);assert.equal(result.platform,'facebook');assert.equal(result.expiresAt,123456);
  assert.equal(selection({profiles:['https://www.facebook.com/'+ACTOR]}).invalid,1);
});

test('Facebook responses bind exact page ID/name, selection, expiry and state progression',()=>{
  const first=prepared();assert.equal(valid(first,selected,'PREPARE'),true);
  const start={...first,started:true,running:true};assert.equal(valid(start,selected,'START'),true);
  const step={...start,index:1,results:[{index:0,state:'followed'}]};assert.equal(valid(step,selected,'STEP',start),true);
  const end={...step,index:2,running:false,results:[...step.results,{index:1,state:'following'}]};assert.equal(valid(end,selected,'STEP',step),true);
  for(const patch of [{expectedAccount:'other'},{expectedName:'개인 프로필'},{profiles:[selected.profiles[1],selected.profiles[0]]},{expiresAt:123457},{started:1},{running:0},{index:-1},{index:3},{terminalError:'uncertain'},{capability:'hidden-secret'}])assert.equal(valid({...first,...patch},selected,'PREPARE'),false);
  assert.equal(valid({...first,results:{}},selected,'PREPARE'),false);
  assert.equal(valid({...first,index:1,results:[{index:0,state:'followed'}]},selected,'PREPARE'),false);
});

test('Facebook STEP cannot skip/repeat indices, rewrite previous outcome, or report unrelated actions as success',()=>{
  const start={...prepared(),started:true,running:true};
  const previous={...start,index:1,results:[{index:0,state:'following'}]};
  const finish={...previous,index:2,running:false,results:[...previous.results,{index:1,state:'followed'}]};
  assert.equal(valid(finish,selected,'STEP',previous),true);
  assert.equal(valid(finish,selected,'STEP',start),false);assert.equal(valid(previous,selected,'STEP',previous),false);
  assert.equal(valid({...finish,results:[{index:0,state:'followed'},{index:1,state:'followed'}]},selected,'STEP',previous),false);
  for(const state of ['liked','friend_requested','requested','uncertain','pending','failed','__proto__'])assert.equal(valid({...finish,results:[...previous.results,{index:1,state}]},selected,'STEP',previous),false);
  assert.equal(valid({...finish,results:[...previous.results,{index:1,state:'followed',token:'never'}]},selected,'STEP',previous),false);
  assert.equal(valid({...finish,running:true},selected,'STEP',previous),false);
  assert.equal(valid(finish,selected,'STEP',null),false);assert.equal(valid(finish,selected,'UNKNOWN',previous),false);
});

test('Facebook download is authenticated, exact-route only, read-only and served as attachment',async t=>{
  const salt=randomBytes(16),password=randomBytes(24).toString('hex');
  const service={settings:{production:false},status:async()=>({})};
  const handler=createAdminHandler({mode:'authenticated',username:'fixture',passwordHash:salt.toString('hex')+':'+scryptSync(password,salt,64).toString('hex'),secureCookie:false,service});
  const server=http.createServer((req,res)=>handler(req,res).then(done=>{if(!done){res.writeHead(404);res.end();}}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const origin='http://127.0.0.1:'+server.address().port,route='/api/admin/tools/facebook-follow.zip';
  for(const method of ['GET','HEAD'])assert.equal((await fetch(origin+route,{method})).status,401);
  const login=await fetch(origin+'/api/admin/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'fixture',password})});assert.equal(login.status,200);
  const Cookie=login.headers.get('set-cookie').split(';')[0],headers={Cookie};
  const asset=await fetch(origin+'/admin-assets/facebook-follow-actions.js');assert.equal(asset.status,200);assert.match(await asset.text(),/attachFacebookFollowActions/);
  const archive=await fetch(origin+route,{headers});assert.equal(archive.status,200);assert.equal(archive.headers.get('cache-control'),'no-store');assert.equal(archive.headers.get('content-type'),'application/zip');assert.match(archive.headers.get('content-disposition'),/^attachment;/);assert.equal(Buffer.from(await archive.arrayBuffer()).readUInt32LE(0),0x04034b50);
  const head=await fetch(origin+route,{method:'HEAD',headers});assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
  for(const suffix of ['?file=other','/../private.zip'])assert.equal((await fetch(origin+route+suffix,{headers})).status,404);
  assert.equal((await fetch(origin+route,{method:'POST',headers})).status,403);
});
