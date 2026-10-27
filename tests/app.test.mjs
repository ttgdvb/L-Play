import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, copyFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createApp, parseRange, isAllowedClient } from '../server.mjs';
let app,origin;
before(async()=>{app=createApp();app.listen(0,'127.0.0.1');await once(app,'listening');origin=`http://127.0.0.1:${app.address().port}`;});
after(async()=>{app.closeAllConnections();await new Promise(r=>app.close(r));});
test('supports open-ended and suffix ranges; rejects invalid or multi-range input',()=>{
  assert.deepEqual(parseRange('bytes=0-9',100),{start:0,end:9});
  assert.deepEqual(parseRange('bytes=90-',100),{start:90,end:99});
  assert.deepEqual(parseRange('bytes=-15',100),{start:85,end:99});
  assert.deepEqual(parseRange('bytes=0-200',100),{start:0,end:99});
  for(const value of ['bytes=100-','bytes=9-2','bytes=-0','bytes=0-1,5-7','bytes=-','bytes=99999999999999999999-'])assert.equal(parseRange(value,100),false);
});
test('demo preparation yields MP3; partial bytes and HEAD expose correct lengths',async()=>{
  const prep=await fetch(origin+'/api/prepare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'demo-focus'})});
  assert.equal(prep.status,200);const job=await prep.json();assert.equal(job.state,'ready');
  const head=await fetch(origin+job.url,{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.headers.get('content-type'),'audio/mpeg');assert.ok(Number(head.headers.get('content-length'))>10000);
  const part=await fetch(origin+job.url,{headers:{Range:'bytes=0-127'}});assert.equal(part.status,206);assert.equal(part.headers.get('content-length'),'128');assert.equal((await part.arrayBuffer()).byteLength,128);
  const invalid=await fetch(origin+job.url,{headers:{Range:'bytes=999999999999-'}});assert.equal(invalid.status,416);
});
test('rejects invalid identifiers, arbitrary remote URLs, and cross-origin POSTs',async()=>{
  const id=await fetch(origin+'/api/prepare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'../../config'})});assert.equal(id.status,400);
  const remote=await fetch(origin+'/api/search?q='+encodeURIComponent('http://127.0.0.1/private'));assert.equal(remote.status,400);
  const cross=await fetch(origin+'/api/prepare',{method:'POST',headers:{Origin:'https://example.com','Content-Type':'application/json'},body:JSON.stringify({id:'demo-focus'})});assert.equal(cross.status,403);
  const runtime=await fetch(origin+'/.runtime/config.json');assert.equal(runtime.status,404);
});
test('LAN access accepts the chosen subnet and excludes other networks',()=>{
  assert.equal(isAllowedClient('127.0.0.1',null),true);
  assert.equal(isAllowedClient('::ffff:192.168.1.48','192.168.1.31',24),true);
  assert.equal(isAllowedClient('192.168.1.255','192.168.1.31',24),true);
  assert.equal(isAllowedClient('192.168.2.48','192.168.1.31',24),false);
  assert.equal(isAllowedClient('10.0.0.48','192.168.1.31',24),false);
  assert.equal(isAllowedClient('8.8.8.8','192.168.1.31',24),false);
  assert.equal(isAllowedClient('192.168.1.48',null,24),false);
});
test('a completed MP3 can be replayed without resolving YouTube metadata',async()=>{
  const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const cache=path.join(root,'.cache','audio');await mkdir(cache,{recursive:true});
  const fixture=path.join(cache,'cacheTest01.mp3');
  await copyFile(path.join(root,'dist','audio','demo-focus.mp3'),fixture);
  try {
    const response=await fetch(origin+'/api/prepare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'cacheTest01'})});
    assert.equal(response.status,200);const job=await response.json();assert.equal(job.state,'ready');assert.equal(job.firstAudioMs,0);assert.equal(job.seekable,true);
  }finally{await unlink(fixture);}
});
test('serves playback order module and rejects recommendations with no seed metadata',async()=>{
  const module=await fetch(origin+'/playback-order.js');assert.equal(module.status,200);assert.match(module.headers.get('content-type'),/javascript/);
  const invalid=await fetch(origin+'/api/recommendations/invalid');assert.equal(invalid.status,404);
  const missing=await fetch(origin+'/api/recommendations/BBBBBBBBBBB');assert.equal(missing.status,400);
});
