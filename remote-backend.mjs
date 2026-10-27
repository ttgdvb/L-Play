import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const ROUTES = /^(?:\/api\/(?:health|search|prepare)|\/api\/(?:jobs|recommendations)\/[\w-]{11}|\/api\/audio\/[\w-]{11}\.mp3)$/;
const allowedResponseHeaders = ['content-type','content-length','content-range','accept-ranges','cache-control','x-content-type-options','x-la-playback'];

// A persistent audio backend may be hosted independently of the Vercel frontend.
// All authentication stays server-side; the browser uses the same /api routes.
export function createRemoteBackend({ baseURL, key, timeoutMs = 270000 } = {}) {
  const base = new URL(baseURL);
  const local = ['localhost','127.0.0.1','[::1]'].includes(base.hostname);
  if ((base.protocol !== 'https:' && !(local && base.protocol === 'http:')) || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('Audio backend must be an HTTPS origin.');
  if (typeof key !== 'string' || key.length < 24) throw new Error('Audio backend authentication is required.');
  return {
    async handle(req, res) {
      const url = new URL(req.url, 'http://localhost');
      if (!ROUTES.test(url.pathname)) return false;
      if (!['GET','HEAD','POST'].includes(req.method) || (req.method === 'POST' && url.pathname !== '/api/prepare')) {
        res.writeHead(405); res.end(); return true;
      }
      const controller = new AbortController();
      const abort = () => { if (!res.writableEnded) controller.abort(); };
      res.once('close', abort);
      const timer = setTimeout(() => controller.abort(new Error('Backend timed out')), timeoutMs);
      try {
        const headers = { 'X-La-Backend-Key': key };
        for (const name of ['range','accept','content-type']) if (typeof req.headers[name] === 'string') headers[name] = req.headers[name];
        let body;
        if (req.method === 'POST') {
          const chunks = []; let bytes = 0;
          for await (const chunk of req) {
            bytes += chunk.length;
            if (bytes > 2048) { res.writeHead(413); res.end(); return true; }
            chunks.push(chunk);
          }
          body = Buffer.concat(chunks);
        }
        const upstream = await fetch(new URL(url.pathname + url.search, base), { method: req.method, headers, body, signal: controller.signal, redirect: 'manual' });
        if (url.pathname === '/api/health' && upstream.ok) {
          const health = await upstream.json();
          const data = JSON.stringify({ ...health, deployment: 'vercel', localOnly: false, lanEnabled: false, playback: 'remote-mp3' });
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(data) });
          res.end(data); return true;
        }
        if (upstream.status >= 300 && upstream.status < 400) throw new Error('Unexpected backend redirect');
        const responseHeaders = {};
        for (const name of allowedResponseHeaders) { const value = upstream.headers.get(name); if (value !== null) responseHeaders[name] = value; }
        responseHeaders['X-Content-Type-Options'] = 'nosniff';
        res.writeHead(upstream.status, responseHeaders);
        if (req.method === 'HEAD' || !upstream.body) res.end();
        else await pipeline(Readable.fromWeb(upstream.body), res);
        return true;
      } catch (e) {
        if (!res.destroyed) {
          if (res.headersSent) res.destroy();
          else {
            const data = JSON.stringify({ error: 'Máy chủ âm thanh chưa kết nối. Hãy kiểm tra máy chạy backend rồi thử lại.', code: 'BACKEND_OFFLINE' });
            res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(data);
          }
        }
        return true;
      } finally { clearTimeout(timer); res.off('close', abort); }
    },
  };
}
