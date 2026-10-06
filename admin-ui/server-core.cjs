const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const {promisify} = require('node:util');
const scrypt = promisify(crypto.scrypt);
const {Service} = require('./backend/service.cjs');
const root = path.join(__dirname, 'public');
const assets = new Map(['styles.css', 'app.js', 'login.js', 'domain.js', 'youtube-url.js', 'server-ui.js', 'catalog-ui.js', 'instagram-design.js'].map(file => ['/admin-assets/' + file, file]));
const SESSION_MS = 30 * 60 * 1000;
const LIMIT_WINDOW_MS = 10 * 60 * 1000;

function createAdminHandler(options = {}) {
  const mode = options.mode || process.env.APP_MODE || 'disabled';
  const username = options.username || process.env.ADMIN_LOGIN_ID || '';
  const passwordHash = options.passwordHash || process.env.ADMIN_PASSWORD_SCRYPT || '';
  const service = options.service || new Service();
  const secureCookie = service.settings.production || (options.secureCookie ?? (process.env.SECURE_COOKIE === 'true'));
  const configured = mode === 'authenticated' && !!username && /^[a-f0-9]{32,128}:[a-f0-9]{128}$/i.test(passwordHash) && (!service.settings.production || !!service.settings.origin);
  const sessions = new Map();
  const attempts = new Map();
  const local = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host || '');
  function json(res, status, value, headers = {}) { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', ...headers}); res.end(JSON.stringify(value)); }
  function session(req) {
    const now = Date.now();
    for (const [id, entry] of sessions) if (entry.expires <= now) sessions.delete(id);
    const token = /(?:^|;\s*)spymedia_admin=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
    return token && sessions.has(token) ? token : null;
  }
  function sameOrigin(req) {
    const protocol = secureCookie ? 'https' : 'http';
    return req.headers.origin === (service.settings.origin || `${protocol}://${req.headers.host}`);
  }
  const cookie = token => `spymedia_admin=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? SESSION_MS / 1000 : 0}${secureCookie ? '; Secure' : ''}`;
  async function readJson(req) {
    if (!(req.headers['content-type'] || '').startsWith('application/json')) throw Object.assign(new Error(), {status:415});
    if (Number(req.headers['content-length'] || 0) > 65536) throw Object.assign(new Error(), {status:413});
    const buffers = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 65536) throw Object.assign(new Error(), {status:413}); buffers.push(chunk); }
    try { return JSON.parse(Buffer.concat(buffers).toString('utf8')); } catch { throw Object.assign(new Error(), {status:400}); }
  }
  async function file(res, name) { res.writeHead(200, {'Content-Type':name.endsWith('.css') ? 'text/css; charset=utf-8' : name.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8'}); res.end(await fs.readFile(path.join(root, name))); }
  return async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const route = url.pathname;
    if (!(route === '/admin' || route.startsWith('/admin/') || route.startsWith('/admin-assets/') || route.startsWith('/api/admin/') || route.startsWith('/sns-media/'))) return false;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    const sessionId = session(req);
    const authenticated = !!sessionId;
    // Preview is an explicit capability of the separate loopback server only.
    // A generic environment variable must never enable it in the existing web service.
    const preview = options.allowPreview === true && mode === 'preview' && local(req);
    try {
      if (route === '/api/admin/status' && req.method === 'GET') {
        json(res, 200, {build:'sns-admin-v1',commit:process.env.RENDER_GIT_COMMIT || null,mode:preview ? 'preview' : mode === 'preview' ? 'disabled' : mode,authenticationConfigured:configured,authenticated,uploadsConnected:false,postingConnected:false,...(authenticated?{csrfToken:sessions.get(sessionId).csrf,...await service.status()}:{})});
      } else if (route === '/api/admin/login' && req.method === 'POST') {
        if (!sameOrigin(req)) { json(res, 403, {error:'Origin rejected'}); return true; }
        if (!configured) { json(res, 503, {error:'Administrator authentication is not configured'}); return true; }
        const now = Date.now();
        for (const [ip, entry] of attempts) if (now > entry.until) attempts.delete(ip);
        const ip = req.socket.remoteAddress;
        const attempt = attempts.get(ip) || {count:0, until:now + LIMIT_WINDOW_MS};
        if (attempt.count >= 5) { json(res, 429, {error:'Try again later'}, {'Retry-After':String(Math.ceil((attempt.until-now)/1000))}); return true; }
        attempt.count++; attempts.set(ip, attempt);
        const body = await readJson(req);
        if (typeof body?.username !== 'string' || typeof body?.password !== 'string' || body.username.length > 120 || body.password.length > 256) { json(res, 400, {error:'Invalid login input'}); return true; }
        const [salt, expected] = passwordHash.split(':');
        const derived = await scrypt(body.password, Buffer.from(salt, 'hex'), 64);
        const valid = crypto.timingSafeEqual(derived, Buffer.from(expected, 'hex')) && body.username === username;
        body.password = '';
        if (!valid) { json(res, 401, {error:'Invalid login'}); return true; }
        attempts.delete(ip);
        if(sessionId)sessions.delete(sessionId);
        const token = crypto.randomBytes(32).toString('hex'); sessions.set(token, {expires:Date.now()+SESSION_MS,csrf:crypto.randomBytes(32).toString('hex')});
        json(res, 200, {authenticated:true}, {'Set-Cookie':cookie(token)});
      } else if (route.startsWith('/sns-media/')) {
        if(!['GET','HEAD'].includes(req.method)){json(res,405,{error:'method_not_allowed'});return true;}
        await service.sendMedia(req,res,url,true);
      } else if (route.startsWith('/api/admin/')) {
        if(!authenticated){json(res,401,{error:'authentication_required'});return true;}
        if(!['GET','HEAD'].includes(req.method)&&(!sameOrigin(req)||req.headers['x-csrf-token']!==sessions.get(sessionId).csrf)){json(res,403,{error:'csrf_rejected'});return true;}
        if(route==='/api/admin/logout'&&req.method==='POST'){
          sessions.delete(sessionId);json(res,200,{authenticated:false},{'Set-Cookie':cookie('')});
        }else if(route==='/api/admin/media'&&req.method==='POST'){
          const media=await service.photos.upload(req);json(res,201,{media});
        }else if(route==='/api/admin/youtube/import'&&req.method==='POST'){
          const body=await readJson(req);json(res,200,{video:await service.youtubeSource.fetch(body.url)});
        }else if(route.startsWith('/api/admin/media/')&&['GET','HEAD'].includes(req.method)){
          await service.sendMedia(req,res,url);
        }else if(route==='/api/admin/jobs'&&req.method==='GET'){
          json(res,200,{jobs:await service.jobs.list()});
        }else if(route==='/api/admin/jobs'&&req.method==='POST'){
          json(res,202,{jobs:await service.jobs.create(await readJson(req))});
        }else if(route==='/api/admin/jobs/start'&&req.method==='POST'){
          const body=await readJson(req);json(res,202,{jobs:await service.jobs.start(body.ids)});
        }else if(route==='/api/admin/jobs/retry'&&req.method==='POST'){
          const body=await readJson(req);json(res,202,{jobs:await service.jobs.retry(body.id)});
        }else if(route==='/api/admin/catalog'&&req.method==='GET'){
          json(res,200,await service.catalog.list({kind:url.searchParams.get('kind')||'media',bin:url.searchParams.get('bin')||'active',offset:Number(url.searchParams.get('offset')||0),limit:Number(url.searchParams.get('limit')||20)}));
        }else if(['/api/admin/catalog/trash','/api/admin/catalog/restore'].includes(route)&&req.method==='POST'){
          const body=await readJson(req);json(res,200,await service.catalog.change(body.kind,body.ids,route.endsWith('/restore')));
        }else json(res,404,{error:'not_found'});
      } else if (req.method !== 'GET') {
        json(res, 405, {error:'Method not allowed'}, {'Allow':'GET'});
      } else if (assets.has(route)) {
        await file(res, assets.get(route));
      } else if (route === '/admin/login') {
        await file(res, 'login.html');
      } else if (route === '/admin/preview' && preview) {
        await file(res, 'admin.html');
      } else if (route === '/admin/instagram' || route === '/admin/instagram/preview' && preview) {
        if(authenticated||preview)await file(res,'instagram-design.html');else {res.writeHead(303,{'Location':'/admin/login'});res.end();}
      } else if (route === '/admin' || route === '/admin/') {
        if (authenticated) await file(res, 'admin.html'); else { res.writeHead(303, {'Location':'/admin/login'}); res.end(); }
      } else json(res, 404, {error:'Not found'});
    } catch (error) { if (!res.headersSent) json(res, error.status || 500, {error:error.status&&error.code?error.code:'request_failed'}); else res.end(); }
    return true;
  };
}

function adminMiddleware(options) {
  const handler = createAdminHandler(options);
  return (req, res, next) => { handler(req, res).then(handled => { if (!handled) next(); }).catch(next); };
}

module.exports = {createAdminHandler, adminMiddleware};
