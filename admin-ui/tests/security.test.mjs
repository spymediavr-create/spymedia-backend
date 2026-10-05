import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {scryptSync,randomBytes} from 'node:crypto';
import {createAdminHandler} from '../server-core.cjs';
async function app(options) {
  const handler=createAdminHandler(options);
  const server=http.createServer((req,res)=>handler(req,res).then(handled=>{if(!handled){res.writeHead(404);res.end();}}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {server,url:`http://127.0.0.1:${server.address().port}`};
}
test('disabled auth and local preview cannot act as authenticated APIs', async t=>{
  const {server,url}=await app({mode:'preview',allowPreview:true}); t.after(()=>server.close());
  const status=await (await fetch(url+'/api/admin/status')).json();
  assert.equal(status.authenticated,false); assert.equal(status.mode,'preview');
  assert.equal((await fetch(url+'/api/admin/upload',{method:'POST',body:'content'})).status,401);
  assert.equal((await fetch(url+'/admin',{redirect:'manual'})).status,303);
  assert.equal((await fetch(url+'/admin/preview')).status,200);
  assert.equal((await fetch(url+'/admin-assets/admin.html')).status,404);
  assert.equal((await fetch(url+'/admin-assets/../server-core.cjs')).status,404);
  const foreignHostStatus = await new Promise((resolve,reject) => {
    http.get(url+'/admin/preview',{headers:{Host:'example.invalid'}},response=>{response.resume();resolve(response.statusCode);}).on('error',reject);
  });
  assert.equal(foreignHostStatus,404);
  assert.equal((await fetch(url+'/api/admin/login',{method:'POST',headers:{Origin:url,'Content-Type':'application/json'},body:'{}'})).status,503);
});
test('preview mode alone cannot expose administrator HTML or enable authentication',async t=>{
  const {server,url}=await app({mode:'preview',allowPreview:false});t.after(()=>server.close());
  assert.equal((await fetch(url+'/admin/preview')).status,404);
  assert.equal((await fetch(url+'/admin',{redirect:'manual'})).status,303);
  assert.equal((await fetch(url+'/admin-assets/admin.html')).status,404);
  assert.equal((await fetch(url+'/api/admin/upload',{method:'POST'})).status,401);
  const status=await(await fetch(url+'/api/admin/status')).json();
  assert.equal(status.mode,'disabled');assert.equal(status.authenticationConfigured,false);assert.equal(status.authenticated,false);
});
test('configured sessions require credentials and same origin; logout revokes access', async t=>{
  // Process-only test fixture: no real account or persistent credential is created.
  const salt=randomBytes(16),password=randomBytes(32).toString('hex'); const passwordHash=salt.toString('hex')+':'+scryptSync(password,salt,64).toString('hex');
  const {server,url}=await app({mode:'authenticated',username:'fixture',passwordHash}); t.after(()=>server.close());
  const login=(password,origin=url)=>fetch(url+'/api/admin/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'fixture',password})});
  assert.equal((await fetch(url+'/admin/preview')).status,404);
  assert.equal((await login(password,'https://other.invalid')).status,403);
  assert.equal((await login('wrong')).status,401);
  const response=await login(password); assert.equal(response.status,200);
  const setCookie=response.headers.get('set-cookie'); assert.match(setCookie,/HttpOnly/); assert.match(setCookie,/SameSite=Strict/);
  const Cookie=setCookie.split(';')[0];
  const protectedPage=await fetch(url+'/admin',{headers:{Cookie}}); assert.equal(protectedPage.status,200); assert.match(protectedPage.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  const status=await(await fetch(url+'/api/admin/status',{headers:{Cookie}})).json();
  assert.match(status.csrfToken,/^[a-f0-9]{64}$/);
  assert.equal((await fetch(url+'/api/admin/jobs',{method:'POST',headers:{Cookie,Origin:url}})).status,403);
  assert.equal((await fetch(url+'/api/admin/jobs',{method:'POST',headers:{Cookie,Origin:url,'X-CSRF-Token':status.csrfToken,'Content-Type':'application/json'},body:'{}'})).status,400);
  assert.equal((await fetch(url+'/api/admin/logout',{method:'POST',headers:{Cookie,Origin:'https://other.invalid'}})).status,403);
  assert.equal((await fetch(url+'/api/admin/logout',{method:'POST',headers:{Cookie,Origin:url,'X-CSRF-Token':status.csrfToken}})).status,200);
  assert.equal((await fetch(url+'/admin',{headers:{Cookie},redirect:'manual'})).status,303);
});
test('repeated failed logins are limited',async t=>{
  const salt=randomBytes(16);const passwordHash=salt.toString('hex')+':'+scryptSync(randomBytes(32).toString('hex'),salt,64).toString('hex');
  const {server,url}=await app({mode:'authenticated',username:'fixture',passwordHash});t.after(()=>server.close());
  for(let i=0;i<5;i++)assert.equal((await fetch(url+'/api/admin/login',{method:'POST',headers:{Origin:url,'Content-Type':'application/json'},body:JSON.stringify({username:'fixture',password:'wrong'})})).status,401);
  assert.equal((await fetch(url+'/api/admin/login',{method:'POST',headers:{Origin:url,'Content-Type':'application/json'},body:'{}'})).status,429);
});
