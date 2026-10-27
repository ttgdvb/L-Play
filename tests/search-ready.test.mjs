import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import path from 'node:path';
import { tmpdir } from 'node:os';

process.env.VERCEL = '1';
// Readiness checks configured executables, not external source availability.
process.env.LA_PYTHON = process.execPath;
process.env.LA_FFMPEG = path.join(tmpdir(), 'laplay-missing-encoder', 'ffmpeg');
const { default: app } = await import('../server.mjs');

test('metadata search readiness remains separate from MP3 tooling and storage', async () => {
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  try {
    const state = await new Promise((resolve, reject) => {
      http.get({ hostname: '127.0.0.1', port: app.address().port, path: '/api/health', headers: { Host: 'laplay-tau.vercel.app' } }, res => {
        let data = ''; res.on('data', chunk => data += chunk); res.on('end', () => resolve(JSON.parse(data))); res.on('error', reject);
      }).on('error', reject);
    });
    assert.equal(state.searchReady, true);
    assert.equal(state.toolsReady, false);
    assert.equal(state.deployment, 'vercel');
  } finally { app.closeAllConnections(); await new Promise(resolve => app.close(resolve)); }
});
