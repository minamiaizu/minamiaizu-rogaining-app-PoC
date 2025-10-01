/* ======== Utility: robust logger available early ======== */
(function(){
  const el = document.getElementById('debug-log');
  window.debugLog = function(msg){
    const line = document.createElement('div');
    line.className = 'debug-line';
    const ts = new Date().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    line.textContent = `[${ts}] ${msg}`;
    if (el) el.prepend(line);
    console.log('[DEBUG]', msg);
  };
})();

/* ======== Service Worker ======== */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js')
      .then(reg => debugLog('✅ Service Worker登録成功'))
      .catch(err => debugLog('❌ Service Worker登録失敗: ' + err.message));
  });
}

/* ======== PWA install banner ======== */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const banner = document.getElementById('install-banner');
  if (banner && !window.matchMedia('(display-mode: standalone)').matches) {
    banner.hidden = false;
  }
  debugLog('📱 PWAインストール可能');
});
document.getElementById('install-button')?.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const choice = await deferredPrompt.userChoice;
  debugLog('インストール選択: ' + choice.outcome);
  deferredPrompt = null;
  document.getElementById('install-banner').hidden = true;
});
document.getElementById('close-install-banner')?.addEventListener('click', () => {
  document.getElementById('install-banner').hidden = true;
});

/* ======== App state ======== */
let map, currentPositionMarker;
let currentPosition = null;
let checkpoints = [];
let completedCheckpoints = new Set();
let photos = [];
let startTime = Date.now();
let remainingTime = 120 * 60; // sec
let isOnline = navigator.onLine;
let trackingEnabled = false;
let trackingInterval = null;
let trackPoints = [];
let trackPolyline = null;
let currentView = 'map';
let compassContainerSize = 400;
let currentHeading = 0;
let ar = {
  stream: null,
  ctx: null,
  canvas: null,
  video: null,
  fovH: 60 * Math.PI/180, // approx
  fovV: 40 * Math.PI/180,
  range: 1000,
  timerId: null,
  secondsLeft: 300,
};

const STORAGE_KEY = 'rogaining_data';

/* ======== Sample checkpoints (with elevation) ======== */
checkpoints = [
  { id: 1, name: "会津田島駅", lat: 37.20329853, lng: 139.77424063, points: 10, elevation: 650 },
  { id: 5, name: "田島郵便局", lat: 37.20304087405265, lng: 139.77286576693686, points: 15, elevation: 660 },
  { id: 3, name: "南会津町役場", lat: 37.200710699416376, lng: 139.77372578165173, points: 20, elevation: 655 },
  { id: 4, name: "旧会津田島祇園会館", lat: 37.205534721685595, lng: 139.77515747555398, points: 25, elevation: 658 },
  { id: 7, name: "丸山公園", lat: 37.20270904301629, lng: 139.76594854526823, points: 30, elevation: 670 },
  { id: 8, name: "びわのかげ運動公園芝生広場", lat: 37.205439950626705, lng: 139.7619837579642, points: 35, elevation: 672 },
  { id: 2, name: "びわのかげ公園", lat: 37.19933810720546, lng: 139.76057080171373, points: 40, elevation: 671 },
  { id: 6, name: "たじま公園", lat: 37.211615192715506, lng: 139.78760153630893, points: 45, elevation: 690 }
];

/* ======== Online/offline ======== */
function updateOnlineStatus(){
  const mapDiv = document.getElementById('map');
  const onlineEl = document.getElementById('online-status');
  if (!isOnline){
    mapDiv.style.opacity = '0.5';
    mapDiv.style.pointerEvents = 'none';
    if (onlineEl){ onlineEl.textContent = '⚠️ オフライン'; onlineEl.style.color = '#e53e3e'; }
  } else {
    mapDiv.style.opacity = '1';
    mapDiv.style.pointerEvents = 'auto';
    if (onlineEl){ onlineEl.textContent = '✅ オンライン'; onlineEl.style.color = '#48bb78'; }
  }
}
window.addEventListener('online', ()=>{ isOnline = true; updateOnlineStatus(); debugLog('✅ オンラインに復帰'); });
window.addEventListener('offline', ()=>{ isOnline = false; updateOnlineStatus(); debugLog('⚠️ オフライン'); });

/* ======== PWA status ======== */
function checkPWAStatus(){
  const el = document.getElementById('pwa-status');
  if (!el) return;
  if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) {
    el.textContent = '✅ インストール済み';
    el.style.color = '#48bb78';
  } else {
    el.textContent = 'ブラウザモード';
    el.style.color = '#718096';
  }
}

/* ======== Leaflet map ======== */
function initMap(){
  map = L.map('map');
  const tile = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  });
  tile.addTo(map);
  // Initial view
  map.setView([37.20329853, 139.77424063], 14);

  // Add checkpoint markers
  checkpoints.forEach(cp => {
    L.marker([cp.lat, cp.lng]).addTo(map).bindPopup(`${cp.name} (${cp.points}点)`);
  });
}

/* ======== Storage ======== */
function saveToLocalStorage(){
  const data = {
    completedCheckpoints: Array.from(completedCheckpoints),
    photos: photos.map(p => ({ timestamp:p.timestamp, position:p.position, dataUrl:p.dataUrl })),
    currentPosition, remainingTime, startTime,
    trackPoints, trackingEnabled,
    lastSaved: new Date().toISOString()
  };
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    debugLog('LocalStorage保存');
  }catch(e){
    debugLog('LocalStorage保存エラー: ' + e.message);
  }
}
function loadFromLocalStorage(){
  try{
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return false;
    const data = JSON.parse(saved);
    completedCheckpoints = new Set(data.completedCheckpoints || []);
    currentPosition = data.currentPosition || null;
    remainingTime = data.remainingTime ?? remainingTime;
    startTime = data.startTime || Date.now();
    trackPoints = data.trackPoints || [];
    trackingEnabled = !!data.trackingEnabled;
    photos = data.photos || [];
    debugLog('LocalStorageから復元');
    return true;
  }catch(e){
    debugLog('LocalStorage読み込みエラー: ' + e.message);
    return false;
  }
}
function clearLocalStorage(){
  if (confirm('保存されているデータをすべて削除しますか？')){
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  }
}

/* ======== UI rendering ======== */
function renderPhotoGallery(){
  const grid = document.getElementById('photo-grid');
  grid.innerHTML = '';
  if (!photos.length){
    grid.innerHTML = '<p style="color:#718096;text-align:center;padding:20px;">写真はまだありません</p>';
    return;
  }
  photos.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'photo-thumbnail';
    div.addEventListener('click', ()=>openPhotoModal(p.dataUrl));
    const img = document.createElement('img'); img.src = p.dataUrl; img.alt = `写真 ${i+1}`;
    const info = document.createElement('div'); info.className = 'photo-info';
    const time = new Date(p.timestamp).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});
    info.textContent = time;
    div.appendChild(img); div.appendChild(info); grid.appendChild(div);
  });
}
function openPhotoModal(src){
  const modal = document.getElementById('photo-modal');
  const img = document.getElementById('modal-image');
  img.src = src;
  modal.hidden = false;
}
document.getElementById('photo-close')?.addEventListener('click', ()=>{
  document.getElementById('photo-modal').hidden = true;
});
function renderCheckpoints(){
  const container = document.getElementById('checkpoints');
  container.innerHTML = '';
  checkpoints.forEach(cp => {
    const div = document.createElement('div');
    div.className = 'checkpoint-item';
    if (completedCheckpoints.has(cp.id)) div.classList.add('completed');
    else if (currentPosition){
      const d = distance(currentPosition.lat,currentPosition.lng,cp.lat,cp.lng);
      if (d <= 150) div.classList.add('near');
    }
    const dist = currentPosition ? `${distance(currentPosition.lat,currentPosition.lng,cp.lat,cp.lng).toFixed(0)}m` : '';
    div.innerHTML = `<div><div class="checkpoint-name">${completedCheckpoints.has(cp.id)?'✓ ':''}${cp.name}</div>${currentPosition?`<div style="font-size:12px;color:#718096;margin-top:4px;">${dist}${!trackingEnabled?' <span style="color:#e53e3e;">(更新停止中)</span>':''}</div>`:''}</div><div class="checkpoint-points">${cp.points}点</div>`;
    container.appendChild(div);
  });
  document.getElementById('cleared-count').textContent = `${completedCheckpoints.size} / ${checkpoints.length}`;
}

/* ======== Helpers ======== */
function distance(lat1,lon1,lat2,lon2){
  const R = 6371e3;
  const φ1 = lat1*Math.PI/180, φ2 = lat2*Math.PI/180;
  const dφ = (lat2-lat1)*Math.PI/180, dλ=(lon2-lon1)*Math.PI/180;
  const a = Math.sin(dφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(dλ/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function bearing(lat1,lon1,lat2,lon2){
  const φ1 = lat1*Math.PI/180, φ2=lat2*Math.PI/180, dλ=(lon2-lon1)*Math.PI/180;
  const y = Math.sin(dλ)*Math.cos(φ2);
  const x = Math.cos(φ1)*Math.sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(dλ);
  let θ = Math.atan2(y,x)*180/Math.PI;
  return (θ+360)%360;
}

/* ======== Geolocation ======== */
function getCurrentLocation(){
  debugLog('位置情報取得を開始...');
  if (location.protocol==='http:' && location.hostname!=='localhost' && location.hostname!=='127.0.0.1'){
    alert('HTTPSでないため位置情報を取得できません。');
    return;
  }
  if (!navigator.geolocation){ alert('このブラウザは位置情報に非対応'); return; }
  navigator.geolocation.getCurrentPosition((pos)=>{
    currentPosition = {lat:pos.coords.latitude,lng:pos.coords.longitude,accuracy:pos.coords.accuracy};
    debugLog(`位置情報: ${currentPosition.lat.toFixed(6)}, ${currentPosition.lng.toFixed(6)} ±${currentPosition.accuracy.toFixed(1)}m`);
    if (currentPositionMarker) map.removeLayer(currentPositionMarker);
    currentPositionMarker = L.marker([currentPosition.lat,currentPosition.lng],{
      icon: L.divIcon({className:'current-position-icon',html:'<div style="background:#48bb78;border:4px solid #fff;border-radius:50%;width:20px;height:20px;box-shadow:0 0 10px rgba(72,187,120,.6);"></div>',iconSize:[20,20]})
    }).addTo(map);
    L.circle([currentPosition.lat,currentPosition.lng],{radius:currentPosition.accuracy,color:'#48bb78',fillColor:'#48bb78',fillOpacity:.1,weight:1}).addTo(map);
    map.setView([currentPosition.lat,currentPosition.lng], 15);
    document.getElementById('gps-status').textContent='取得済み';
    document.getElementById('gps-accuracy').textContent=`±${currentPosition.accuracy.toFixed(1)}m`;
    document.getElementById('check-button').disabled = false;
    saveToLocalStorage();
    renderCheckpoints();
  }, (err)=>{
    debugLog('位置情報エラー: ' + err.message);
    alert('位置情報の取得に失敗しました。');
  }, { enableHighAccuracy:true, timeout:10000, maximumAge:0 });
}

/* ======== Photos ======== */
function compressImage(file, maxWidth=1280, quality=0.6){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = (e)=>{
      const img = new Image();
      img.onload = ()=>{
        let w = img.width, h = img.height;
        if (w > maxWidth){ h = h * maxWidth / w; w = maxWidth; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d'); ctx.drawImage(img,0,0,w,h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = ()=>reject(new Error('画像読込失敗'));
      img.src = e.target.result;
    };
    reader.onerror = ()=>reject(new Error('ファイル読込失敗'));
    reader.readAsDataURL(file);
  });
}
async function handlePhoto(e){
  const file = e.target.files[0];
  if (!file) return;
  const dataUrl = await compressImage(file, 1280, 0.6);
  photos.push({ timestamp:new Date().toISOString(), position: currentPosition?{...currentPosition}:null, dataUrl });
  document.getElementById('photo-count').textContent = `${photos.length}枚`;
  renderPhotoGallery();
  saveToLocalStorage();
  e.target.value = '';
}

/* ======== Checkpoint checking ======== */
function checkNearby(){
  if (!currentPosition){ alert('先に現在地を取得してください'); return; }
  if (photos.length===0){ alert('先に写真を撮影してください'); return; }
  let found=false;
  const threshold = 100;
  checkpoints.forEach(cp=>{
    if (completedCheckpoints.has(cp.id)) return;
    const d = distance(currentPosition.lat,currentPosition.lng,cp.lat,cp.lng);
    if (d <= threshold){
      completedCheckpoints.add(cp.id); found=true;
      debugLog(`✓ チェックポイント「${cp.name}」クリア（+${cp.points}点）`);
      alert(`🎉 チェックポイント「${cp.name}」をクリア！\n+${cp.points}点`);
    }
  });
  if (!found){ alert('近くにチェックポイントがありません（100m以内に接近してください）'); }
  updateScore(); renderCheckpoints(); saveToLocalStorage();
}
function updateScore(){
  const total = checkpoints.reduce((sum,cp)=> sum + (completedCheckpoints.has(cp.id)?cp.points:0), 0);
  document.getElementById('score').textContent = `得点: ${total}点`;
}

/* ======== Tracking ======== */
function startTracking(){
  if (trackingInterval) return;
  trackingEnabled = true;
  debugLog('軌跡記録を開始');
  const track = ()=>{
    navigator.geolocation.getCurrentPosition((pos)=>{
      const point = { lat:pos.coords.latitude, lng:pos.coords.longitude, accuracy:pos.coords.accuracy, timestamp:new Date().toISOString() };
      trackPoints.push(point);
      currentPosition = {lat:point.lat,lng:point.lng,accuracy:point.accuracy};
      if (currentPositionMarker) map.removeLayer(currentPositionMarker);
      currentPositionMarker = L.marker([currentPosition.lat,currentPosition.lng],{
        icon: L.divIcon({className:'current-position-icon',html:'<div style="background:#48bb78;border:4px solid #fff;border-radius:50%;width:20px;height:20px;box-shadow:0 0 10px rgba(72,187,120,.6);"></div>',iconSize:[20,20]})
      }).addTo(map);
      updateTrackPolyline();
      document.getElementById('gps-status').textContent='取得済み';
      document.getElementById('gps-accuracy').textContent=`±${currentPosition.accuracy.toFixed(1)}m`;
      document.getElementById('track-count').textContent = `${trackPoints.length}個`;
      renderCheckpoints();
      if (trackPoints.length % 5 === 0) saveToLocalStorage();
    }, ()=>{}, { enableHighAccuracy:false, timeout:10000, maximumAge:0 });
  };
  track();
  trackingInterval = setInterval(()=>{ if (trackingEnabled) track(); }, 60000);
  updateTrackingButton();
}
function stopTracking(){
  if (trackingInterval){
    clearInterval(trackingInterval); trackingInterval=null;
  }
  trackingEnabled = false;
  debugLog('軌跡記録を停止'); saveToLocalStorage(); updateTrackingButton(); renderCheckpoints();
}
function toggleTracking(){ trackingEnabled ? stopTracking() : startTracking(); }
function updateTrackingButton(){
  const b = document.getElementById('tracking-button');
  if (trackingEnabled){ b.textContent='⏸️ 軌跡記録を停止'; b.classList.remove('button-success'); b.classList.add('danger'); }
  else { b.textContent='▶️ 軌跡記録を開始'; b.classList.remove('danger'); b.classList.add('button-success'); }
}
function updateTrackPolyline(){
  if (!map) return;
  if (trackPolyline) map.removeLayer(trackPolyline);
  if (trackPoints.length >= 2){
    const latlngs = trackPoints.map(p=>[p.lat,p.lng]);
    trackPolyline = L.polyline(latlngs,{ color:'#667eea',weight:3,opacity:.7 }).addTo(map);
  }
}

/* ======== Compass ======== */
function updateCompassContainerSize(){
  const c = document.getElementById('compass-container');
  if (!c) return;
  compassContainerSize = c.offsetWidth;
  const canvas = document.getElementById('compass-ticks');
  canvas.width = compassContainerSize;
  canvas.height = compassContainerSize;
  drawCompassTicks();
}
function drawCompassTicks(){
  const canvas = document.getElementById('compass-ticks');
  const ctx = canvas.getContext('2d');
  const size = compassContainerSize;
  const cx = size/2, cy = size/2, r = size/2 - 20;
  ctx.clearRect(0,0,size,size);
  for (let i=0;i<360;i++){
    const rad = (i-90)*Math.PI/180;
    let len=0, w=1, color='#a0aec0';
    if (i%90===0){ len=25; w=3; color = (i===0)?'#c53030':'#2d3748'; }
    else if (i%45===0){ len=20; w=2; color='#4a5568'; }
    else if (i%15===0){ len=15; w=2; color='#718096'; }
    else if (i%5===0){ len=10; w=1; color='#a0aec0'; }
    else continue;
    ctx.beginPath();
    ctx.moveTo(cx+(r-len)*Math.cos(rad), cy+(r-len)*Math.sin(rad));
    ctx.lineTo(cx+r*Math.cos(rad), cy+r*Math.sin(rad));
    ctx.strokeStyle=color; ctx.lineWidth=w; ctx.lineCap='round'; ctx.stroke();
  }
}
function setHeading(deg){
  currentHeading = (deg+360)%360;
  document.getElementById('compass-needle').style.transform = `translate(-50%,-50%) rotate(${currentHeading}deg)`;
  document.getElementById('heading-display').textContent = `方位: ${currentHeading.toFixed(0)}°`;
}

/* ======== Device orientation ======== */
function startOrientation(){
  const start = ()=>{
    window.addEventListener('deviceorientation', (e)=>{
      const alpha = e.webkitCompassHeading != null ? e.webkitCompassHeading : e.alpha;
      if (alpha == null) return;
      const heading = e.webkitCompassHeading != null ? alpha : 360 - alpha; // iOS vs others
      setHeading(heading);
    });
  };
  // iOS permission
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function'){
    DeviceOrientationEvent.requestPermission().then(state=>{
      if (state==='granted'){ start(); }
      else debugLog('方位センサー許可が得られませんでした');
    }).catch(()=>debugLog('方位センサー要求に失敗'));
  } else {
    start();
  }
}

/* ======== Tabs ======== */
function switchView(view){
  currentView = view;
  document.getElementById('map').hidden = view!=='map';
  document.getElementById('compass-view').hidden = view!=='compass';
  document.getElementById('ar-view').hidden = view!=='ar';
  for (const b of document.querySelectorAll('#tabs .tab')){
    b.classList.toggle('active', b.dataset.view===view);
  }
  if (view==='compass'){ updateCompassContainerSize(); }
  if (view==='ar'){ startAR(); } else { stopAR(); }
}
document.getElementById('tab-map')?.addEventListener('click', ()=>switchView('map'));
document.getElementById('tab-compass')?.addEventListener('click', ()=>switchView('compass'));
document.getElementById('tab-ar')?.addEventListener('click', ()=>switchView('ar'));

/* ======== AR (camera + overlay) ======== */
async function startAR(){
  const video = document.getElementById('camera');
  const canvas = document.getElementById('ar-canvas');
  const ctx = canvas.getContext('2d');
  ar.video = video; ar.canvas = canvas; ar.ctx = ctx;
  try{
    ar.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio:false });
    video.srcObject = ar.stream;
    await video.play();
    resizeARCanvas();
    startOrientation();
    startARTimer();
    requestAnimationFrame(arLoop);
    debugLog('📷 カメラ開始 (AR)');
  }catch(e){
    debugLog('カメラ起動に失敗: ' + e.message);
    alert('カメラの使用許可が必要です');
    switchView('compass');
  }
}
function stopAR(){
  if (ar.stream){ ar.stream.getTracks().forEach(t=>t.stop()); ar.stream=null; }
  if (ar.timerId){ clearInterval(ar.timerId); ar.timerId=null; }
}
function resizeARCanvas(){
  const rect = document.getElementById('ar-view').getBoundingClientRect();
  ar.canvas.width = rect.width; ar.canvas.height = rect.height;
}
window.addEventListener('resize', ()=>{ updateCompassContainerSize(); if(currentView==='ar') resizeARCanvas(); });

function arLoop(){
  if (currentView!=='ar') return;
  // draw simple markers
  const ctx = ar.ctx;
  const w = ar.canvas.width, h = ar.canvas.height;
  ctx.clearRect(0,0,w,h);

  if (!currentPosition){ requestAnimationFrame(arLoop); return; }

  // heading strip
  const strip = document.getElementById('heading-strip');
  strip.style.backgroundPositionX = `-${currentHeading*2}px`;

  checkpoints.forEach(cp => {
    const d = distance(currentPosition.lat,currentPosition.lng,cp.lat,cp.lng);
    if (d > ar.range) return;
    const b = bearing(currentPosition.lat,currentPosition.lng, cp.lat, cp.lng); // 0..360
    let rel = ((b - currentHeading + 540) % 360) - 180; // -180..180
    // project to screen
    const x = w/2 + (rel * (Math.PI/180)) / ar.fovH * w;
    // elevation
    const elevDiff = (cp.elevation??0) - (currentPosition.elevation??0);
    const horiz = Math.max(1, d);
    const elevAngle = Math.atan2(elevDiff, horiz);
    const y = h/2 - (elevAngle / ar.fovV) * h;

    const size = d<=500?16: d<=1000?14:12;
    const r = d<=500?10:8;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI*2);
    ctx.fillStyle = completedCheckpoints.has(cp.id)?'#48bb78':'#667eea';
    ctx.fill();
    ctx.font = `bold ${size}px system-ui, -apple-system`;
    ctx.textAlign='center'; ctx.textBaseline='top';
    ctx.fillStyle = '#fff';
    ctx.strokeStyle='rgba(0,0,0,.6)'; ctx.lineWidth=4;
    const label = `${cp.name} ${Math.round(d)}m` + (elevDiff?` ${elevDiff>0?`+${Math.round(elevDiff)}`:`${Math.round(elevDiff)}`}m`:'');
    ctx.strokeText(label, x, y+r+4);
    ctx.fillText(label, x, y+r+4);
  });

  requestAnimationFrame(arLoop);
}

/* Range buttons */
for (const btn of document.querySelectorAll('.range-btn')){
  btn.addEventListener('click', ()=>{
    for (const b of document.querySelectorAll('.range-btn')) b.classList.remove('active');
    btn.classList.add('active');
    ar.range = Number(btn.dataset.range);
    document.getElementById('max-distance-label').textContent = ar.range >= 1000 ? `${ar.range/1000}km` : `${ar.range}m`;
  });
}

/* 5-minute auto timeout */
function startARTimer(){
  ar.secondsLeft = 300;
  document.getElementById('ar-remaining').textContent = '05:00';
  if (ar.timerId) clearInterval(ar.timerId);
  ar.timerId = setInterval(()=>{
    ar.secondsLeft--;
    const m = String(Math.floor(ar.secondsLeft/60)).padStart(2,'0');
    const s = String(ar.secondsLeft%60).padStart(2,'0');
    document.getElementById('ar-remaining').textContent = `${m}:${s}`;
    if (ar.secondsLeft<=0){
      clearInterval(ar.timerId); ar.timerId=null;
      alert('ARモードを終了します（5分経過）');
      switchView('compass');
    }
  }, 1000);
}

/* ======== Events ======== */
document.getElementById('get-location-btn')?.addEventListener('click', getCurrentLocation);
document.getElementById('photo-btn')?.addEventListener('click', ()=>document.getElementById('photo-input').click());
document.getElementById('photo-input')?.addEventListener('change', handlePhoto);
document.getElementById('check-button')?.addEventListener('click', checkNearby);
document.getElementById('tracking-button')?.addEventListener('click', toggleTracking);
document.getElementById('clear-button')?.addEventListener('click', clearLocalStorage);

/* ======== Init ======== */
(function init(){
  checkPWAStatus();
  updateOnlineStatus();
  initMap();
  loadFromLocalStorage();
  renderPhotoGallery();
  renderCheckpoints();
  updateTrackingButton();
  updateCompassContainerSize();
  startOrientation();
  document.getElementById('max-distance-label').textContent = '1km';
})();
