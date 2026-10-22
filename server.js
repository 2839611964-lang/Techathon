import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';
import chat from './api/chat.js';
import analyzeFace from './api/analyze-face.js';
import realtimeToken from './api/realtime-token.js';
import { attachDoubaoRealtimeServer } from './server/doubao-realtime.js';

try { process.loadEnvFile?.('.env.local'); } catch { /* production uses injected environment */ }

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), 'dist');
const routes = new Map([
  ['/api/chat', chat],
  ['/api/analyze-face', analyzeFace],
  ['/api/realtime-token', realtimeToken],
]);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp4': 'video/mp4',
};

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

function sendFile(pathname, req, res) {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(root, clean === '/' ? 'index.html' : clean);
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
  res.statusCode = 200;
  const extension = extname(file); const compressible = ['.html', '.js', '.css', '.json', '.svg'].includes(extension);
  res.setHeader('Content-Type', types[extension] || 'application/octet-stream');
  if (extension === '.mp4') {
    const size = statSync(file).size;
    res.setHeader('Accept-Ranges', 'bytes');
    const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start >= size || end < start) { res.writeHead(416, {'Content-Range': `bytes */${size}`}); res.end(); return; }
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Content-Length', end-start+1);
      createReadStream(file, {start,end}).pipe(res); return;
    }
    res.setHeader('Content-Length', size);
  }
  if (pathname === '/sw.js') res.setHeader('Cache-Control', 'no-cache');
  else if (pathname.startsWith('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  else if (/\.(?:webp|png|svg|woff2)$/.test(pathname)) res.setHeader('Cache-Control', 'public, max-age=86400');
  else res.setHeader('Cache-Control', 'no-cache');
  if (compressible && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    res.setHeader('Content-Encoding', 'gzip'); res.setHeader('Vary', 'Accept-Encoding');
    createReadStream(file).pipe(createGzip({ level: 6 })).pipe(res); return;
  }
  createReadStream(file).pipe(res);
}

const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const handler = routes.get(pathname);
  if (!handler) { sendFile(pathname, req, res); return; }
  req.body = await body(req);
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => {
    if (res.writableEnded) return res;
    res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(payload)); return res;
  };
  try { await handler(req, res); } catch (error) {
    if (!res.writableEnded) res.status(500).json({ error: `服务失败：${error.message}` });
  }
});

attachDoubaoRealtimeServer(server);
const port = Number(process.env.PORT || 4173);
server.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`Marie is ready on http://localhost:${port}`));
