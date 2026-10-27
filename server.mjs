import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { mkdir, stat, readdir, unlink, rename, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { networkInterfaces, tmpdir } from 'node:os';
import { isIPv4 } from 'node:net';
import { serveGrowingMP3 } from './stream-growing.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, 'dist');
const IS_VERCEL = process.env.VERCEL === '1';
const CACHE = IS_VERCEL ? path.join(tmpdir(), 'la-play', 'audio') : path.join(ROOT, '.cache', 'audio');
const ID = /^[a-zA-Z0-9_-]{11}$/;
const jobs = new Map(), metadata = new Map(), searches = new Map(), running = new Set();
const sourceRequests = new Map();
const recommendationCache = new Map(), recommendationRequests = new Map();
const MAX_CACHE = 256 * 1024 * 1024, TTL = 60 * 60 * 1000;
let active = 0;
let config = {};
try { config = JSON.parse(readFileSync(path.join(ROOT, '.runtime', 'config.json'), 'utf8').replace(/^\uFEFF/, '')); } catch {}
// The local job queue and growing files cannot be shared across Function instances.
const toolReady = () => !IS_VERCEL && !!config.python && !!config.ffmpeg && existsSync(config.ffmpeg);
const env = () => ({ ...process.env, PYTHONPATH: config.pythonPath || process.env.PYTHONPATH || '', PYTHONIOENCODING: 'utf-8' });
const baseArgs = () => ['-m', 'yt_dlp', '--ignore-config', '--no-plugin-dirs', '--no-remote-components', '--no-cache-dir', '--no-warnings', '--socket-timeout', '12', '--retries', '1', '--extractor-retries', '1', '--js-runtimes', `node:${process.execPath}`];
const sourceURL = id => `https://www.youtube.com/watch?v=${id}`;
const error = (message, status = 502, code = 'SOURCE_ERROR') => Object.assign(new Error(message), { status, code });
const demos = [
  { id: 'demo-focus', title: 'Một khoảng tập trung', channel: 'Lá Play · âm thanh mẫu tự tạo', duration: 32, category: 'Tập trung', color: 'mint', demo: true },
  { id: 'demo-slow', title: 'Chậm lại một nhịp', channel: 'Lá Play · âm thanh mẫu tự tạo', duration: 32, category: 'Thư giãn', color: 'peach', demo: true },
  { id: 'demo-night', title: 'Khi phố đã yên', channel: 'Lá Play · âm thanh mẫu tự tạo', duration: 32, category: 'Buổi tối', color: 'lilac', demo: true },
];

export function parseRange(value, size) {
  if (!value) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!m || (!m[1] && !m[2]) || size < 1) return false;
  let start, end;
  if (!m[1]) { const suffix = Number(m[2]); if (!Number.isSafeInteger(suffix) || suffix < 1) return false; start = Math.max(0, size - suffix); end = size - 1; }
  else { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1; }
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start <= end && start < size ? { start, end } : false;
}

async function sendFile(req, res, file, mime, cacheControl = 'no-cache') {
  let info;
  try { info = await stat(file); } catch { throw error('Không tìm thấy tệp.', 404, 'NOT_FOUND'); }
  const range = parseRange(req.headers.range, info.size);
  const headers = { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Cache-Control': cacheControl, 'X-Content-Type-Options': 'nosniff' };
  if (range === false) { res.writeHead(416, { ...headers, 'Content-Range': `bytes */${info.size}` }); return res.end(); }
  const start = range?.start ?? 0, end = range?.end ?? info.size - 1;
  headers['Content-Length'] = end - start + 1;
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
  res.writeHead(range ? 206 : 200, headers);
  if (req.method === 'HEAD') return res.end();
  const stream = createReadStream(file, { start, end });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(data);
}

async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 2048) throw error('Yêu cầu quá lớn.', 413, 'INVALID_INPUT'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw error('Dữ liệu gửi lên chưa hợp lệ.', 400, 'INVALID_INPUT'); }
}

function requireTools() {
  if (IS_VERCEL) throw error('Chưa kết nối nguồn âm thanh trực tuyến. Bạn vẫn có thể nghe các bài mẫu.', 503, 'AUDIO_BACKEND_REQUIRED');
  if (!toolReady()) throw error('Cần chạy bước thiết lập âm thanh trước. Các bài nghe mẫu vẫn dùng được.', 503, 'SETUP_REQUIRED');
}

function runJSON(args, timeout = 45000) {
  requireTools();
  return new Promise((resolve, reject) => {
    const child = spawn(config.python, [...baseArgs(), ...args], { env: env(), windowsHide: true, shell: false });
    running.add(child); let output = '', diagnostic = '', settled = false;
    const finish = (e, result) => { if (settled) return; settled = true; clearTimeout(timer); running.delete(child); e ? reject(e) : resolve(result); };
    const timer = setTimeout(() => { child.kill(); finish(error('Nguồn YouTube phản hồi quá chậm. Thử lại sau.', 504, 'SOURCE_TIMEOUT')); }, timeout);
    child.stdout.on('data', chunk => { output += chunk.toString(); if (output.length > 8e6) { child.kill(); finish(error('Dữ liệu nguồn quá lớn.')); } });
    child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk.toString()).slice(-4000); });
    child.on('error', () => finish(error('Chưa khởi động được công cụ âm thanh.', 503, 'SETUP_REQUIRED')));
    child.on('close', code => {
      if (settled) return;
      if (code !== 0) { console.warn('[source]', diagnostic.replace(/https?:\/\/\S+/g, '[url]').slice(-900)); return finish(error('YouTube chưa trả được nội dung này. Có thể nguồn đang hạn chế truy cập hoặc công cụ cần cập nhật.', 502, 'SOURCE_UNAVAILABLE')); }
      try { finish(null, JSON.parse(output)); } catch { finish(error('Nguồn trả dữ liệu không hợp lệ.', 502, 'INVALID_SOURCE_RESPONSE')); }
    });
  });
}

function slim(v) {
  return { id: v.id, title: v.title || 'Chưa có tên', channel: v.channel || v.uploader || 'YouTube', duration: Number(v.duration) || 0, thumbnail: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`, color: ['mint', 'peach', 'lilac', 'blue'][Math.abs([...v.id].reduce((n, c) => n + c.charCodeAt(0), 0)) % 4], category: 'YouTube', demo: false };
}
async function info(id) {
  if (metadata.has(id)) return metadata.get(id);
  if (sourceRequests.has(id)) return sourceRequests.get(id);
  const pending = (async () => {
    const v = await runJSON(['--no-playlist', '--skip-download', '--dump-single-json', '--format', 'bestaudio[vcodec=none]', sourceURL(id)]);
    if (v.is_live || v.live_status === 'is_upcoming') throw error('Bản thử chưa hỗ trợ phát trực tiếp.', 422, 'LIVE_UNSUPPORTED');
    if (Number(v.duration) > 10800) throw error('Bản thử hỗ trợ nội dung dài tối đa 3 giờ.', 422, 'DURATION_LIMIT');
    const track = slim(v);
    metadata.set(id, track);
    if (metadata.size > 300) metadata.delete(metadata.keys().next().value);
    return track;
  })();
  sourceRequests.set(id, pending);
  try { return await pending; } finally { sourceRequests.delete(id); }
}
async function recommend(id, title, channel, excluded) {
  const known=metadata.get(id);
  const artist=String(known?.channel||channel||'').replace(/\s*-\s*Topic$/i,'').trim().slice(0,100);
  const words=String(known?.title||title||'').split(/[|\n]/)[0].replace(/\b(official|video|lyrics?|4k|1080p|hd)\b/gi,' ').replace(/[^\p{L}\p{N}\s]/gu,' ').split(/\s+/).filter(Boolean).slice(0,7).join(' ');
  const query=`${artist} ${words}`.trim().slice(0,180);
  if(!query)throw error('Chưa đủ thông tin để tìm bài liên quan.',400,'INVALID_INPUT');
  const key=`${id}:${query}`;
  const load=async()=>{
    const cached=recommendationCache.get(key);
    if(cached&&Date.now()-cached.at<1200000)return cached.tracks;
    const valid=entry=>ID.test(entry?.id||'')&&!entry.is_live&&!['is_live','is_upcoming'].includes(entry.live_status)&&!(Number(entry.duration)>10800);
    const data=await runJSON(['--flat-playlist','--skip-download','--dump-single-json','--playlist-end','20',`ytsearch20:${query}`]);
    let tracks=(data.entries||[]).filter(valid).map(slim);
    if(artist&&query!==artist&&tracks.filter(track=>track.id!==id&&!excluded.includes(track.id)).length<3){
      const fallback=await runJSON(['--flat-playlist','--skip-download','--dump-single-json','--playlist-end','20',`ytsearch20:${artist}`]);
      tracks=[...tracks,...(fallback.entries||[]).filter(valid).map(slim)];
    }
    recommendationCache.set(key,{at:Date.now(),tracks});
    if(recommendationCache.size>60)recommendationCache.delete(recommendationCache.keys().next().value);
    return tracks;
  };
  let pending=recommendationRequests.get(key);
  if(!pending){pending=load().finally(()=>recommendationRequests.delete(key));recommendationRequests.set(key,pending);}
  const tracks=await pending,seen=new Set([id,...excluded]);
  return {tracks:tracks.filter(track=>{if(seen.has(track.id))return false;seen.add(track.id);return true;}).slice(0,12),source:'title_channel_search',note:'Dựa trên tên bài và kênh, không phải gợi ý cá nhân hóa của YouTube.'};
}
const isWorking = job => job && ['queued','preparing','streaming'].includes(job.state);
function publicJob(job) {
  return { id:job.id, state:job.state, track:job.track, url:job.url, seekable:job.state === 'ready', firstAudioMs:job.firstAudioMs, elapsedMs:Date.now() - job.startedAt, error:job.error, code:job.code };
}

async function cleanup() {
  await mkdir(CACHE, { recursive: true });
  const files = await readdir(CACHE);
  const entries = await Promise.all(files.filter(f => /^[\w-]+\.(mp3|part)$/.test(f)).map(async name => ({ name, ...await stat(path.join(CACHE, name)) })));
  let total = entries.reduce((sum, item) => sum + item.size, 0);
  for (const entry of entries.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
    const id = entry.name.replace(/\.(mp3|part)$/, '');
    if (isWorking(jobs.get(id))) continue;
    if (Date.now() - entry.mtimeMs > TTL || total > MAX_CACHE) { await unlink(path.join(CACHE, entry.name)).catch(() => {}); await unlink(path.join(CACHE, `${id}.json`)).catch(() => {}); total -= entry.size; if (jobs.get(id)?.state === 'ready') jobs.delete(id); }
  }
  for (const [id, job] of jobs) if (!isWorking(job) && Date.now() - job.updatedAt > TTL) jobs.delete(id);
}

async function encode(id, job) {
  const partial = path.join(CACHE, `${id}.part`), target = path.join(CACHE, `${id}.mp3`);
  const metadataPath = path.join(CACHE, `${id}.meta`);
  await writeFile(metadataPath,'','utf8');
  await new Promise((resolve, reject) => {
    const template = 'before_dl:{"id":%(id)j,"title":%(title)j,"channel":%(channel,uploader)j,"duration":%(duration)j,"vcodec":%(vcodec)j}';
    const download = spawn(config.python,[...baseArgs(),'--no-playlist','--quiet','--no-progress','--no-simulate','--format','bestaudio[vcodec=none]','--match-filter','!is_live & duration <= 10800','--max-filesize','220M','--fragment-retries','1','--print-to-file',template,metadataPath,'--output','-',sourceURL(id)],{env:env(),windowsHide:true,shell:false});
    const ffmpeg = spawn(config.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-probesize', '65536', '-analyzeduration', '1000000', '-i', 'pipe:0', '-map', '0:a:0', '-vn', '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', '-t', '10800', '-fs', '180000000', '-write_xing', '0', '-flush_packets', '1', '-f', 'mp3', partial], { windowsHide: true, shell: false });
    running.add(download); running.add(ffmpeg);
    let done = false, diagnostic = '', dCode, fCode;
    const stop = e => { if (done) return; done = true; clearTimeout(timer); clearInterval(progress); running.delete(download); running.delete(ffmpeg); if (e) { download.kill(); ffmpeg.kill(); reject(e); } else resolve(); };
    const timer = setTimeout(() => stop(error('Chuẩn bị MP3 quá lâu. Vui lòng thử lại sau.', 504, 'PREPARE_TIMEOUT')), 180000);
    const progress = setInterval(async () => {
      if (done) return;
      if (!job.track) {
        try { const raw = JSON.parse(readFileSync(metadataPath,'utf8')); if(raw.id === id && raw.vcodec === 'none') { job.track = slim(raw); metadata.set(id,job.track); } } catch {}
      }
      if(job.state !== 'preparing') return;
      const output = await stat(partial).catch(() => null);
      if (output?.size >= 8192 && !done) { job.state = 'streaming'; job.url = `/api/audio/${id}.mp3`; job.firstAudioMs = Date.now() - job.startedAt; job.updatedAt = Date.now(); }
    }, 80);
    download.stdout.pipe(ffmpeg.stdin); ffmpeg.stdin.on('error',()=>{});
    ffmpeg.stdout.resume();
    const log = chunk => { diagnostic = (diagnostic + chunk.toString()).slice(-3000); };
    download.stderr.on('data',log); ffmpeg.stderr.on('data',log);
    download.on('error',()=>stop(error('Chưa chạy được công cụ lấy âm thanh.',503,'SETUP_REQUIRED')));
    ffmpeg.on('error', () => stop(error('Chưa chạy được công cụ chuyển MP3.', 503, 'SETUP_REQUIRED')));
    const finish = () => {
      if(dCode === undefined || fCode === undefined) return;
      if (dCode || fCode) { console.warn('[audio]', diagnostic.replace(/https?:\/\/\S+/g, '[url]').slice(-900)); stop(error('Chưa mở được luồng âm thanh. Thử bài khác hoặc thử lại sau.', 502, 'AUDIO_UNAVAILABLE')); }
      else stop();
    };
    download.on('close',code=>{dCode=code??1;finish();});
    ffmpeg.on('close',code=>{fCode=code??1;if(fCode)download.kill();finish();});
  }).catch(async e => { await unlink(partial).catch(() => {}); await unlink(metadataPath).catch(()=>{}); throw e; });
  if ((await stat(partial)).size < 1000) { await unlink(partial).catch(() => {}); throw error('Nguồn âm thanh trống.'); }
  const raw = JSON.parse(readFileSync(metadataPath,'utf8'));
  if(raw.id !== id || raw.vcodec !== 'none') throw error('Nguồn âm thanh không hợp lệ.');
  const track = slim(raw);
  await rename(partial, target);
  await writeFile(path.join(CACHE, `${id}.json`), JSON.stringify(track), 'utf8');
  await unlink(metadataPath).catch(()=>{});
  return track;
}

function drain() {
  while (active < 2) {
    const job = [...jobs.values()].find(item => item.state === 'queued');
    if (!job) break;
    active++; job.state = 'preparing'; job.updatedAt = Date.now();
    encode(job.id, job).then(track => Object.assign(job, { state: 'ready', track, url: `/api/audio/${job.id}.mp3`, firstAudioMs:job.firstAudioMs ?? Date.now() - job.startedAt })).catch(e => Object.assign(job, { state: 'error', error: e.message, code: e.code || 'AUDIO_ERROR' })).finally(() => { job.updatedAt = Date.now(); active--; drain(); cleanup().catch(console.error); });
  }
}

function privateIPv4(address) {
  if (!isIPv4(address)) return false;
  const [a, b] = address.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
const ipv4Number = address => address.split('.').reduce((value, byte) => (value << 8) | Number(byte), 0) >>> 0;
export function isAllowedClient(remote, lanAddress, prefix = 24) {
  const address = (remote || '').replace(/^::ffff:/, '');
  if (address === '127.0.0.1' || address === '::1') return true;
  if (!privateIPv4(lanAddress || '') || !isIPv4(address) || !Number.isInteger(prefix) || prefix < 8 || prefix > 32) return false;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4Number(address) & mask) === (ipv4Number(lanAddress) & mask);
}

export function createApp({ lanAddress = null, lanPrefix = 24, vercel = false } = {}) {
  if (vercel && !IS_VERCEL) throw new Error('Vercel mode requires the Vercel runtime.');
  if (lanAddress && !privateIPv4(lanAddress)) throw new Error('LAN address must be a private IPv4 address.');
  const allowedHosts = new Set(['127.0.0.1', 'localhost', ...(lanAddress ? [lanAddress] : [])]);
  const publicHosts = new Set((process.env.LA_PUBLIC_HOSTS || '').split(',').map(host => host.trim().toLowerCase()).filter(Boolean));
  return http.createServer(async (req, res) => {
    try {
      const host = req.headers.host || '';
      let hostname;
      try { hostname = new URL(`http://${host}`).hostname; } catch {}
      if (vercel) {
        if (!hostname || !(/^[a-z0-9-]+\.vercel\.app$/i.test(hostname) || publicHosts.has(hostname))) throw error('Tên miền chưa được cấu hình.', 403, 'HOST_REJECTED');
      } else if (!allowedHosts.has(hostname) || !isAllowedClient(req.socket.remoteAddress, lanAddress, lanPrefix)) throw error('Bản thử chỉ phục vụ trên máy này hoặc mạng LAN đã chọn.', 403, 'LOCAL_ONLY');
      if (req.headers.origin && req.headers.origin !== `${vercel ? 'https' : 'http'}://${host}`) throw error('Yêu cầu không cùng nguồn.', 403, 'ORIGIN_REJECTED');
      const url = new URL(req.url, `http://${host}`), p = url.pathname;
      if (req.method === 'GET' && p === '/api/health') return json(res, 200, { ok: true, toolsReady: toolReady(), audioOnly: true, format: 'mp3', localOnly: !vercel && !lanAddress, lanEnabled: !!lanAddress, deployment: vercel ? 'vercel' : 'local' });
      if (req.method === 'GET' && p === '/api/library') return json(res, 200, { tracks: demos });
      const recommendation=/^\/api\/recommendations\/([\w-]{11})$/.exec(p);
      if(req.method==='GET'&&recommendation){
        const title=(url.searchParams.get('title')||'').slice(0,180),channel=(url.searchParams.get('channel')||'').slice(0,100);
        const excluded=(url.searchParams.get('exclude')||'').split(',').filter(id=>ID.test(id)).slice(0,100);
        return json(res,200,await recommend(recommendation[1],title,channel,excluded));
      }
      if (req.method === 'GET' && p === '/api/search') {
        const q = (url.searchParams.get('q') || '').trim();
        if (!q || q.length > 180) throw error('Nhập từ khóa hoặc một link YouTube.', 400, 'INVALID_INPUT');
        if (searches.has(q) && Date.now() - searches.get(q).at < 600000) return json(res, 200, searches.get(q).result);
        if (active >= 2) throw error('Đang chuẩn bị âm thanh. Bạn thử tìm lại sau một chút.', 429, 'BUSY');
        let id = ID.test(q) ? q : null;
        if (/^https?:\/\//i.test(q)) {
          let link; try { link = new URL(q); } catch {}
          if (!link || !['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(link.hostname)) throw error('Chỉ nhận link YouTube hoặc từ khóa tìm kiếm.', 400, 'INVALID_INPUT');
          id = link.hostname === 'youtu.be' ? link.pathname.slice(1) : link.searchParams.get('v') || link.pathname.match(/^\/(?:shorts|embed)\/([^/]+)/)?.[1];
          if (!ID.test(id || '')) throw error('Link chưa có mã video hợp lệ.', 400, 'INVALID_INPUT');
        }
        const tracks = id ? [await info(id)] : (await runJSON(['--flat-playlist', '--skip-download', '--dump-single-json', '--playlist-end', '10', `ytsearch10:${q}`])).entries?.filter(v => ID.test(v.id) && !v.is_live).map(slim) || [];
        const result = { tracks }; searches.set(q, { at: Date.now(), result }); if (searches.size > 30) searches.delete(searches.keys().next().value);
        return json(res, 200, result);
      }
      if (req.method === 'POST' && p === '/api/prepare') {
        const { id } = await body(req);
        const demo = demos.find(t => t.id === id);
        if (demo) return json(res, 200, { id, state: 'ready', track: demo, url: `/audio/${id}.mp3`, seekable:true });
        if (!ID.test(id || '')) throw error('Mã nội dung không hợp lệ.', 400, 'INVALID_INPUT');
        if (IS_VERCEL) requireTools();
        if (existsSync(path.join(CACHE, `${id}.mp3`))) {
          let track = metadata.get(id);
          if (!track) try { track = JSON.parse(readFileSync(path.join(CACHE, `${id}.json`), 'utf8')); } catch {}
          return json(res, 200, { id, state:'ready', track, url:`/api/audio/${id}.mp3`, seekable:true, firstAudioMs:0 });
        }
        requireTools();
        let job = jobs.get(id);
        if (!job || job.state === 'error' || job.state === 'ready') {
          if ([...jobs.values()].filter(isWorking).length >= 5) throw error('Hàng chuẩn bị đang đầy. Thử lại sau.', 429, 'BUSY');
          job = { id, state:'queued', stage:'resolving', startedAt:Date.now(), updatedAt:Date.now(), partialPath:path.join(CACHE,`${id}.part`), finalPath:path.join(CACHE,`${id}.mp3`) }; jobs.set(id, job); drain();
        }
        return json(res, 202, publicJob(job));
      }
      if (req.method === 'GET' && p.startsWith('/api/jobs/')) { const job = jobs.get(p.slice(10)); if (!job) throw error('Phiên chuẩn bị đã hết hạn. Hãy bấm phát lại.', 404, 'NOT_FOUND'); return json(res, 200, publicJob(job)); }
      const media = /^\/api\/audio\/([\w-]{11})\.mp3$/.exec(p);
      if (['GET', 'HEAD'].includes(req.method) && media) {
        const job = jobs.get(media[1]);
        if (job && ['preparing','streaming'].includes(job.state)) return await serveGrowingMP3(req,res,job);
        return await sendFile(req, res, path.join(CACHE, `${media[1]}.mp3`), 'audio/mpeg', 'private, max-age=300');
      }
      if (p.startsWith('/api/')) throw error('Không có chức năng này.', 404, 'NOT_FOUND');
      if (!['GET', 'HEAD'].includes(req.method)) throw error('Phương thức chưa được hỗ trợ.', 405, 'METHOD_NOT_ALLOWED');
      const rel = decodeURIComponent(p === '/' ? '/index.html' : p);
      const file = path.resolve(DIST, '.' + rel);
      if (!file.startsWith(DIST + path.sep) || rel.includes('\\') || rel.split('/').some(part => part.startsWith('.'))) throw error('Không tìm thấy tệp.', 404, 'NOT_FOUND');
      const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg' }[path.extname(file)];
      if (!mime) throw error('Không tìm thấy tệp.', 404, 'NOT_FOUND');
      await sendFile(req, res, file, mime);
    } catch (e) { if (!res.headersSent) json(res, e.status || 500, { error: e.status ? e.message : 'Có lỗi trên máy chủ. Vui lòng thử lại.', code: e.code || 'INTERNAL_ERROR' }); else res.destroy(); }
  });
}

// Vercel imports this entrypoint; it does not run the local command below.
// Export an unbound server, with no cache writes, timers or child processes on import.
export default createApp({ vercel: IS_VERCEL });

if (!IS_VERCEL && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await cleanup();
  let lanAddress = null, lanPrefix = 24;
  if (process.env.LA_LAN === '1') {
    const lan = JSON.parse(readFileSync(path.join(ROOT, '.runtime', 'lan.json'), 'utf8').replace(/^\uFEFF/, ''));
    const connected = networkInterfaces()[lan.interface]?.some(item => item.family === 'IPv4' && item.address === lan.address && !item.internal);
    if (!connected || !privateIPv4(lan.address) || !Number.isInteger(lan.prefixLength) || lan.prefixLength < 8 || lan.prefixLength > 32) throw new Error('Địa chỉ LAN đã đổi. Hãy chạy lại start-lan.cmd.');
    lanAddress = lan.address; lanPrefix = lan.prefixLength;
  }
  const app = createApp({ lanAddress, lanPrefix }), port = Number(process.env.PORT || 4217);
  app.listen(port, lanAddress ? '0.0.0.0' : '127.0.0.1', () => console.log(`Lá Play: http://127.0.0.1:${port}${lanAddress ? `\nĐiện thoại cùng Wi-Fi: http://${lanAddress}:${port}` : '\nChỉ chạy trên máy này.'}\nDừng bằng stop.cmd hoặc Ctrl+C.`));
  app.on('error', e => { console.error(e.code === 'EADDRINUSE' ? 'Cổng đang được dùng. Chọn PORT khác hoặc tắt phiên cũ.' : e.message); process.exitCode = 1; });
  const timer = setInterval(() => cleanup().catch(console.error), 600000); timer.unref();
  const stop = () => { clearInterval(timer); for (const child of running) child.kill(); app.close(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
