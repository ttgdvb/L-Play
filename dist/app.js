import { PlaybackOrder } from './playback-order.js';
import { readPreparedAudio } from './prepare-audio.js';
const $ = s => document.querySelector(s);
const icon = name => `<svg aria-hidden="true"><use href="#${name}"/></svg>`;
const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem('la:' + key)) ?? fallback; } catch { return fallback; } };
const write = (key, value) => { try { localStorage.setItem('la:' + key, JSON.stringify(value)); } catch {} };
const audio = $('#audio');
let catalog = [], results = [], queue = read('queue', []), saved = read('saved', []), recent = read('history', []), positions = read('positions', {});
let current = null, view = 'home', category = 'all', preparing = false, token = 0, searchToken = 0, sleepAt = 0, sleepTimer, toastTimer, lastSaved = 0, loadedId = null;
let streamingSource = false, cacheReady = true;
let prepareController;
let onlineHome = location.protocol === 'https:' && !['localhost','127.0.0.1'].includes(location.hostname);
const order = new PlaybackOrder();
let recommendations = [], recommendationFor = '', recommendationState = 'idle', recommendationPromise = null, recommendationToken = 0;
let autoplaySuggestions = !!read('autoplaySuggestions',true);
const mediaDuration = () => Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : current?.duration || 0;
const fmt = seconds => { const s = Math.max(0, Math.floor(Number(seconds) || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const toast = msg => { clearTimeout(toastTimer); $('#toast').textContent = msg; $('#toast').classList.add('visible'); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 2800); };
async function api(url, options) { const r = await fetch(url, options); let d; try { d = await r.json(); } catch { throw new Error('Máy chủ trả dữ liệu không hợp lệ.'); } if (!r.ok) throw new Error(d.error || 'Chưa thực hiện được. Thử lại sau.'); return d; }
const isSaved = id => saved.some(t => t.id === id);
const persistQueue = () => { write('queue', queue); renderQueue(); };
const trackById = id => [current, ...catalog, ...results, ...queue, ...saved, ...recent, ...recommendations, ...order.items, ...order.back.map(entry=>entry.track), ...order.forward.map(entry=>entry.track)].find(t => t?.id === id);
const visibleTracks = () => view === 'home' ? catalog.filter(track=>category==='all'||track.category===category) : view === 'queue' ? queue : view === 'saved' ? saved : view === 'history' ? recent : view === 'listening' ? order.items : view === 'suggestions' ? recommendations : results;
function setMessage(message, error = false) { $('#searchMessage').hidden = !message; $('#searchMessage').textContent = message; $('#searchMessage').classList.toggle('error', error); }
function artwork(track) { return track && !track.demo && /^[\w-]{11}$/.test(track.id) ? `https://i.ytimg.com/vi/${track.id}/hqdefault.jpg` : ''; }
function coverImage(track, lazy = true) { const src = artwork(track); return src ? `<img class="cover-art" src="${src}" alt="" width="480" height="360" decoding="async" ${lazy ? 'loading="lazy"' : 'fetchpriority="high"'} referrerpolicy="no-referrer">` : ''; }
function cover(track, small = false, context = '') { const color = ['mint','peach','lilac','blue'].includes(track.color) ? track.color : 'mint'; return small ? `<span class="queue-art ${color}">${icon('music')}${coverImage(track)}</span>` : `<button class="cover ${color} ${artwork(track) ? 'youtube-cover' : ''}" data-play="${esc(track.id)}" data-context="${context}" aria-label="Phát ${esc(track.title)}"><span class="cover-disc"></span>${coverImage(track)}<span class="cover-tag">${track.demo ? 'LÁ SESSIONS' : 'YOUTUBE · AUDIO'}</span><span class="duration-label">${fmt(track.duration)}</span><span class="cover-play">${icon('play')}</span></button>`; }
document.addEventListener('load', e => { if(e.target.matches?.('img.cover-art')) e.target.parentElement.classList.add('has-art'); }, true);
document.addEventListener('error', e => { if(e.target.matches?.('img.cover-art')) { e.target.parentElement.classList.remove('has-art'); e.target.remove(); } }, true);
function card(track,context='') { return `<article class="track-card ${current?.id===track.id?'is-current':''}" data-track-id="${esc(track.id)}">${cover(track,false,context)}<h3 title="${esc(track.title)}">${esc(track.title)}</h3><p>${esc(track.channel)}</p><div class="card-actions"><span>${track.demo ? 'Âm thanh mẫu' : 'Chỉ âm thanh · MP3'}</span><div><button class="card-action ${isSaved(track.id) ? 'is-saved' : ''}" data-save="${esc(track.id)}" aria-label="${isSaved(track.id) ? 'Bỏ lưu' : 'Lưu'} ${esc(track.title)}">${icon('heart')}</button>${view==='queue'&&!context?`<button class="card-action" data-remove="${esc(track.id)}" aria-label="Bỏ ${esc(track.title)} khỏi hàng đợi">${icon('close')}</button>`:`<button class="card-action" data-add="${esc(track.id)}" aria-label="Thêm ${esc(track.title)} vào hàng đợi">${icon('plus')}</button>`}</div></div></article>`; }
function render() {
  const labels = { home: ['DÀNH CHO HÔM NAY','Chọn một nhịp của bạn'], queue: ['NGHE LIỀN MẠCH','Hàng đợi của bạn'], saved: ['GIỮ LẠI ĐIỀU HAY','Những bài đã lưu'], history: ['TRỞ LẠI MỘT NHỊP QUEN','Bạn vừa nghe'], search: ['TỪ YOUTUBE','Kết quả tìm kiếm'], listening:['PHÁT THEO THỨ TỰ','Danh sách đang nghe'], suggestions:['LIÊN QUAN ĐẾN BÀI ĐANG NGHE','Gợi ý nghe tiếp'] };
  $('#hero').hidden = view !== 'home'; $('#filters').hidden = view !== 'home' || onlineHome; $('#sourceNote').hidden = view !== 'home';
  $('#sectionKicker').textContent = labels[view][0]; $('#sectionTitle').textContent = labels[view][1];
  const list = visibleTracks();
  $('#resultCount').textContent = `${list.length} bài`;
  const empty = { queue:'Hàng đợi đang trống. Khi nghe từ tìm kiếm, nút Tiếp theo vẫn phát tiếp theo danh sách đó.', saved:'Bấm trái tim để lưu những bài bạn thích.', history:'Những bài bạn đã nghe sẽ xuất hiện ở đây.', search:'Chưa có kết quả. Thử từ khóa khác hoặc dán link YouTube.', home:'Chưa có bài trong mục này.',listening:'Chọn một bài để bắt đầu danh sách đang nghe.',suggestions:'Chưa có bài gợi ý phù hợp. Bạn có thể chọn thêm bài từ tìm kiếm.' };
  $('#tracks').innerHTML = list.length ? list.map(track=>card(track,view==='suggestions'?'recommendation':'')).join('') : `<div class="empty-state">${icon(view === 'saved' ? 'heart' : 'music')}${empty[view]}</div>`;
  document.querySelectorAll('[data-view]').forEach(b => { b.classList.toggle('active', b.dataset.view === view); b.setAttribute('aria-current', b.dataset.view === view ? 'page' : 'false'); });
  $('#savedCount').textContent = saved.length; updateSaveButton(); renderQueue(); renderRecommendations();
}
function changeView(next) { view = next; setMessage(''); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
function renderQueue() {
  const upcoming=order.upcoming(queue,recommendations);
  $('#queueCount').textContent=queue.length;$('#nextCount').textContent=`${upcoming.length} bài`;
  $('#queuePreview').innerHTML=upcoming.slice(0,3).map(entry=>{const t=entry.track;return `<div class="queue-row"><button class="queue-pick" data-play="${esc(t.id)}" data-context="upcoming" aria-label="Phát ${esc(t.title)}">${cover(t,true)}<span class="queue-meta"><strong>${esc(t.title)}</strong><span>${fmt(t.duration)} · ${entry.kind==='queue'?'Bạn đã thêm':entry.origin==='recommendation'?'Gợi ý':'Danh sách đang nghe'}</span></span></button>${entry.kind==='queue'?`<button data-remove="${esc(t.id)}" aria-label="Bỏ ${esc(t.title)} khỏi hàng đợi">${icon('close')}</button>`:''}</div>`;}).join('')||'<p class="search-message">Chọn bài để bắt đầu. Nút Tiếp theo sẽ đi theo danh sách bạn đang nghe.</p>';
  $('#openQueue').innerHTML=(queue.length?'Mở hàng đợi':order.pick([],[])?'Danh sách đang nghe':recommendations.length?'Xem bài gợi ý':'Danh sách đang nghe')+' '+icon('arrow');
}
function renderRecommendations(){
  $('#recommendationSection').hidden=!current||current.demo||view==='suggestions';
  $('#autoplaySuggestions').setAttribute('aria-checked',String(autoplaySuggestions));$('#autoplaySuggestions').classList.toggle('on',autoplaySuggestions);
  $('#recommendationNote').textContent=recommendationState==='loading'?'Đang tìm bài liên quan…':recommendationState==='error'?'Tạm chưa tải được gợi ý. Bạn vẫn có thể nghe tiếp danh sách đã chọn.':recommendationState==='ready'&&!recommendations.length?'Chưa tìm thấy thêm bài phù hợp.':'Gợi ý dựa trên tên bài và kênh.';
  $('#recommendationTracks').innerHTML=recommendations.slice(0,6).map(track=>card(track,'recommendation')).join('');
}
function resetRecommendations(id){if(recommendationFor===id)return;recommendationFor=id;recommendations=[];recommendationState='idle';recommendationPromise=null;recommendationToken++;}
async function ensureRecommendations(track){
  if(!track||track.demo)return [];
  if(recommendationFor===track.id&&recommendationPromise)return recommendationPromise;
  if(recommendationFor===track.id&&recommendationState==='ready')return recommendations;
  resetRecommendations(track.id);const request=++recommendationToken;recommendationState='loading';renderRecommendations();
  const excluded=[...new Set([track.id,...order.items.map(t=>t.id),...recent.map(t=>t.id),...queue.map(t=>t.id),...order.visited])].slice(0,100);
  const params=new URLSearchParams({title:track.title||'',channel:track.channel||'',exclude:excluded.join(',')});
  recommendationPromise=api(`/api/recommendations/${encodeURIComponent(track.id)}?${params}`).then(data=>{
    if(request!==recommendationToken||current?.id!==track.id)return [];
    recommendations=data.tracks;recommendationState='ready';renderRecommendations();renderQueue();if(view==='suggestions')render();return recommendations;
  }).catch(()=>{if(request===recommendationToken){recommendationState='error';renderRecommendations();}return [];}).finally(()=>{if(request===recommendationToken)recommendationPromise=null;});
  return recommendationPromise;
}
function updateSaveButton() { $('#saveCurrent').disabled = !current; $('#saveCurrent').classList.toggle('is-saved', !!current && isSaved(current.id)); $('#saveCurrent').setAttribute('aria-label', current && isSaved(current.id) ? 'Bỏ lưu bài đang phát' : 'Lưu bài đang phát'); }
function toggleSave(track) { if (!track) return; const found = isSaved(track.id); saved = found ? saved.filter(t => t.id !== track.id) : [track, ...saved].slice(0,200); write('saved', saved); render(); toast(found ? 'Đã bỏ lưu bài' : 'Đã lưu vào thư viện của bạn'); }
function setCurrent(track) { current = track;order.update(track); $('#nowTitle').textContent = track.title; $('#nowChannel').textContent = track.channel; $('#miniCover').className = `mini-cover ${['mint','peach','lilac','blue'].includes(track.color) ? track.color : 'mint'}`; $('#miniCover').innerHTML = icon('music') + coverImage(track,false); $('#duration').textContent = fmt(track.duration);document.querySelectorAll('[data-track-id]').forEach(card=>card.classList.toggle('is-current',card.dataset.trackId===track.id));updateSaveButton();renderQueue();renderRecommendations(); if ('mediaSession' in navigator && 'MediaMetadata' in window) navigator.mediaSession.metadata = new MediaMetadata({ title:track.title, artist:track.channel, album:'Lá Play', artwork:artwork(track) ? [{ src:artwork(track),sizes:'480x360',type:'image/jpeg' }] : [] }); }
function updateTransport() { $('#playButton').innerHTML = icon(audio.paused ? 'play' : 'pause'); $('#playButton').setAttribute('aria-label', audio.paused ? 'Phát' : 'Tạm dừng'); $('#playButton').classList.toggle('loading', preparing); if ('mediaSession' in navigator) navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing'; }
function savePosition() { if (!current || loadedId !== current.id) return; positions[current.id] = { at:Date.now(), position:audio.currentTime || 0 }; positions = Object.fromEntries(Object.entries(positions).sort((a,b)=>b[1].at-a[1].at).slice(0,100)); write('positions', positions); }
async function play(track,{keepOrder=false,fromStart=false,list=null,origin='list'}={}) {
  if (!track) return;
  if(!keepOrder)order.start(track,list||visibleTracks(),origin);
  resetRecommendations(track.id);
  prepareController?.abort(); prepareController = new AbortController();
  savePosition(); const myToken = ++token; preparing = true; cacheReady = false; streamingSource = false; audio.pause(); audio.removeAttribute('src'); audio.load(); loadedId = null; setCurrent(track); $('#seek').disabled = true; $('#elapsed').textContent = '0:00'; $('#seek').value = 0; $('#seek').style.setProperty('--progress','0%'); $('#playStatus').textContent = 'Đang mở âm thanh…'; updateTransport();
  try {
    const response = await fetch('/api/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' }, body: JSON.stringify({ id: track.id }), signal: prepareController.signal });
    let job = await readPreparedAudio(response, message => { if (myToken === token) $('#playStatus').textContent = message; });
    const previous = positions[track.id]?.position || 0;
    const resume = !fromStart && previous > 5 && previous < (track.duration || Infinity)-4 ? previous : 0;
    const deadline = Date.now() + 230000;
    while (job.state !== 'ready' && job.state !== 'error' && !(job.state === 'streaming' && !resume)) { if (myToken !== token) return; if (Date.now() > deadline) throw new Error('Nguồn phản hồi lâu hơn dự kiến. Hãy bấm Phát để thử lại.'); $('#playStatus').textContent = job.state === 'queued' ? 'Đang chờ mở âm thanh…' : resume && job.state === 'streaming' ? 'Đang mở vị trí nghe tiếp…' : 'Đang kết nối nguồn âm thanh…'; await new Promise(r=>setTimeout(r,250)); if (myToken !== token) return; job = await api(`/api/jobs/${encodeURIComponent(track.id)}`); }
    if (myToken !== token) return;
    if (job.state === 'error') throw new Error(job.error);
    if (job.track) setCurrent(job.track);
    loadedId = track.id; streamingSource = job.state === 'streaming'; cacheReady = !streamingSource; audio.src = job.url; audio.playbackRate = Number(read('speed',1)); audio.load();
    if (resume) audio.currentTime = resume;
    queue = queue.filter(t => t.id !== track.id); persistQueue(); preparing = false;
    try { await audio.play(); $('#playStatus').textContent = ''; } catch (e) { if (e.name === 'NotAllowedError') $('#playStatus').textContent = 'Nhấn nút Phát để bắt đầu nghe.'; else throw e; }
    updateTransport(); if (view === 'queue') render();
    if (streamingSource) watchCache(track.id,myToken);
  } catch(e) { if (myToken !== token) return; preparing = false; $('#playStatus').textContent = e.message; updateTransport(); toast(e.message); }
}
async function watchCache(id,myToken) {
  while(myToken === token && loadedId === id && !cacheReady) {
    await new Promise(resolve=>setTimeout(resolve,1500));
    if(myToken !== token || loadedId !== id) return;
    try {
      const job = await api(`/api/jobs/${encodeURIComponent(id)}`);
      if(myToken !== token || loadedId !== id) return;
      if(job.state === 'ready') { cacheReady = true; $('#seek').disabled = false; return; }
      if(job.state === 'error') { $('#playStatus').textContent = job.error || 'Nguồn âm thanh bị gián đoạn.'; return; }
    } catch { return; }
  }
}
function seekTo(position) {
  if(!loadedId) return;
  if(!cacheReady) return toast('Đang đệm phần còn lại. Bạn có thể tua sau một chút.');
  const nextPosition = Math.max(0,Math.min(Number(position)||0,Math.max(0,mediaDuration()-.1)));
  if(streamingSource) {
    const wasPlaying = !audio.paused;
    streamingSource = false;
    audio.src = `/api/audio/${encodeURIComponent(loadedId)}.mp3?complete=1`;
    audio.load(); audio.currentTime = nextPosition;
    if(wasPlaying) audio.play().catch(()=>{$('#playStatus').textContent='Nhấn Phát để tiếp tục.';});
  } else audio.currentTime = nextPosition;
}
function startVisible(fromStart=false){const list=visibleTracks();return play(list[0]||catalog[0],{list:list.length?list:catalog,fromStart,origin:view==='suggestions'?'recommendation':'list'});}
function togglePlay() { if (preparing) return toast('Âm thanh đang được chuẩn bị.'); if (!current) return startVisible(); if (loadedId !== current.id || !audio.getAttribute('src')) return play(current,{keepOrder:true}); if (audio.paused) audio.play().then(()=>$('#playStatus').textContent='').catch(()=>toast('Chưa phát được. Bấm Phát để thử lại.')); else audio.pause(); }
async function next({automatic=false}={}){
  if(!current)return startVisible(true);
  const canSuggest=!automatic||autoplaySuggestions,navToken=token;
  let choice=order.pick(queue,canSuggest?recommendations:[]);
  if(!choice&&canSuggest&&!current.demo){toast('Đang chọn bài nghe tiếp…');await ensureRecommendations(current);if(token!==navToken)return;choice=order.pick(queue,recommendations);}
  if(choice){order.advance(choice);return play(choice.track,{keepOrder:true,fromStart:true});}
  toast('Đã hết danh sách đang nghe. Bạn có thể chọn thêm bài.');
}
function previous() { if (audio.currentTime>3) seekTo(0); else {const track=order.previous();if(track)play(track,{keepOrder:true,fromStart:true});else if(current)seekTo(0);} }
async function search(q) {
  const mySearch = ++searchToken; view='search'; results=[]; render(); setMessage('Đang tìm âm thanh trên YouTube…'); $('#searchSubmit').disabled=true;
  try { const data=await api('/api/search?q='+encodeURIComponent(q)); if(mySearch!==searchToken)return; results=data.tracks; if(view==='search'){render();setMessage(results.length?'Có ảnh bìa, chỉ phát âm thanh MP3 — không tải video.':'Không tìm thấy bài phù hợp.');} }
  catch(e){if(mySearch===searchToken&&view==='search')setMessage(e.message,true);} finally{if(mySearch===searchToken)$('#searchSubmit').disabled=false;}
}
$('#searchForm').addEventListener('submit',e=>{e.preventDefault();const q=$('#query').value.trim();if(q)search(q);else $('#query').focus();});
document.addEventListener('click',e=>{
  const viewButton=e.target.closest('[data-view]'); if(viewButton)return changeView(viewButton.dataset.view);
  const p=e.target.closest('[data-play]');if(p){const track=trackById(p.dataset.play);if(p.dataset.context==='upcoming'){const choice=order.upcoming(queue,recommendations).find(entry=>entry.track.id===p.dataset.play);if(choice){order.advance(choice);return play(choice.track,{keepOrder:true,fromStart:true});}}return play(track,p.dataset.context==='recommendation'?{list:recommendations,origin:'recommendation',fromStart:true}:{});}
  const s=e.target.closest('[data-save]');if(s)return toggleSave(trackById(s.dataset.save));
  const a=e.target.closest('[data-add]');if(a){const t=trackById(a.dataset.add);if(t&&!queue.some(v=>v.id===t.id)){queue.push(t);persistQueue();if(view==='queue')render();toast('Đã thêm vào hàng đợi');}else toast('Bài này đã có trong hàng đợi');return;}
  const r=e.target.closest('[data-remove]');if(r){queue=queue.filter(t=>t.id!==r.dataset.remove);persistQueue();if(view==='queue')render();return;}
  const c=e.target.closest('[data-category]');if(c){category=c.dataset.category;document.querySelectorAll('[data-category]').forEach(b=>b.classList.toggle('active',b===c));render();}
});
$('#heroPlay').onclick=()=>catalog.length?play(catalog[0],{list:catalog}):$('#query').focus();$('#playButton').onclick=togglePlay;$('#nextButton').onclick=()=>next();$('#prevButton').onclick=previous;$('#openQueue').onclick=()=>changeView(queue.length?'queue':order.pick([],[])?'listening':recommendations.length?'suggestions':'listening');$('#saveCurrent').onclick=()=>toggleSave(current);
$('#autoplaySuggestions').onclick=()=>{autoplaySuggestions=!autoplaySuggestions;write('autoplaySuggestions',autoplaySuggestions);renderRecommendations();toast(autoplaySuggestions?'Sẽ phát bài gợi ý khi hết danh sách':'Sẽ dừng khi hết danh sách đã chọn');};
$('#repeatButton').onclick=()=>{audio.loop=!audio.loop;$('#repeatButton').classList.toggle('on',audio.loop);$('#repeatButton').setAttribute('aria-pressed',String(audio.loop));toast(audio.loop?'Đã bật lặp lại một bài':'Đã tắt lặp lại');};
const speeds=[.75,1,1.25,1.5,2];let speed=Number(read('speed',1));if(!speeds.includes(speed))speed=1;audio.playbackRate=speed;$('#speedButton').textContent=speed+'×';$('#speedButton').onclick=()=>{speed=speeds[(speeds.indexOf(speed)+1)%speeds.length];write('speed',speed);audio.playbackRate=speed;$('#speedButton').textContent=speed+'×';toast(`Tốc độ phát ${speed}×`);};
audio.volume=Math.max(0,Math.min(1,Number(read('volume',.7))));$('#volume').value=audio.volume;$('#volume').oninput=e=>{audio.volume=Number(e.target.value);write('volume',audio.volume);};
$('#seek').oninput=e=>seekTo(Number(e.target.value));
audio.addEventListener('loadedmetadata',()=>{$('#seek').disabled=!cacheReady;$('#seek').max=mediaDuration();$('#duration').textContent=fmt(mediaDuration());});
audio.addEventListener('timeupdate',()=>{
  const duration=mediaDuration();$('#elapsed').textContent=fmt(audio.currentTime);$('#duration').textContent=fmt(duration);$('#seek').max=duration;$('#seek').value=audio.currentTime;$('#seek').style.setProperty('--progress',`${duration?audio.currentTime/duration*100:0}%`);
  if(Date.now()-lastSaved>5000){lastSaved=Date.now();savePosition();if('mediaSession'in navigator&&duration){try{navigator.mediaSession.setPositionState({duration,position:Math.min(audio.currentTime,duration),playbackRate:audio.playbackRate});}catch{}}}
});
audio.addEventListener('playing',()=>{if(current&&loadedId===current.id){recent=[current,...recent.filter(t=>t.id!==current.id)].slice(0,50);write('history',recent);if(view==='history')render();ensureRecommendations(current);}$('#playStatus').textContent='';updateTransport();});
audio.addEventListener('pause',()=>{savePosition();updateTransport();});audio.addEventListener('play',updateTransport);
audio.addEventListener('waiting',()=>{if(loadedId)$('#playStatus').textContent='Đang đệm âm thanh…';});
audio.addEventListener('error',()=>{if(!audio.getAttribute('src'))return;preparing=false;loadedId=null;$('#playStatus').textContent='Chưa mở được MP3. Bấm Phát để thử lại.';updateTransport();});
audio.addEventListener('ended',()=>{if(!loadedId)return;if(current){delete positions[current.id];write('positions',positions);}if(!audio.loop)next({automatic:true});});
window.addEventListener('pagehide',savePosition);document.addEventListener('visibilitychange',()=>{if(document.hidden)savePosition();if(sleepAt&&Date.now()>=sleepAt)stopSleep();});
if('mediaSession'in navigator){for(const [name,fn]of Object.entries({play:()=>{if(audio.paused)togglePlay();},pause:()=>audio.pause(),stop:()=>audio.pause(),nexttrack:()=>next(),previoustrack:previous,seekbackward:d=>seekTo(audio.currentTime-(d.seekOffset||10)),seekforward:d=>seekTo(audio.currentTime+(d.seekOffset||10)),seekto:d=>seekTo(d.seekTime)})){try{navigator.mediaSession.setActionHandler(name,fn);}catch{}}}
function stopSleep(){audio.pause();sleepAt=0;clearInterval(sleepTimer);$('#sleepLabel').textContent='';$('#sleepButton').classList.remove('on');toast('Đã dừng theo hẹn giờ.');}
$('#sleepButton').onclick=()=>$('#sleepDialog').showModal();$('#sleepDialog').addEventListener('close',()=>{const value=$('#sleepDialog').returnValue;if(!['0','15','30','60'].includes(value))return;clearInterval(sleepTimer);const minutes=Number(value);sleepAt=minutes?Date.now()+minutes*60000:0;$('#sleepButton').classList.toggle('on',!!minutes);const tick=()=>{if(sleepAt&&Date.now()>=sleepAt)return stopSleep();$('#sleepLabel').textContent=sleepAt?Math.ceil((sleepAt-Date.now())/60000)+'p':'';};tick();if(minutes)sleepTimer=setInterval(tick,1000);toast(minutes?`Sẽ dừng sau ${minutes} phút`:'Đã tắt hẹn giờ');});
document.addEventListener('keydown',e=>{if(e.target.matches('input,textarea,button')||$('#sleepDialog').open)return;if(e.code==='Space'){e.preventDefault();togglePlay();}if(e.code==='ArrowRight'&&loadedId)seekTo(audio.currentTime+10);if(e.code==='ArrowLeft'&&loadedId)seekTo(audio.currentTime-10);});
async function boot(){
  render();
  try {
    const health=await api('/api/health');onlineHome=onlineHome||health.deployment==='vercel';
    $('#connectionLabel').textContent=onlineHome?'Trực tuyến · MP3':health.lanEnabled?'Mạng LAN · MP3':'Trên máy bạn';
    if(onlineHome&&view==='home')setMessage('Đang tải gợi ý từ YouTube…');
    const data=await api(onlineHome?'/api/search?q='+encodeURIComponent('nhạc Việt chill'):'/api/library');
    catalog=onlineHome?data.tracks.filter(track=>!track.demo):data.tracks;render();
    if(view==='home')setMessage(!health.toolsReady?'Máy chủ âm thanh chưa sẵn sàng. Bạn có thể tìm bài trong lúc chờ.':'');
  }catch(e){if(view==='home')setMessage('Chưa tải được gợi ý. Bạn có thể tìm bài bằng ô tìm kiếm phía trên.',true);}
}
boot();if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
