import { open } from 'node:fs/promises';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function drain(response) {
  return new Promise(resolve => {
    const finish = () => { response.off('drain', finish); response.off('close', finish); resolve(); };
    response.once('drain', finish); response.once('close', finish);
  });
}

// A first listener receives MP3 bytes as they are written. Completed files use
// the ordinary Range endpoint instead, with their exact Content-Length.
export async function serveGrowingMP3(req, res, job) {
  let file, position = 0, closed = false;
  const onClose = () => { closed = true; };
  res.once('close', onClose);
  try {
    const deadline = Date.now() + 190000;
    while (!file && !closed) {
      if (job.state === 'error') throw new Error(job.error || 'Audio preparation failed');
      try { file = await open(job.state === 'ready' ? job.finalPath : job.partialPath, 'r'); }
      catch (e) { if (e.code !== 'ENOENT') throw e; if (Date.now() > deadline) throw new Error('Audio preparation timed out'); await sleep(80); }
    }
    if (!file || closed) return;
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'Accept-Ranges': 'none', 'X-Content-Type-Options': 'nosniff', 'X-La-Playback': 'progressive' });
    if (req.method === 'HEAD') { res.end(); return; }
    const buffer = Buffer.allocUnsafe(64 * 1024);
    while (!closed) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
      if (bytesRead) {
        position += bytesRead;
        // Copy because the next read reuses the same buffer.
        if (!res.write(Buffer.from(buffer.subarray(0, bytesRead)))) await drain(res);
      } else if (job.state === 'ready') { res.end(); return; }
      else if (job.state === 'error') throw new Error(job.error || 'Audio preparation interrupted');
      else { if (Date.now() > deadline) throw new Error('Audio preparation timed out'); await sleep(80); }
    }
  } catch (e) {
    if (!closed) {
      if (res.headersSent) res.destroy();
      else { res.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ error:'Nguồn âm thanh bị gián đoạn. Hãy thử lại.', code:'AUDIO_INTERRUPTED' })); }
    }
  } finally { res.off('close', onClose); await file?.close().catch(() => {}); }
}
