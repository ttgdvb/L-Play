import { createReadStream, existsSync } from 'node:fs';
import { mkdtemp, readFile, stat, unlink, rmdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { head, put, list, del, issueSignedToken, presignUrl, BlobNotFoundError } from '@vercel/blob';

const ID = /^[a-zA-Z0-9_-]{11}$/;
const PREFIX = 'laplay/mp3/v2/';
const MAX_FILE = 180000000;
const MAX_STORE = 512 * 1024 * 1024;
const RETAIN_MS = 6 * 60 * 60 * 1000;
const fail = (message, status = 502, code = 'AUDIO_UNAVAILABLE') => Object.assign(new Error(message), { status, code });

export function createBlobAudioStore() {
  const playbackURL = async (id, signal) => {
    const pathname = `${PREFIX}${id}.mp3`, validUntil = Date.now() + 4 * 60 * 60 * 1000;
    const token = await issueSignedToken({ pathname, operations: ['get'], validUntil, abortSignal: signal });
    return (await presignUrl(token, { operation: 'get', pathname, access: 'private', validUntil })).presignedUrl;
  };
  return {
    ready: () => !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID),
    async find(id, signal) {
      try {
        const result = await head(`${PREFIX}${id}.mp3`, { abortSignal: signal });
        return { url: await playbackURL(id, signal), bytes: result.size };
      } catch (e) {
        if (e instanceof BlobNotFoundError) return null;
        if (signal?.aborted) throw signal.reason;
        throw fail('Kho âm thanh chưa phản hồi. Hãy thử lại sau.', 503, 'STORAGE_UNAVAILABLE');
      }
    },
    async save(id, file, signal, onProgress) {
      const size = (await stat(file)).size;
      if (size > MAX_FILE) throw fail('Tệp âm thanh vượt giới hạn của bản thử.', 422, 'SIZE_LIMIT');
      // Only this application's old cache is eligible for deletion. Recent tracks
      // are retained longer than the maximum supported playback duration.
      const stored = await list({ prefix: PREFIX, limit: 1000, abortSignal: signal });
      let total = stored.blobs.reduce((sum, blob) => sum + blob.size, 0);
      for (const blob of [...stored.blobs].sort((a, b) => +a.uploadedAt - +b.uploadedAt)) {
        if (total + size <= MAX_STORE) break;
        if (Date.now() - +blob.uploadedAt < RETAIN_MS) continue;
        await del(blob.url, { abortSignal: signal }); total -= blob.size;
      }
      if (stored.hasMore || total + size > MAX_STORE) throw fail('Bộ nhớ âm thanh đang đầy. Bạn vẫn có thể nghe các bài đã chuẩn bị.', 507, 'CACHE_FULL');
      try {
        const blob = await put(`${PREFIX}${id}.mp3`, createReadStream(file), {
          access: 'private', contentType: 'audio/mpeg', addRandomSuffix: false,
          allowOverwrite: false, cacheControlMaxAge: 86400, multipart: size > 5 * 1024 * 1024,
          maximumSizeInBytes: MAX_FILE, abortSignal: signal, onUploadProgress: onProgress,
        });
        return { url: await playbackURL(id, signal), bytes: size };
      } catch (e) {
        if (signal?.aborted) throw signal.reason;
        // Concurrent instances may have finished the same track first. Reuse
        // that complete object instead of relying on an in-process job map.
        const winner = await this.find(id, signal).catch(() => null);
        if (winner) return winner;
        throw fail('Chưa lưu được âm thanh. Hãy thử lại sau.', 503, 'STORAGE_UNAVAILABLE');
      }
    },
  };
}

export function createCloudAudio({ python, ffmpeg, pythonPath, store = createBlobAudioStore(), timeoutMs = 210000, maxActive = 2 } = {}) {
  let active = 0;
  const toolsReady = () => !!python && !!ffmpeg && existsSync(python) && existsSync(ffmpeg);
  const ready = () => toolsReady() && store.ready();
  async function prepare(id, { signal, onProgress = () => {} } = {}) {
    if (!ID.test(id || '')) throw fail('Mã nội dung không hợp lệ.', 400, 'INVALID_INPUT');
    if (!store.ready()) throw fail('Chưa kết nối kho âm thanh của ứng dụng.', 503, 'STORAGE_REQUIRED');
    signal?.throwIfAborted();
    onProgress('Đang kiểm tra âm thanh đã lưu…');
    const cached = await store.find(id, signal);
    if (cached) return { id, state: 'ready', url: cached.url, seekable: true, cached: true };
    if (!toolsReady()) throw fail('Máy chủ chưa có đủ công cụ âm thanh.', 503, 'SETUP_REQUIRED');
    if (active >= maxActive) throw fail('Máy chủ đang chuẩn bị các bài khác. Hãy thử lại sau một chút.', 429, 'BUSY');
    active++;
    let directory;
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const deadline = setTimeout(() => controller.abort(fail('Nguồn phản hồi quá lâu. Hãy thử bài khác hoặc thử lại sau.', 504, 'PREPARE_TIMEOUT')), timeoutMs);
    try {
      directory = await mkdtemp(path.join(tmpdir(), 'laplay-audio-'));
      const file = path.join(directory, 'audio.mp3'), meta = path.join(directory, 'metadata.json');
      onProgress('Đang kết nối nguồn âm thanh…');
      await encode(id, file, meta, controller.signal, onProgress);
      const raw = JSON.parse(await readFile(meta, 'utf8'));
      if (raw.id !== id || raw.vcodec !== 'none' || Number(raw.duration) > 10800) throw fail('Nguồn âm thanh không hợp lệ.', 422, 'INVALID_SOURCE');
      const size = (await stat(file)).size;
      if (size < 1000 || size >= MAX_FILE) throw fail('Tệp âm thanh trống hoặc vượt giới hạn.', 422, 'SIZE_LIMIT');
      controller.signal.throwIfAborted();
      onProgress('Đang hoàn tất âm thanh…');
      const audio = await store.save(id, file, controller.signal, progress => onProgress(`Đang hoàn tất âm thanh… ${Math.round(progress.percentage)}%`));
      return { id, state: 'ready', url: audio.url, seekable: true, cached: false, track: {
        id, title: raw.title || 'Chưa có tên', channel: raw.channel || 'YouTube', duration: Number(raw.duration) || 0,
        thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, color: 'mint', category: 'YouTube', demo: false,
      } };
    } finally {
      clearTimeout(deadline); signal?.removeEventListener('abort', abort); active--;
      if (directory) {
        await unlink(path.join(directory, 'audio.mp3')).catch(() => {});
        await unlink(path.join(directory, 'metadata.json')).catch(() => {});
        await rmdir(directory).catch(() => {});
      }
    }
  }

  async function encode(id, file, meta, signal, onProgress) {
    signal.throwIfAborted();
    const template = 'before_dl:{"id":%(id)j,"title":%(title)j,"channel":%(channel,uploader)j,"duration":%(duration)j,"vcodec":%(vcodec)j}';
    const download = spawn(python, ['-m', 'yt_dlp', '--ignore-config', '--no-plugin-dirs', '--no-remote-components', '--no-cache-dir', '--no-warnings',
      '--socket-timeout', '12', '--retries', '1', '--extractor-retries', '1', '--js-runtimes', `node:${process.execPath}`,
      '--no-playlist', '--quiet', '--no-progress', '--no-simulate', '--format', 'bestaudio[vcodec=none]',
      '--match-filter', '!is_live & duration <= 10800', '--max-filesize', '220M', '--fragment-retries', '1',
      '--print-to-file', template, meta, '--output', '-', `https://www.youtube.com/watch?v=${id}`,
    ], { env: { ...process.env, PYTHONPATH: pythonPath || process.env.PYTHONPATH || '', PYTHONIOENCODING: 'utf-8' }, windowsHide: true, shell: false });
    const convert = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', 'pipe:0', '-map', '0:a:0', '-vn',
      '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', '-t', '10800', '-fs', String(MAX_FILE), '-f', 'mp3', file,
    ], { windowsHide: true, shell: false });
    download.stdout.pipe(convert.stdin); convert.stdin.on('error', () => {}); convert.stdout.resume();
    let diagnostic = '', previousMessage = '', tick = 0;
    const progress = setInterval(async () => {
      tick++;
      const size = (await stat(file).catch(() => null))?.size || 0;
      const message = size > 1000 ? 'Đang chuẩn bị MP3…' : 'Đang kết nối nguồn âm thanh…';
      if (message !== previousMessage || tick % 10 === 0) { previousMessage = message; onProgress(message); }
    }, 1000);
    try {
      await new Promise((resolve, reject) => {
        let downloadCode, convertCode, failure;
        const stop = reason => { failure ||= reason; download.kill(); convert.kill(); };
        const abort = () => stop(signal.reason || fail('Đã hủy mở bài.', 499, 'ABORTED'));
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        const finish = () => {
          if (downloadCode === undefined || convertCode === undefined) return;
          signal.removeEventListener('abort', abort);
          if (failure) return reject(failure);
          if (downloadCode || convertCode) {
            const blocked = /sign in|not a bot|captcha|HTTP Error (403|429)|private video|not available|age.restricted/i.test(diagnostic);
            console.warn('[cloud-audio]', diagnostic.replace(/https?:\/\/\S+/g, '[url]').slice(-1200));
            return reject(fail(blocked ? 'YouTube đang từ chối truy cập nội dung này từ máy chủ. Hãy thử bài khác.' : 'Chưa lấy được âm thanh. Hãy thử bài khác hoặc thử lại sau.', 502, blocked ? 'SOURCE_BLOCKED' : 'AUDIO_UNAVAILABLE'));
          }
          resolve();
        };
        const log = chunk => { diagnostic = (diagnostic + chunk.toString()).slice(-5000); };
        download.stderr.on('data', log); convert.stderr.on('data', log);
        download.on('error', () => stop(fail('Chưa chạy được công cụ lấy âm thanh.', 503, 'SETUP_REQUIRED')));
        convert.on('error', () => stop(fail('Chưa chạy được công cụ chuyển MP3.', 503, 'SETUP_REQUIRED')));
        download.on('close', code => { downloadCode = code ?? 1; if (downloadCode) convert.kill(); finish(); });
        convert.on('close', code => { convertCode = code ?? 1; if (convertCode) download.kill(); finish(); });
      });
    } finally { clearInterval(progress); }
  }
  return { prepare, ready, toolsReady };
}
