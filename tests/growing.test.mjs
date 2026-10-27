import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile, appendFile, rename, unlink, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveGrowingMP3 } from '../stream-growing.mjs';

test('serves audio before encoding completes, survives rename and returns every byte',async()=>{
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const directory = await mkdtemp(path.join(root,'.runtime','stream-test-'));
  const job = {state:'streaming',partialPath:path.join(directory,'audio.part'),finalPath:path.join(directory,'audio.mp3')};
  const first = Buffer.alloc(12000,1), last = Buffer.alloc(9000,2);
  await writeFile(job.partialPath,first);
  const server=http.createServer((req,res)=>serveGrowingMP3(req,res,job));
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try {
    const response=await fetch(`http://127.0.0.1:${server.address().port}/audio.mp3`);
    assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'audio/mpeg');assert.equal(response.headers.get('content-length'),null);
    const reader=response.body.getReader();const initial=await reader.read();
    assert.equal(job.state,'streaming');assert.ok(initial.value.length>0,'bytes must arrive while the job is still running');
    await appendFile(job.partialPath,last);await rename(job.partialPath,job.finalPath);job.state='ready';
    const chunks=[Buffer.from(initial.value)];
    for(;;){const part=await reader.read();if(part.done)break;chunks.push(Buffer.from(part.value));}
    assert.deepEqual(Buffer.concat(chunks),Buffer.concat([first,last]));
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await unlink(job.finalPath).catch(()=>{});await unlink(job.partialPath).catch(()=>{});await rmdir(directory);}
});
