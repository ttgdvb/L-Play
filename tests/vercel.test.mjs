import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.env.VERCEL = '1';
process.env.LA_PUBLIC_HOSTS = 'music.example.com';
const { default: app, createApp } = await import('../server.mjs');
let port;
before(async () => { app.listen(0, '127.0.0.1'); await once(app, 'listening'); port = app.address().port; });
after(async () => { app.closeAllConnections(); await new Promise(resolve => app.close(resolve)); });

function request(path, { method = 'GET', host = 'laplay-tau.vercel.app', origin, data, headers = {}, targetPort = port } = {}) {
  return new Promise((resolve, reject) => {
    const payload = data === undefined ? null : JSON.stringify(data);
    const req = http.request({ hostname: '127.0.0.1', port: targetPort, path, method, headers: {
      Host: host, ...headers, ...(origin ? { Origin: origin } : {}),
      ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
    } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject); req.end(payload);
  });
}

test('Vercel entrypoint imports with filesystem writes forbidden', () => {
  const cwd = fileURLToPath(new URL('..', import.meta.url));
  const script = "const {default:server}=await import('./server.mjs'); if(typeof server.listen!=='function'||server.listening)process.exit(1); console.log('valid unbound server');";
  const child = spawnSync(process.execPath, ['--permission', '--allow-fs-read=*', '--input-type=module', '-e', script], { cwd, env: process.env, encoding: 'utf8', timeout: 10000 });
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /valid unbound server/);
});

test('deployment serves HTML and all shell assets from the exported server', async () => {
  for (const path of ['/', '/app.js', '/app.css', '/playback-order.js', '/sw.js', '/icon.svg', '/manifest.webmanifest']) {
    const res = await request(path); assert.equal(res.status, 200, path); assert.ok(res.body.length > 0, path);
  }
  const health = await request('/api/health'); assert.equal(health.status, 200);
  const state = JSON.parse(health.body); assert.equal(state.deployment, 'vercel'); assert.equal(state.localOnly, false); assert.equal(state.toolsReady, false);
  assert.equal((await request('/api/library', { host: 'music.example.com' })).status, 200);
});

test('HTTPS same-origin demo playback supports MP3 range requests', async () => {
  const library = JSON.parse((await request('/api/library')).body); assert.equal(library.tracks.length, 3);
  const prep = await request('/api/prepare', { method: 'POST', origin: 'https://laplay-tau.vercel.app', data: { id: library.tracks[0].id } });
  assert.equal(prep.status, 200); const job = JSON.parse(prep.body); assert.equal(job.state, 'ready');
  const audio = await request(job.url, { headers: { Range: 'bytes=0-127' } });
  assert.equal(audio.status, 206); assert.equal(audio.headers['content-type'], 'audio/mpeg'); assert.equal(audio.body.length, 128);
});

test('unconfigured online audio returns a useful 503 instead of starting a local-only job', async () => {
  for (const [path, options] of [
    ['/api/search?q=music', {}],
    ['/api/prepare', { method: 'POST', data: { id: 'BBBBBBBBBBB' } }],
    ['/api/recommendations/BBBBBBBBBBB?title=music', {}],
  ]) {
    const res = await request(path, options); assert.equal(res.status, 503); assert.equal(JSON.parse(res.body).code, 'AUDIO_BACKEND_REQUIRED');
  }
});

test('deployment rejects foreign origins, invalid hosts and private files', async () => {
  const cross = await request('/api/prepare', { method: 'POST', origin: 'https://other.vercel.app', data: { id: 'demo-focus' } });
  assert.equal(cross.status, 403);
  assert.equal((await request('/', { host: 'laplay-tau.vercel.app.attacker.example' })).status, 403);
  assert.equal((await request('/.runtime/config.json')).status, 404);
});

test('a locally created server keeps localhost/LAN restrictions', async () => {
  const local = createApp(); local.listen(0, '127.0.0.1'); await once(local, 'listening');
  try {
    const res = await request('/', { targetPort: local.address().port }); assert.equal(res.status, 403); assert.equal(JSON.parse(res.body).code, 'LOCAL_ONLY');
  } finally { local.closeAllConnections(); await new Promise(resolve => local.close(resolve)); }
});
