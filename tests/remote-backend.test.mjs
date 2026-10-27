import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createRemoteBackend } from '../remote-backend.mjs';

const key = 'test-only-backend-key-0000000001';
let upstream, gateway, origin, received;
before(async () => {
  upstream = http.createServer(async (req, res) => {
    received = { headers: req.headers, method: req.method, url: req.url };
    if (req.url === '/api/health') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ ok: true, toolsReady: true, deployment: 'local', localOnly: true })); }
    if (req.url.startsWith('/api/audio/')) {
      res.writeHead(206, { 'Content-Type': 'audio/mpeg', 'Content-Range': 'bytes 0-127/1000', 'Content-Length': '128', 'Accept-Ranges': 'bytes', 'X-La-Backend-Key': key });
      return res.end(Buffer.alloc(128, 7));
    }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    received.body = Buffer.concat(chunks).toString();
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ state: 'queued', id: 'BBBBBBBBBBB' }));
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const remote = createRemoteBackend({ baseURL: `http://127.0.0.1:${upstream.address().port}`, key });
  gateway = http.createServer(async (req, res) => { if (!await remote.handle(req, res)) { res.writeHead(404); res.end(); } });
  gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening'); origin = `http://127.0.0.1:${gateway.address().port}`;
});
after(async () => { for (const app of [gateway, upstream]) { app.closeAllConnections(); await new Promise(resolve => app.close(resolve)); } });

test('gateway uses only its server key and never forwards browser cookies or login headers', async () => {
  const response = await fetch(origin + '/api/search?q=music', { headers: { Cookie: 'test-session=example', Authorization: 'Bearer test-browser-login', Origin: 'https://laplay-tau.vercel.app' } });
  assert.equal(response.status, 200); await response.json();
  assert.equal(received.headers['x-la-backend-key'], key);
  assert.equal(received.headers.cookie, undefined); assert.equal(received.headers.authorization, undefined); assert.equal(received.headers.origin, undefined);
});

test('MP3 bytes and Range headers survive the gateway without exposing the backend key', async () => {
  const response = await fetch(origin + '/api/audio/BBBBBBBBBBB.mp3', { headers: { Range: 'bytes=0-127' } });
  assert.equal(response.status, 206); assert.equal(response.headers.get('content-type'), 'audio/mpeg');
  assert.equal(response.headers.get('content-range'), 'bytes 0-127/1000'); assert.equal(response.headers.get('x-la-backend-key'), null);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.alloc(128, 7)); assert.equal(received.headers.range, 'bytes=0-127');
});

test('prepare forwards the JSON job contract while health identifies the online frontend', async () => {
  const body = JSON.stringify({ id: 'BBBBBBBBBBB' });
  const response = await fetch(origin + '/api/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  assert.equal((await response.json()).state, 'queued'); assert.equal(received.body, body);
  const health = await (await fetch(origin + '/api/health')).json(); assert.equal(health.toolsReady, true); assert.equal(health.deployment, 'vercel'); assert.equal(health.localOnly, false);
});

test('gateway rejects unsafe origins and unsupported routes rather than exposing an open proxy', async () => {
  assert.throws(() => createRemoteBackend({ baseURL: 'http://example.com', key }), /HTTPS/);
  assert.throws(() => createRemoteBackend({ baseURL: 'https://example.com/private/', key }), /HTTPS/);
  assert.throws(() => createRemoteBackend({ baseURL: 'https://example.com', key: 'short' }), /authentication/);
  assert.equal((await fetch(origin + '/.runtime/config.json')).status, 404);
  assert.equal((await fetch(origin + '/api/prepare', { method: 'POST', body: 'x'.repeat(2049) })).status, 413);
});
