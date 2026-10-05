import http from 'node:http';
import {createAdminHandler} from './server-core.cjs';
const handler = createAdminHandler({mode:'preview', allowPreview:true});
const server = http.createServer((req, res) => {
  if (req.url === '/') { res.writeHead(303, {Location:'/admin/login'}); res.end(); return; }
  handler(req,res).then(handled => { if (!handled) { res.writeHead(404); res.end('Not found'); } });
});
const port = Number(process.env.PORT || 4310);
server.listen(port, '127.0.0.1', () => console.log(`SpyMedia local UI: http://127.0.0.1:${port}/admin/login (preview only; no uploads or publishing)`));
