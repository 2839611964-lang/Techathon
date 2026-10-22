import chat from './api/chat.js';
import analyzeFace from './api/analyze-face.js';
import realtimeToken from './api/realtime-token.js';
import { attachDoubaoRealtimeServer } from './server/doubao-realtime.js';

const routes = new Map([
  ['/api/chat', chat],
  ['/api/analyze-face', analyzeFace],
  ['/api/realtime-token', realtimeToken],
]);

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

export function localApi() {
  return {
    name: 'marie-local-api',
    configureServer(server) {
      attachDoubaoRealtimeServer(server.httpServer);
      server.middlewares.use(async (req, res, next) => {
        const path = new URL(req.url, 'http://localhost').pathname;
        const handler = routes.get(path);
        if (!handler) return next();

        req.body = await readBody(req);
        res.status = (code) => { res.statusCode = code; return res; };
        res.json = (payload) => {
          if (res.writableEnded) return res;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(payload));
          return res;
        };

        try {
          await handler(req, res);
        } catch (error) {
          if (!res.writableEnded) res.status(500).json({ error: `本地 API 失败：${error.message}` });
        }
      });
    },
  };
}
