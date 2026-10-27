import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCloudAudio } from '../cloud-audio.mjs';
import { readPreparedAudio } from '../dist/prepare-audio.js';

test('separate backend instances reuse a complete shared MP3 without a local job or encoder', async () => {
  let lookups = 0;
  const store = { ready: () => true, find: async () => { lookups++; return { url: 'https://example.com/cached.mp3', bytes: 16000 }; } };
  const first = createCloudAudio({ store, maxActive: 0 });
  const second = createCloudAudio({ store, maxActive: 0 });
  for (const backend of [first, second]) {
    const audio = await backend.prepare('BBBBBBBBBBB');
    assert.equal(audio.state, 'ready'); assert.equal(audio.cached, true); assert.equal(audio.seekable, true);
    assert.equal(audio.url, 'https://example.com/cached.mp3');
  }
  assert.equal(lookups, 2);
});

test('invalid IDs and cancelled requests never access storage', async () => {
  let lookups = 0;
  const backend = createCloudAudio({ store: { ready: () => true, find: async () => { lookups++; return null; } } });
  await assert.rejects(backend.prepare('../../etc/passwd'), { code: 'INVALID_INPUT' });
  const controller = new AbortController(); controller.abort(new Error('cancelled'));
  await assert.rejects(backend.prepare('BBBBBBBBBBB', { signal: controller.signal }), /cancelled/);
  assert.equal(lookups, 0);
});

test('missing storage and missing conversion tooling produce distinct actionable errors', async () => {
  await assert.rejects(createCloudAudio({ store: { ready: () => false } }).prepare('BBBBBBBBBBB'), { code: 'STORAGE_REQUIRED', status: 503 });
  await assert.rejects(createCloudAudio({ store: { ready: () => true, find: async () => null } }).prepare('BBBBBBBBBBB'), { code: 'SETUP_REQUIRED', status: 503 });
});

test('progress reader survives fragmented UTF-8 and returns the completed MP3', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ type: 'progress', message: 'Đang chuẩn bị âm thanh…' }) + '\n' + JSON.stringify({ type: 'ready', state: 'ready', url: 'https://example.com/audio.mp3' }) + '\n');
  let offset = 0;
  const stream = new ReadableStream({ pull(controller) { if (offset >= bytes.length) return controller.close(); controller.enqueue(bytes.slice(offset, offset += 5)); } });
  const messages = [], job = await readPreparedAudio(new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } }), message => messages.push(message));
  assert.deepEqual(messages, ['Đang chuẩn bị âm thanh…']); assert.equal(job.state, 'ready'); assert.equal(job.url, 'https://example.com/audio.mp3');
});

test('source errors and interrupted progress streams cannot appear as successful playback', async () => {
  const response = new Response(JSON.stringify({ type: 'error', error: 'YouTube từ chối nguồn.' }) + '\n', { headers: { 'Content-Type': 'application/x-ndjson' } });
  await assert.rejects(readPreparedAudio(response), /YouTube từ chối nguồn/);
  await assert.rejects(readPreparedAudio(new Response('{"type":"progress","message":"loading"}\n', { headers: { 'Content-Type': 'application/x-ndjson' } })), /Kết nối bị ngắt/);
  await assert.rejects(readPreparedAudio(new Response('{"error":"not available"}', { status: 502, headers: { 'Content-Type': 'application/json' } })), /not available/);
});

test('local progressive jobs and sample JSON responses remain compatible', async () => {
  const job = await readPreparedAudio(Response.json({ id: 'demo-focus', state: 'ready', url: '/audio/demo-focus.mp3' }));
  assert.equal(job.id, 'demo-focus'); assert.equal(job.state, 'ready');
});
