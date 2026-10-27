// One request carries progress and the final MP3; local/LAN can return JSON jobs.
export async function readPreparedAudio(response, onProgress = () => {}) {
  if (!response.headers.get('content-type')?.includes('application/x-ndjson')) {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Chưa mở được âm thanh.');
    return data;
  }
  if (!response.ok || !response.body) throw new Error('Máy chủ âm thanh chưa phản hồi.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let pending = '';
  const parse = line => {
    if (!line.trim()) return;
    const value = JSON.parse(line);
    if (value.type === 'error') throw new Error(value.error || 'Chưa mở được âm thanh.');
    if (value.type === 'progress') onProgress(value.message);
    if (value.type === 'ready') return value;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      if (pending.length > 65536) throw new Error('Máy chủ trả dữ liệu không hợp lệ.');
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
        const ready = parse(line); if (ready) return ready;
      }
      if (done) { const ready = parse(pending); if (ready) return ready; break; }
    }
    throw new Error('Kết nối bị ngắt khi đang mở âm thanh. Hãy bấm Phát để thử lại.');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
