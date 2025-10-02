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
let timerInterval = null;
let isOnline = navigator.onLine;
let trackingEnabled = true;
let trackingInterval = null;
let trackPoints = [];
let trackPolyline = null;
let currentView = 'map';
let compassContainerSize = 400;
let currentHeading = 0;
let smoothedHeading = 0; // 平滑化された方位角
let rotationTotal = 0;
let activeTooltip = null;
let tooltipTimeout = null;
let devicePitch = 0; // デバイスの上下傾き角（度）
let orientationManager = null; // OrientationManager インスタンス

// デバイス判定
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
const AR_AVAILABLE = IS_IOS; // AR機能はiOS専用
let ar = {
  stream: null,
  ctx: null,
  canvas: null,
  video: null,
  fovH: 60 * Math.PI/180,
  fovV: 45 * Math.PI/180,
  fovPresets: {
    wide: { h: 70, v: 52, label: '広角' },
    normal: { h: 60, v: 45, label: '標準' },
    tele: { h: 45, v: 34, label: '望遠' }
  },
  selectedFov: 'normal',
  range: 1000,
  timerId: null,
  secondsLeft: 300,
  selectedCameraId: null,
  lastFrameTime: 0,
  fpsLimit: 30,
  distanceCache: {},
  lastCacheTime: 0,
  debugMode: false  // デバッグ表示のON/OFF
};

// Sonar state
let sonar = {
  canvas: null,
  ctx: null,
  distanceCanvas: null,
  distanceCtx: null,
  elevationCanvas: null,
  elevationCtx: null,
  size: 400,
  range: 1000,
  scanAngle: 0,           // スキャンラインの現在角度（0-360度）
  scanSpeed: 72,          // 度/秒 (360度/5秒 = 72度/秒)
  lastUpdateTime: 0,
  audioEnabled: false,
  audioContext: null,
  distanceCache: {},
  lastCacheTime: 0,
  lastScanSoundAngle: 0,
  animationId: null
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
  map.setView([37.20329853, 139.77424063], 14);

  checkpoints.forEach(cp => {
    const isCompleted = completedCheckpoints.has(cp.id);
    const marker = L.marker([cp.lat, cp.lng], {
      icon: L.divIcon({
        className: 'custom-icon',
        html: `<div style="background: ${isCompleted ? '#48bb78' : '#667eea'}; color: white; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">${cp.points}</div>`,
        iconSize: [30, 30]
      })
    }).addTo(map);
    
    marker.bindPopup(`<strong>${cp.name}</strong><br>${cp.points}点${isCompleted ? '<br>✅ クリア済み' : ''}`);
  });
}

/* ======== Storage ======== */
function saveToLocalStorage(){
  const data = {
    completedCheckpoints: Array.from(completedCheckpoints),
    photos: photos.map(p => ({ timestamp:p.timestamp, position:p.position, dataUrl:p.dataUrl })),
    currentPosition, remainingTime, startTime,
    trackPoints, trackingEnabled,
    selectedCameraId: ar.selectedCameraId,
    sonarAudioEnabled: sonar.audioEnabled,
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
    trackingEnabled = data.trackingEnabled !== undefined ? data.trackingEnabled : true;
    photos = data.photos || [];
    ar.selectedCameraId = data.selectedCameraId || null;
    sonar.audioEnabled = data.sonarAudioEnabled || false;
    debugLog('LocalStorageから復元');
    return true;
  }catch(e){
    debugLog('LocalStorage読み込みエラー: ' + e.message);
    return false;
  }
}
function clearLocalStorage(){
  if (confirm('保存されているデータをすべて削除しますか?')){
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
function calculateETA(distance, elevationDiff){
  // 徒歩速度: 時速4km = 分速67m
  const baseSpeed = 67; // m/min
  const flatTime = distance / baseSpeed;
  // 登りのペナルティ: 100m登りで約15分追加
  const elevationPenalty = Math.max(0, elevationDiff) * 0.15;
  return flatTime + elevationPenalty;
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
    currentPosition = {
      lat:pos.coords.latitude,
      lng:pos.coords.longitude,
      accuracy:pos.coords.accuracy,
      elevation: pos.coords.altitude || 650 // 標高を取得（取得できない場合はデフォルト値）
    };
    debugLog(`位置情報: ${currentPosition.lat.toFixed(6)}, ${currentPosition.lng.toFixed(6)} ±${currentPosition.accuracy.toFixed(1)}m`);
    if (currentPosition.elevation) {
      debugLog(`標高: ${currentPosition.elevation.toFixed(1)}m`);
    }
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
      debugLog(`✓ チェックポイント「${cp.name}」クリア(+${cp.points}点)`);
      alert(`🎉 チェックポイント「${cp.name}」をクリア!\n+${cp.points}点`);
    }
  });
  if (!found){ alert('近くにチェックポイントがありません(100m以内に接近してください)'); }
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
      const point = { 
        lat:pos.coords.latitude, 
        lng:pos.coords.longitude, 
        accuracy:pos.coords.accuracy, 
        elevation: pos.coords.altitude || null,
        timestamp:new Date().toISOString() 
      };
      trackPoints.push(point);
      currentPosition = {
        lat:point.lat,
        lng:point.lng,
        accuracy:point.accuracy,
        elevation: point.elevation || currentPosition?.elevation || 650
      };
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
  if (trackingEnabled){ 
    b.textContent='⏸️ 軌跡記録を停止'; 
    b.classList.remove('button-success'); 
    b.classList.add('danger'); 
    b.style.background = '#48bb78';
  } else { 
    b.textContent='▶️ 軌跡記録を開始'; 
    b.classList.remove('danger'); 
    b.classList.add('button-success'); 
    b.style.background = '#ed8936';
  }
}
function updateTrackPolyline(){
  if (!map) return;
  if (trackPolyline) map.removeLayer(trackPolyline);
  if (trackPoints.length >= 2){
    const latlngs = trackPoints.map(p=>[p.lat,p.lng]);
    trackPolyline = L.polyline(latlngs,{ color:'#667eea',weight:3,opacity:.7 }).addTo(map);
  }
}

/* ======== Timer ======== */
function startTimer(){
  const update = ()=>{
    const h = Math.floor(remainingTime/3600);
    const m = Math.floor((remainingTime%3600)/60);
    const s = remainingTime%60;
    document.getElementById('timer').textContent = `残り時間: ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    if (remainingTime<=0){
      clearInterval(timerInterval);
      alert('制限時間終了!');
      debugLog('競技終了');
      saveToLocalStorage();
    }
    remainingTime--;
    if (remainingTime%30===0) saveToLocalStorage();
  };
  update();
  timerInterval = setInterval(update, 1000);
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
  // OrientationManager経由で処理される
  if (orientationManager) {
    // 手動設定は無視（OrientationManagerが管理）
    return;
  }
  
  // フォールバック（OrientationManagerが初期化されていない場合）
  currentHeading = (deg+360)%360;
  
  // 平滑化フィルタ（指数移動平均）を適用
  // alpha = 0.08 → 92%過去、8%現在（滑らか）
  const alpha = 0.08;
  
  // 角度の差分を計算（最短経路）
  let diff = currentHeading - smoothedHeading;
  if (diff > 180) diff -= 360;
  else if (diff < -180) diff += 360;
  
  // 平滑化された方位角を更新
  smoothedHeading = (smoothedHeading + alpha * diff + 360) % 360;
  
  updateCompassDisplay();
}

/* ======== Device orientation ======== */
function startOrientation() {
  if (!orientationManager) {
    orientationManager = new OrientationManager();
    
    // コールバック設定
    orientationManager.onUpdate = (data) => {
      // 既存のグローバル変数を更新
      currentHeading = data.heading;
      smoothedHeading = data.heading;
      
      // デバッグ表示（betaクの状態）
      if (data.beta !== undefined) {
        devicePitch = data.beta;
        updatePitchIndicator();
      }
      
      // コンパス表示更新
      updateCompassDisplay();
      
      // 信頼度に応じたUI調整
      if (currentView === 'compass' && data.confidence < 0.3) {
        const headingDisplay = document.getElementById('heading-display');
        if (headingDisplay) {
          if (data.status === 'frozen') {
            headingDisplay.textContent = '方位: 測定中...';
            headingDisplay.style.opacity = '0.5';
          } else {
            headingDisplay.textContent = `方位: ${Math.round(data.heading)}°`;
            headingDisplay.style.opacity = String(data.confidence);
          }
        }
      }
      
      // ARモードでの信頼度表示
      if (currentView === 'ar' && data.mode === 'ar') {
        // ARビューでジャイロ状態を表示する処理
        const nearestInfo = document.getElementById('nearest-cp-info');
        if (nearestInfo && data.gyroAvailable === false) {
          nearestInfo.style.backgroundColor = 'rgba(255, 100, 0, 0.7)';
        }
      }
    };
    
    // 初期化
    orientationManager.init().then(success => {
      if (success) {
        debugLog('✅ 方位システム初期化成功');
      } else {
        debugLog('⚠️ 方位システム初期化に一部失敗');
      }
    });
  }
}

/* ======== Device motion (傾き検出) ======== */
function startDeviceMotion(){
  if (typeof DeviceOrientationEvent !== 'undefined') {
    window.addEventListener('deviceorientation', (e)=>{
      if (e.beta !== null) {
        // betaは前後の傾き角（-180～180度、0=水平、+90=前倒し、-90=後ろ倒し）
        devicePitch = e.beta || 0;
        updatePitchIndicator();
      }
    });
    debugLog('デバイス傾き角検出を開始');
  }
}

// グローバル関数として定義
window.updatePitchIndicator = function updatePitchIndicator(){
  // マーカー要素を取得
  const leftMarker = document.querySelector('#pitch-indicator-left .pitch-marker');
  const rightMarker = document.querySelector('#pitch-indicator-right .pitch-marker');
  
  if (!leftMarker || !rightMarker) return;
  
  // スマホを構えた状態（90°）を0°として補正
  // 90°（前倒し）= 0°（水平）
  // 60°（上向き）= +30°
  // 120°（下向き）= -30°
  const correctedPitch = devicePitch - 90;
  
  // -30°～+30°の範囲でクランプ
  const clampedPitch = Math.max(-30, Math.min(30, correctedPitch));
  
  // ピッチ角を位置（%）に変換
  // +30°が上（0%）、0°が中央（50%）、-30°が下（100%）
  const position = ((30 - clampedPitch) / 60) * 100;
  
  // マーカーの位置を更新
  leftMarker.style.top = `${position}%`;
  rightMarker.style.top = `${position}%`;
}

/* ======== Compass display update ======== */
function updateCompassDisplay(){
  const compassCircle = document.getElementById('compass-circle');
  const headingDisplay = document.getElementById('heading-display');
  
  if (compassCircle){
    let normalizedHeading = currentHeading % 360;
    if (normalizedHeading < 0) normalizedHeading += 360;
    let currentRotation = rotationTotal % 360;
    if (currentRotation < 0) currentRotation += 360;
    let diff = normalizedHeading - currentRotation;
    if (diff > 180) diff -= 360;
    else if (diff < -180) diff += 360;
    rotationTotal += diff;
    compassCircle.style.transform = `rotate(${rotationTotal}deg)`;
  }
  
  if (headingDisplay){
    headingDisplay.textContent = `方位: ${Math.round(currentHeading)}°`;
  }
  
  updateCheckpointMarkers();
}

/* ======== Checkpoint markers on compass ======== */
function updateCheckpointMarkers(){
  if (!currentPosition) return;
  const markersContainer = document.getElementById('checkpoint-markers');
  if (!markersContainer) return;
  markersContainer.innerHTML = '';
  
  let distances = [];
  checkpoints.forEach(cp => {
    if (completedCheckpoints.has(cp.id)) return;
    const d = distance(currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
    distances.push(d);
  });
  
  if (distances.length === 0) return;
  
  const minDistance = Math.min(...distances);
  const maxDistance = Math.max(...distances);
  const centerPoint = compassContainerSize / 2;
  const radius = centerPoint * 0.85;
  
  checkpoints.forEach(cp => {
    if (completedCheckpoints.has(cp.id)) return;
    const d = distance(currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
    const color = getDistanceColor(d, minDistance, maxDistance);
    const b = bearing(currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
    
    const marker = document.createElement('div');
    marker.className = 'checkpoint-marker';
    marker.textContent = cp.points;
    marker.style.background = color;
    
    // 絶対方位を使用し、コンパス円の回転を補正
    // b = 絶対方位（北=0度）
    // - currentHeading = コンパス円の回転を打ち消す
    // - 90 = Canvas座標変換（北を上に）
    const angle = (b - currentHeading - 90) * Math.PI / 180;
    const x = centerPoint + radius * Math.cos(angle);
    const y = centerPoint + radius * Math.sin(angle);
    
    marker.style.left = x + 'px';
    marker.style.top = y + 'px';
    marker.style.transform = `rotate(${-rotationTotal}deg)`;
    
    marker.title = `${cp.name}: ${Math.round(d)}m`;
    
    marker.addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = marker.getBoundingClientRect();
      const tooltipX = rect.left + rect.width / 2;
      const tooltipY = rect.top;
      showTooltip(`${cp.name}: ${Math.round(d)}m`, tooltipX, tooltipY);
    });
    
    markersContainer.appendChild(marker);
  });
  
  updateDistanceBar(minDistance, maxDistance);
}

/* ======== Distance bar ======== */
function updateDistanceBar(minDist, maxDist){
  if (!currentPosition) return;
  const bar = document.getElementById('distance-bar');
  const maxLabel = document.getElementById('max-distance-label');
  
  if (!bar) return;
  bar.innerHTML = '';
  
  if (maxLabel){
    maxLabel.textContent = `${Math.round(maxDist)}m`;
  }
  
  checkpoints.forEach(cp => {
    if (completedCheckpoints.has(cp.id)) return;
    const d = distance(currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
    const color = getDistanceColor(d, minDist, maxDist);
    const position = maxDist > minDist ? ((d - minDist) / (maxDist - minDist)) * 100 : 50;
    
    const marker = document.createElement('div');
    marker.className = 'distance-marker';
    if (completedCheckpoints.has(cp.id)) marker.classList.add('completed');
    marker.textContent = cp.points;
    marker.style.background = color;
    marker.style.left = `${position}%`;
    marker.title = `${cp.name}: ${Math.round(d)}m`;
    
    marker.addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = marker.getBoundingClientRect();
      const tooltipX = rect.left + rect.width / 2;
      const tooltipY = rect.top;
      showTooltip(`${cp.name}: ${Math.round(d)}m`, tooltipX, tooltipY);
    });
    
    bar.appendChild(marker);
  });
}

function getDistanceColor(distance, minDist, maxDist){
  if (maxDist === minDist) return 'hsl(120, 80%, 50%)';
  const normalized = (distance - minDist) / (maxDist - minDist);
  let hue;
  if (normalized <= 0.5) hue = 240 - (120 * normalized * 2);
  else hue = 120 - (120 * (normalized - 0.5) * 2);
  return `hsl(${hue}, 80%, 50%)`;
}

/* ======== Tooltip ======== */
function showTooltip(text, x, y){
  hideTooltip();
  
  const tooltip = document.createElement('div');
  tooltip.className = 'custom-tooltip';
  tooltip.textContent = text;
  tooltip.style.left = x + 'px';
  tooltip.style.top = y + 'px';
  
  document.body.appendChild(tooltip);
  activeTooltip = tooltip;
  
  clearTimeout(tooltipTimeout);
  tooltipTimeout = setTimeout(hideTooltip, 3000);
}

function hideTooltip(){
  if (activeTooltip){
    document.body.removeChild(activeTooltip);
    activeTooltip = null;
  }
  clearTimeout(tooltipTimeout);
}

/* ======== Sonar Functions ======== */
function initSonar() {
  sonar.canvas = document.getElementById('sonar-canvas');
  if (!sonar.canvas) return;
  
  sonar.ctx = sonar.canvas.getContext('2d');
  sonar.distanceCanvas = document.getElementById('distance-gradient-canvas');
  sonar.distanceCtx = sonar.distanceCanvas?.getContext('2d');
  sonar.elevationCanvas = document.getElementById('elevation-profile-canvas');
  sonar.elevationCtx = sonar.elevationCanvas?.getContext('2d');
  
  resizeSonarCanvas();
  
  // 音響システム初期化
  if (window.AudioContext || window.webkitAudioContext) {
    initSonarAudio();
  }
  
  // 音響トグルの状態を復元
  const audioToggle = document.getElementById('sonar-audio-enable');
  if (audioToggle) {
    audioToggle.checked = sonar.audioEnabled;
    audioToggle.addEventListener('change', (e) => {
      sonar.audioEnabled = e.target.checked;
      debugLog(`ソナー音響: ${sonar.audioEnabled ? 'ON' : 'OFF'}`);
      saveToLocalStorage();
    });
  }
  
  debugLog('ソナーシステム初期化完了');
  
  // 標高断面図のタップイベント
  if (sonar.elevationCanvas) {
    sonar.elevationCanvas.addEventListener('click', (e) => {
      if (!currentPosition) return;
      
      const rect = sonar.elevationCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      const w = sonar.elevationCanvas.width;
      const h = sonar.elevationCanvas.height;
      const currentElev = currentPosition.elevation || 650;
      const baselineY = h * 0.55;
      const leftMargin = 40;
      const rightMargin = 5;
      const graphWidth = w - leftMargin - rightMargin;
      const maxScaleHeight = h * 0.35;
      
      let cpData = [];
      checkpoints.forEach(cp => {
        const dist = distance(currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
        if (dist <= sonar.range && !completedCheckpoints.has(cp.id)) {
          cpData.push({ cp, dist });
        }
      });
      
      if (cpData.length === 0) return;
      
      // クリック位置に最も近いCPを探す
      let nearestCP = null;
      let minDistance = Infinity;
      
      cpData.forEach(({ cp, dist }) => {
        // X軸はsonar.rangeベースで統一
        const cpX = leftMargin + (dist / sonar.range) * graphWidth;
        const elevDiff = (cp.elevation || 650) - currentElev;
        const barHeight = Math.min(Math.abs(elevDiff) / 1.2, maxScaleHeight * 0.9);
        const labelOffset = 22;
        const cpY = elevDiff > 0 ? baselineY - barHeight - labelOffset
                                  : baselineY + barHeight + labelOffset;
        
        const clickDist = Math.sqrt((x - cpX) ** 2 + (y - cpY) ** 2);
        if (clickDist < 25 && clickDist < minDistance) {
          minDistance = clickDist;
          nearestCP = { cp, dist };
        }
      });
      
      if (nearestCP) {
        showSonarDetailModal(nearestCP.cp, nearestCP.dist);
      }
    });
  }
  
  // ソナー円のタップイベント
  if (sonar.canvas) {
    sonar.canvas.addEventListener('click', (e) => {
      if (!currentPosition) return;
      
      const rect = sonar.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      const w = sonar.canvas.width;
      const h = sonar.canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const radius = Math.min(cx, cy) - 20;
      
      // クリック位置に最も近いCPを探す
      let nearestCP = null;
      let minDistance = Infinity;
      
      checkpoints.forEach(cp => {
        const dist = distance(currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
        if (dist > sonar.range) return;
        
        const brng = bearing(currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
        const heading = smoothedHeading || 0;
        const relBearing = (brng - heading + 360) % 360;
        
        const normalizedDist = dist / sonar.range;
        const r = normalizedDist * radius;
        const angle = (relBearing - 90) * Math.PI / 180;
        const cpX = cx + r * Math.cos(angle);
        const cpY = cy + r * Math.sin(angle);
        
        const clickDist = Math.sqrt((x - cpX) ** 2 + (y - cpY) ** 2);
        if (clickDist < 30 && clickDist < minDistance) {
          minDistance = clickDist;
          nearestCP = { cp, dist };
        }
      });
      
      if (nearestCP) {
        showSonarDetailModal(nearestCP.cp, nearestCP.dist);
      }
    });
  }
}

function resizeSonarCanvas() {
  const container = document.getElementById('sonar-container');
  if (!container) return;
  
  sonar.size = container.offsetWidth;
  
  if (sonar.canvas) {
    sonar.canvas.width = sonar.size;
    sonar.canvas.height = sonar.size;
  }
  
  if (sonar.distanceCanvas) {
    const rect = sonar.distanceCanvas.parentElement.getBoundingClientRect();
    sonar.distanceCanvas.width = rect.width;
    sonar.distanceCanvas.height = rect.height;
  }
  
  if (sonar.elevationCanvas) {
    const rect = sonar.elevationCanvas.parentElement.getBoundingClientRect();
    sonar.elevationCanvas.width = rect.width;
    sonar.elevationCanvas.height = rect.height;
  }
}

function sonarLoop(timestamp) {
  if (currentView !== 'sonar') {
    sonar.animationId = null;
    return;
  }
  
  // スキャンライン角度更新（3秒で360度）
  if (sonar.lastUpdateTime === 0) sonar.lastUpdateTime = timestamp;
  const deltaTime = timestamp - sonar.lastUpdateTime;
  sonar.scanAngle = (sonar.scanAngle + (sonar.scanSpeed * deltaTime / 1000)) % 360;
  sonar.lastUpdateTime = timestamp;
  
  // 描画
  drawSonarDisplay();
  drawDistanceGradientBar();
  drawElevationProfile();
  updateSonarNearestInfo();
  
  // スキャン音チェック
  checkScanSound();
  
  sonar.animationId = requestAnimationFrame(sonarLoop);
}

function drawSonarDisplay() {
  const ctx = sonar.ctx;
  const w = sonar.canvas.width;
  const h = sonar.canvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(cx, cy) - 20;
  
  // 背景クリア
  ctx.clearRect(0, 0, w, h);
  
  // Canvasを保存して回転を適用
  ctx.save();
  ctx.translate(cx, cy);
  
  // ソナー円をheadingに応じて回転（北が上になるように）
  const heading = smoothedHeading || 0;
  ctx.rotate(-heading * Math.PI / 180);
  
  ctx.translate(-cx, -cy);
  
  // 背景グラデーション（明るいポップなグリーン - ドラゴンレーダー風）
  const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  bgGrad.addColorStop(0, '#a8e6cf');  // 明るいミントグリーン
  bgGrad.addColorStop(0.5, '#7ed6a8'); // ポップなグリーン
  bgGrad.addColorStop(1, '#6bc99b');   // 少し濃いグリーン
  ctx.fillStyle = bgGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  
  // 距離リング
  drawDistanceRings(ctx, cx, cy, radius);
  
  // スキャンライン
  drawScanLine(ctx, cx, cy, radius);
  
  // チェックポイント
  drawSonarCheckpoints(ctx, cx, cy, radius);
  
  // 中心点（ピンク色 - ドラゴンレーダー風の現在地マーカー）
  ctx.fillStyle = '#ff6b9d';
  ctx.beginPath();
  ctx.arc(cx, cy, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 3;
  ctx.stroke();
  
  // Canvasの状態を復元
  ctx.restore();
}

function drawDistanceRings(ctx, cx, cy, radius) {
  const rings = 4;
  ctx.strokeStyle = 'rgba(45, 55, 72, 0.4)'; // 濃いグレー
  ctx.lineWidth = 1.5;
  
  for (let i = 1; i <= rings; i++) {
    const r = (radius / rings) * i;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    
    // 距離ラベル
    ctx.fillStyle = 'rgba(45, 55, 72, 0.7)';
    ctx.font = 'bold 12px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const distLabel = Math.round((sonar.range / rings) * i);
    const labelText = distLabel >= 1000 ? `${(distLabel/1000).toFixed(1)}km` : `${distLabel}m`;
    ctx.fillText(labelText, cx, cy - r + 14);
  }
}

function drawScanLine(ctx, cx, cy, radius) {
  const scanArc = 45; // 扇形の開き角度
  const startAngle = (sonar.scanAngle - 90) * Math.PI / 180;
  const endAngle = (sonar.scanAngle + scanArc - 90) * Math.PI / 180;
  
  // 扇形グラデーション（黄色系 - ドラゴンレーダー風）
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  grad.addColorStop(0, 'rgba(255, 220, 100, 0.5)');
  grad.addColorStop(0.8, 'rgba(255, 220, 100, 0.2)');
  grad.addColorStop(1, 'rgba(255, 220, 100, 0)');
  
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, radius, startAngle, endAngle);
  ctx.closePath();
  ctx.fill();
  
  // スキャンラインの先端（明るい黄色ライン）
  ctx.strokeStyle = 'rgba(255, 193, 7, 0.9)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  const lineAngle = (sonar.scanAngle - 90) * Math.PI / 180;
  ctx.lineTo(cx + radius * Math.cos(lineAngle), cy + radius * Math.sin(lineAngle));
  ctx.stroke();
}

function drawSonarCheckpoints(ctx, cx, cy, radius) {
  if (!currentPosition) return;
  
  checkpoints.forEach(cp => {
    // 距離と方位計算
    const dist = getCachedDistance(cp.id, currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
    if (dist > sonar.range) return;
    
    const brng = bearing(currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
    const heading = smoothedHeading || 0;
    const relBearing = (brng - heading + 360) % 360;
    
    // 極座標から直交座標へ変換
    const normalizedDist = dist / sonar.range;
    const r = normalizedDist * radius;
    const angle = (relBearing - 90) * Math.PI / 180;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    
    // 光点の色（距離グラデーション）
    const color = getDistanceColor(dist, 0, sonar.range);
    
    // 光点サイズ（ドラゴンレーダー風に少し大きめ）
    const baseSize = 14;
    const size = baseSize * (1 - normalizedDist * 0.4);
    
    // グロー効果（黄色系で明るく）
    const glowGrad = ctx.createRadialGradient(x, y, 0, x, y, size * 2.5);
    glowGrad.addColorStop(0, '#ffd700');
    glowGrad.addColorStop(0.4, 'rgba(255, 215, 0, 0.6)');
    glowGrad.addColorStop(1, 'rgba(255, 215, 0, 0)');
    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.arc(x, y, size * 2.5, 0, Math.PI * 2);
    ctx.fill();
    
    // 光点本体（距離グラデーション）
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
    
    // 外周リング
    ctx.strokeStyle = '#ff6b00';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // 完了済みの場合、チェックマーク
    if (completedCheckpoints.has(cp.id)) {
      ctx.fillStyle = '#2d3748';
      ctx.font = `bold ${size * 1.5}px system-ui`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✓', x, y);
    } else {
      // ポイント数表示
      ctx.fillStyle = '#2d3748';
      ctx.font = `bold ${Math.max(size * 0.9, 10)}px system-ui`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(cp.points, x, y);
    }
    
    // スキャンライン通過時のフラッシュ効果
    const scanDiff = Math.abs(((relBearing - sonar.scanAngle + 540) % 360) - 180);
    if (scanDiff < 5) {
      ctx.strokeStyle = 'rgba(255, 193, 7, 0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, size + 6, 0, Math.PI * 2);
      ctx.stroke();
      
      // 音響フィードバック
      if (sonar.audioEnabled) {
        playDetectionBeep(dist);
      }
    }
    
    // 最寄りCPにパルス効果
    if (cp.id === getNearestCheckpointId()) {
      const pulsePhase = (Date.now() % 2000) / 2000;
      const pulseAlpha = 0.4 + Math.sin(pulsePhase * Math.PI * 2) * 0.3;
      ctx.strokeStyle = `rgba(255, 107, 0, ${pulseAlpha})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, size + 8, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
}

function drawDistanceGradientBar() {
  if (!sonar.distanceCtx || !currentPosition) return;
  
  const ctx = sonar.distanceCtx;
  const w = sonar.distanceCanvas.width;
  const h = sonar.distanceCanvas.height;
  
  ctx.clearRect(0, 0, w, h);
  
  // グラデーションバー
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, 'hsl(240, 80%, 50%)');
  grad.addColorStop(0.25, 'hsl(180, 80%, 50%)');
  grad.addColorStop(0.5, 'hsl(120, 80%, 50%)');
  grad.addColorStop(0.75, 'hsl(60, 80%, 50%)');
  grad.addColorStop(1, 'hsl(0, 80%, 50%)');
  
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  
  // CPマーカー
  const markersContainer = document.getElementById('distance-markers-container');
  if (markersContainer) {
    markersContainer.innerHTML = '';
    
    checkpoints.forEach(cp => {
      if (completedCheckpoints.has(cp.id)) return;
      
      const dist = distance(currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
      if (dist > sonar.range) return;
      
      const position = (dist / sonar.range) * 100;
      const color = getDistanceColor(dist, 0, sonar.range);
      
      const marker = document.createElement('div');
      marker.className = 'distance-marker';
      marker.textContent = cp.points;
      marker.style.background = color;
      marker.style.left = `${position}%`;
      marker.style.width = '28px';
      marker.style.height = '28px';
      marker.style.fontSize = '12px';
      marker.title = `${cp.name}: ${Math.round(dist)}m`;
      
      markersContainer.appendChild(marker);
    });
  }
}

function drawElevationProfile() {
  if (!sonar.elevationCtx || !currentPosition) return;
  
  const ctx = sonar.elevationCtx;
  const w = sonar.elevationCanvas.width;
  const h = sonar.elevationCanvas.height;
  
  ctx.clearRect(0, 0, w, h);
  
  // 背景
  ctx.fillStyle = '#f7fafc';
  ctx.fillRect(0, 0, w, h);
  
  const currentElev = currentPosition.elevation || 650;
  const baselineY = h * 0.55; // 高さ120pxに対応して少し下に
  const leftMargin = 40;
  const rightMargin = 5;
  
  // 凡例を右上に追加
  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.fillRect(w - 115, 8, 110, 38);
  ctx.strokeStyle = '#cbd5e0';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(w - 115, 8, 110, 38);
  
  ctx.font = 'bold 11px system-ui';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(w - 108, 15, 16, 11);
  ctx.fillStyle = '#2d3748';
  ctx.fillText('🔺登り', w - 87, 23);
  
  ctx.fillStyle = '#3b82f6';
  ctx.fillRect(w - 108, 31, 16, 11);
  ctx.fillStyle = '#2d3748';
  ctx.fillText('🔻下り', w - 87, 39);
  ctx.restore();
  
  // Y軸スケール（左側）
  ctx.save();
  ctx.font = 'bold 10px system-ui';
  ctx.textAlign = 'right';
  ctx.fillStyle = '#4a5568';
  
  // スケール線とラベル
  const scaleSteps = [50, 25, 0, -25, -50];
  const maxScaleHeight = h * 0.35; // 上下の最大表示範囲
  
  scaleSteps.forEach(diff => {
    const y = baselineY - (diff / 50) * maxScaleHeight;
    
    // 横線
    ctx.strokeStyle = diff === 0 ? 'rgba(72, 187, 120, 0.8)' : 'rgba(160, 174, 192, 0.3)';
    ctx.lineWidth = diff === 0 ? 2.5 : 1;
    if (diff === 0) {
      ctx.setLineDash([]);
    } else {
      ctx.setLineDash([4, 4]);
    }
    ctx.beginPath();
    ctx.moveTo(leftMargin - 3, y);
    ctx.lineTo(w - rightMargin, y);
    ctx.stroke();
    
    // ラベル
    const label = diff === 0 ? `${currentElev}m` : `${diff > 0 ? '+' : ''}${diff}`;
    ctx.fillText(label, leftMargin - 6, y + 3);
  });
  ctx.setLineDash([]);
  ctx.restore();
  
  // タイトル
  ctx.fillStyle = '#2d3748';
  ctx.font = 'bold 12px system-ui';
  ctx.textAlign = 'left';
  ctx.fillText('標高プロファイル', 8, 15);
  
  // 各CPの標高バー（X軸をsonar.rangeベースに統一）
  let cpData = [];
  checkpoints.forEach(cp => {
    const dist = distance(currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
    if (dist <= sonar.range && !completedCheckpoints.has(cp.id)) {
      cpData.push({ cp, dist });
    }
  });
  
  if (cpData.length === 0) {
    ctx.fillStyle = '#718096';
    ctx.font = 'bold 14px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('範囲内にCPがありません', w / 2, h / 2);
    return;
  }
  
  // CPバーとラベル（距離バーと同じスケールを使用）
  const graphWidth = w - leftMargin - rightMargin;
  
  cpData.forEach(({ cp, dist }) => {
    // 距離バーと同じ位置計算（sonar.rangeベース）
    const x = leftMargin + (dist / sonar.range) * graphWidth;
    
    const elevDiff = (cp.elevation || 650) - currentElev;
    const barHeight = Math.min(Math.abs(elevDiff) / 1.2, maxScaleHeight * 0.9);
    
    // バーの色
    const alpha = 0.6 + (barHeight / maxScaleHeight) * 0.3;
    const color = elevDiff > 0 
      ? `rgba(239, 68, 68, ${alpha})` 
      : `rgba(59, 130, 246, ${alpha})`;
    
    // バー本体
    ctx.fillStyle = color;
    const barWidth = 12;
    if (elevDiff > 0) {
      ctx.fillRect(x - barWidth/2, baselineY - barHeight, barWidth, barHeight);
    } else {
      ctx.fillRect(x - barWidth/2, baselineY, barWidth, Math.abs(barHeight));
    }
    
    // 外枠
    ctx.strokeStyle = '#2d3748';
    ctx.lineWidth = 1.5;
    if (elevDiff > 0) {
      ctx.strokeRect(x - barWidth/2, baselineY - barHeight, barWidth, barHeight);
    } else {
      ctx.strokeRect(x - barWidth/2, baselineY, barWidth, Math.abs(barHeight));
    }
    
    // CP番号と標高差（背景付き）
    const labelOffset = 22;
    const textY = elevDiff > 0 ? baselineY - barHeight - labelOffset : baselineY + barHeight + labelOffset;
    
    // 白い円背景（大きめ）
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, textY, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2d3748';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // CP番号
    ctx.fillStyle = '#2d3748';
    ctx.font = 'bold 17px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(cp.points, x, textY);
    
    // 標高差ラベル（バーの外側）
    ctx.font = 'bold 11px system-ui';
    ctx.fillStyle = elevDiff > 0 ? '#ef4444' : '#3b82f6';
    const elevText = `${elevDiff > 0 ? '+' : ''}${Math.round(elevDiff)}m`;
    const elevLabelY = elevDiff > 0 ? textY - 20 : textY + 20;
    ctx.fillText(elevText, x, elevLabelY);
  });
  
  // 現在地マーカー（左端）の説明ラベル
  ctx.fillStyle = '#4a5568';
  ctx.font = 'bold 10px system-ui';
  ctx.textAlign = 'left';
  ctx.fillText('現在地', leftMargin + 2, h - 8);
}

function updateSonarNearestInfo() {
  const infoName = document.querySelector('#sonar-nearest-info .info-name');
  const infoDetails = document.querySelector('#sonar-nearest-info .info-details');
  
  if (!infoName || !infoDetails || !currentPosition) {
    if (infoName) infoName.textContent = '最寄りのターゲット';
    if (infoDetails) infoDetails.innerHTML = '<span style="color:#718096;">位置情報を取得中...</span>';
    return;
  }
  
  let nearestCP = null;
  let nearestDist = Infinity;
  
  checkpoints.forEach(cp => {
    if (completedCheckpoints.has(cp.id)) return;
    const d = distance(currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
    if (d < nearestDist) {
      nearestDist = d;
      nearestCP = cp;
    }
  });
  
  if (nearestCP) {
    const elevDiff = (nearestCP.elevation || 650) - (currentPosition.elevation || 650);
    const eta = calculateETA(nearestDist, elevDiff);
    const elevText = elevDiff !== 0 ? ` ${elevDiff > 0 ? '↗+' : '↘'}${Math.abs(Math.round(elevDiff))}m` : '';
    
    infoName.textContent = '最寄りのターゲット';
    infoDetails.innerHTML = `
      <span style="font-size:18px;color:#667eea;font-weight:800;">${nearestCP.name}</span>
      <span>📏 ${Math.round(nearestDist)}m${elevText}</span>
      <span>⏱️ 約${Math.round(eta)}分</span>
      <span style="background:#667eea;color:#fff;padding:4px 12px;border-radius:12px;">⭐ ${nearestCP.points}点</span>
    `;
  } else {
    infoName.textContent = '最寄りのターゲット';
    infoDetails.innerHTML = '<span style="color:#48bb78;font-weight:800;font-size:18px;">🎉 すべてクリア!</span>';
  }
}

function getNearestCheckpointId() {
  if (!currentPosition) return null;
  
  let nearestId = null;
  let nearestDist = Infinity;
  
  checkpoints.forEach(cp => {
    if (completedCheckpoints.has(cp.id)) return;
    const d = distance(currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
    if (d < nearestDist) {
      nearestDist = d;
      nearestId = cp.id;
    }
  });
  
  return nearestId;
}

function getCachedDistance(cpId, lat1, lon1, lat2, lon2) {
  const now = Date.now();
  if (now - sonar.lastCacheTime > 1000) {
    sonar.distanceCache = {};
    sonar.lastCacheTime = now;
  }
  if (!sonar.distanceCache[cpId]) {
    sonar.distanceCache[cpId] = distance(lat1, lon1, lat2, lon2);
  }
  return sonar.distanceCache[cpId];
}

/* ======== Sonar Audio ======== */
function initSonarAudio() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  sonar.audioContext = new AudioContext();
  debugLog('音響システム初期化完了');
}

function playDetectionBeep(distance) {
  if (!sonar.audioContext || !sonar.audioEnabled) return;
  
  const ctx = sonar.audioContext;
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();
  
  // 距離に応じた周波数（近いほど高い音）
  const freq = 400 + (1 - distance / sonar.range) * 400; // 400-800Hz
  oscillator.frequency.value = freq;
  oscillator.type = 'sine';
  
  // 音量（近いほど大きい）
  const volume = (1 - distance / sonar.range) * 0.1;
  gainNode.gain.value = volume;
  
  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);
  
  oscillator.start();
  oscillator.stop(ctx.currentTime + 0.05); // 50msの短いビープ
}

function playScanSound() {
  if (!sonar.audioContext || !sonar.audioEnabled) return;
  
  const ctx = sonar.audioContext;
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();
  
  oscillator.frequency.value = 600;
  oscillator.type = 'sine';
  gainNode.gain.value = 0.03; // 控えめな音量
  
  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);
  
  oscillator.start();
  oscillator.stop(ctx.currentTime + 0.02);
}

function checkScanSound() {
  if (Math.floor(sonar.scanAngle / 360) > Math.floor(sonar.lastScanSoundAngle / 360)) {
    playScanSound();
  }
  sonar.lastScanSoundAngle = sonar.scanAngle;
}

/* ======== Sonar detail modal ======== */
function showSonarDetailModal(cp, dist) {
  if (!currentPosition) return;
  
  const elevDiff = (cp.elevation || 650) - (currentPosition.elevation || 650);
  const eta = calculateETA(dist, elevDiff);
  const brng = bearing(currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
  
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:10000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);animation:fadeIn 0.2s;';
  
  const dialog = document.createElement('div');
  dialog.style.cssText = 'background:#fff;padding:25px;border-radius:16px;max-width:400px;width:90%;box-shadow:0 10px 40px rgba(0,0,0,0.3);';
  
  const title = document.createElement('h3');
  title.textContent = cp.name;
  title.style.cssText = 'margin:0 0 20px 0;font-size:22px;color:#2d3748;font-weight:800;';
  dialog.appendChild(title);
  
  const infoGrid = document.createElement('div');
  infoGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-bottom:20px;';
  
  const addInfoItem = (label, value, icon) => {
    const item = document.createElement('div');
    item.style.cssText = 'background:#f7fafc;padding:12px;border-radius:10px;';
    item.innerHTML = `
      <div style="font-size:12px;color:#718096;margin-bottom:4px;font-weight:600;">${icon} ${label}</div>
      <div style="font-size:18px;color:#2d3748;font-weight:800;">${value}</div>
    `;
    infoGrid.appendChild(item);
  };
  
  addInfoItem('距離', `${Math.round(dist)}m`, '📏');
  addInfoItem('方位', `${Math.round(brng)}°`, '🧭');
  addInfoItem('標高', `${cp.elevation || 650}m`, '⛰️');
  addInfoItem('標高差', `${elevDiff > 0 ? '↗+' : elevDiff < 0 ? '↘' : ''}${Math.abs(Math.round(elevDiff))}m`, '📊');
  addInfoItem('推定時間', `約${Math.round(eta)}分`, '⏱️');
  addInfoItem('ポイント', `${cp.points}点`, '⭐');
  
  dialog.appendChild(infoGrid);
  
  const btnContainer = document.createElement('div');
  btnContainer.style.cssText = 'display:flex;gap:10px;';
  
  const mapBtn = document.createElement('button');
  mapBtn.textContent = '🗺️ 地図で確認';
  mapBtn.style.cssText = 'flex:1;padding:14px;background:#667eea;color:#fff;border:none;border-radius:10px;font-weight:800;cursor:pointer;font-size:15px;';
  mapBtn.onclick = () => {
    document.body.removeChild(modal);
    switchView('map');
    if (map) {
      map.setView([cp.lat, cp.lng], 16);
    }
  };
  btnContainer.appendChild(mapBtn);
  
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '閉じる';
  closeBtn.style.cssText = 'flex:1;padding:14px;background:#cbd5e0;color:#2d3748;border:none;border-radius:10px;font-weight:800;cursor:pointer;font-size:15px;';
  closeBtn.onclick = () => {
    document.body.removeChild(modal);
  };
  btnContainer.appendChild(closeBtn);
  
  dialog.appendChild(btnContainer);
  modal.appendChild(dialog);
  
  // 背景クリックで閉じる
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  });
  
  document.body.appendChild(modal);
  
  debugLog(`CP詳細: ${cp.name}`);
}


/* ======== Tabs ======== */
function switchView(view){
  // AR機能が利用不可の場合
  if (view === 'ar' && !AR_AVAILABLE) {
    alert('AR機能はiPhone/iPadでのみ利用可能です。\n\n現在お使いのデバイスではマップとコンパス機能をご利用ください。');
    return; // ビュー切り替えをキャンセル
  }
  
  currentView = view;
  document.getElementById('map').hidden = view!=='map';
  document.getElementById('compass-view').hidden = view!=='compass';
  document.getElementById('sonar-view').hidden = view!=='sonar';
  document.getElementById('ar-view').hidden = view!=='ar';
  
  for (const b of document.querySelectorAll('#tabs .tab')){
    b.classList.toggle('active', b.dataset.view===view);
  }
  
  if (view==='compass'){ 
    updateCompassContainerSize(); 
    setTimeout(updateCompassDisplay, 100);
    // コンパスモードに切り替え
    if (orientationManager) {
      orientationManager.setMode('compass');
    }
  }
  
  if (view==='sonar'){
    initSonar();
    resizeSonarCanvas();
    sonar.lastUpdateTime = 0;
    sonar.scanAngle = 0;
    requestAnimationFrame(sonarLoop);
    debugLog('ソナービュー開始');
  } else {
    if (sonar.animationId) {
      cancelAnimationFrame(sonar.animationId);
      sonar.animationId = null;
    }
  }
  
  if (view==='ar'){ 
    startAR(); 
    // ARモードに切り替え
    if (orientationManager) {
      orientationManager.setMode('ar');
    }
  } else { 
    stopAR(); 
  }
}

document.getElementById('tab-map')?.addEventListener('click', ()=>switchView('map'));
document.getElementById('tab-compass')?.addEventListener('click', ()=>switchView('compass'));
document.getElementById('tab-sonar')?.addEventListener('click', ()=>switchView('sonar'));
document.getElementById('tab-ar')?.addEventListener('click', ()=>switchView('ar'));

// Sonar range buttons
for (const btn of document.querySelectorAll('#sonar-view .range-btn')){
  btn.addEventListener('click', ()=>{
    for (const b of document.querySelectorAll('#sonar-view .range-btn')) b.classList.remove('active');
    btn.classList.add('active');
    sonar.range = Number(btn.dataset.range);
    sonar.distanceCache = {};
    const label = sonar.range >= 1000 ? `${sonar.range/1000}km` : `${sonar.range}m`;
    document.getElementById('sonar-max-distance').textContent = label;
    debugLog(`ソナーレンジ: ${label}`);
  });
}

/* ======== Camera selection ======== */
async function getCameraDevices(){
  try{
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(d => d.kind === 'videoinput');
  }catch(e){
    debugLog('カメラデバイス取得エラー: ' + e.message);
    return [];
  }
}

async function showCameraSelector(){
  const cameras = await getCameraDevices();
  if (cameras.length <= 1) return null;
  
  return new Promise((resolve, reject) => {
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:10000;display:flex;align-items:center;justify-content:center;';
    
    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:#fff;padding:20px;border-radius:12px;max-width:400px;width:90%;';
    
    const title = document.createElement('h3');
    title.textContent = 'カメラを選択';
    title.style.marginBottom = '15px';
    dialog.appendChild(title);
    
    const list = document.createElement('div');
    cameras.forEach((cam, idx) => {
      const btn = document.createElement('button');
      btn.textContent = cam.label || `カメラ ${idx+1}`;
      btn.style.cssText = 'display:block;width:100%;padding:12px;margin:8px 0;background:#667eea;color:#fff;border:none;border-radius:8px;cursor:pointer;';
      btn.onclick = ()=>{
        ar.selectedCameraId = cam.deviceId;
        saveToLocalStorage();
        document.body.removeChild(modal);
        resolve(cam.deviceId);
      };
      list.appendChild(btn);
    });
    dialog.appendChild(list);
    
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'キャンセル';
    cancelBtn.style.cssText = 'display:block;width:100%;padding:12px;margin:8px 0;background:#cbd5e0;color:#2d3748;border:none;border-radius:8px;cursor:pointer;';
    cancelBtn.onclick = ()=>{
      document.body.removeChild(modal);
      resolve(null);
    };
    dialog.appendChild(cancelBtn);
    
    modal.appendChild(dialog);
    document.body.appendChild(modal);
  });
}

/* ======== AR helper functions ======== */
function isInView(relativeBearing, elevationAngle){
  const fovH = ar.fovH * 180 / Math.PI;
  const fovV = ar.fovV * 180 / Math.PI;
  return Math.abs(relativeBearing) < fovH / 2 && Math.abs(elevationAngle * 180 / Math.PI) < fovV / 2;
}

function getMarkerSizeByRange(){
  if (ar.range <= 250) return { marker: 50, font: 16 };
  if (ar.range <= 500) return { marker: 50, font: 16 };
  if (ar.range <= 1000) return { marker: 40, font: 14 };
  if (ar.range <= 2500) return { marker: 30, font: 12 };
  return { marker: 30, font: 12 };
}

function getCachedDistance(cpId, lat1, lon1, lat2, lon2){
  const now = Date.now();
  if (now - ar.lastCacheTime > 1000) {
    ar.distanceCache = {};
    ar.lastCacheTime = now;
  }
  if (!ar.distanceCache[cpId]) {
    ar.distanceCache[cpId] = distance(lat1, lon1, lat2, lon2);
  }
  return ar.distanceCache[cpId];
}

/* ======== AR (camera + overlay) - iOS専用 ======== */
async function startAR(){
  // iOS専用チェック（念のため）
  if (!AR_AVAILABLE) {
    debugLog('AR機能は利用できません');
    return;
  }
  
  const video = document.getElementById('camera');
  const canvas = document.getElementById('ar-canvas');
  const ctx = canvas.getContext('2d');
  ar.video = video; ar.canvas = canvas; ar.ctx = ctx;
  
  try{
    // iOSでは背面カメラを優先
    const constraints = { 
      video: { 
        facingMode: { exact: 'environment' }, 
        width: { ideal: 1920 }, 
        height: { ideal: 1080 } 
      }, 
      audio: false 
    };
    
    ar.stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = ar.stream;
    await video.play();
    resizeARCanvas();
    startARTimer();
    ar.lastFrameTime = performance.now();
    requestAnimationFrame(arLoop);
    debugLog('📷 カメラ開始 (AR iOS)');
  }catch(e){
    debugLog('カメラ起動に失敗: ' + e.message);
    // iOSではフロントカメラにフォールバック
    try {
      const fallbackConstraints = { 
        video: { facingMode: 'user' }, 
        audio: false 
      };
      ar.stream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
      video.srcObject = ar.stream;
      await video.play();
      resizeARCanvas();
      startARTimer();
      ar.lastFrameTime = performance.now();
      requestAnimationFrame(arLoop);
      debugLog('📷 フロントカメラで開始 (AR iOS)');
    } catch(e2) {
      alert('カメラの使用許可が必要です。\n設定 → Safari → カメラを確認してください。');
      switchView('compass');
    }
  }
}

function stopAR(){
  if (ar.stream){ ar.stream.getTracks().forEach(t=>t.stop()); ar.stream=null; }
  if (ar.timerId){ clearInterval(ar.timerId); ar.timerId=null; }
  ar.distanceCache = {};
}

function resizeARCanvas(){
  const rect = document.getElementById('ar-view').getBoundingClientRect();
  ar.canvas.width = rect.width; ar.canvas.height = rect.height;
}

window.addEventListener('resize', ()=>{ 
  updateCompassContainerSize(); 
  if(currentView==='ar') resizeARCanvas();
  if(currentView==='sonar') resizeSonarCanvas();
});

function arLoop(currentTime){
  if (currentView!=='ar') return;
  
  // FPS制限
  if (currentTime - ar.lastFrameTime < 1000 / ar.fpsLimit) {
    requestAnimationFrame(arLoop);
    return;
  }
  ar.lastFrameTime = currentTime;
  
  const ctx = ar.ctx;
  const w = ar.canvas.width, h = ar.canvas.height;
  ctx.clearRect(0,0,w,h);

  if (!currentPosition){ requestAnimationFrame(arLoop); return; }

  // 方位テープをCanvasに描画
  const tapeHeight = 50;
  const tapeY = 0;
  
  // 半透明背景
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, tapeY, w, tapeHeight);
  
  // 方位目盛りとラベルを描画
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 16px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  
  // FOVに応じた表示範囲を計算（FOVの半分±余裕）
  const fovHDeg = ar.fovH * 180 / Math.PI;
  const displayRange = fovHDeg / 2 + 10; // 視野角の半分+余裕10度
  
  // 5度刻みで目盛りを描画
  for (let offset = -displayRange; offset <= displayRange; offset += 5) {
    const angle = (smoothedHeading + offset + 360) % 360;
    const normalizedOffset = offset / fovHDeg;  // FOVで正規化
    const x = w/2 + normalizedOffset * w;
    
    // 画面外は描画しない
    if (x < 0 || x > w) continue;
    
    // 主要方位（N/E/S/W）
    if (Math.abs(angle - 0) < 2.5 || Math.abs(angle - 360) < 2.5) {
      ctx.fillStyle = '#ff3030';
      ctx.font = 'bold 20px system-ui';
      ctx.fillText('N', x, tapeHeight/2);
      // 赤い線
      ctx.strokeStyle = 'rgba(255,48,48,0.8)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, tapeHeight - 15);
      ctx.lineTo(x, tapeHeight);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px system-ui';
    } else if (Math.abs(angle - 90) < 2.5) {
      ctx.fillText('E', x, tapeHeight/2);
    } else if (Math.abs(angle - 180) < 2.5) {
      ctx.fillText('S', x, tapeHeight/2);
    } else if (Math.abs(angle - 270) < 2.5) {
      ctx.fillText('W', x, tapeHeight/2);
    }
    
    // 目盛り線（5度刻み）
    const isCardinal = Math.abs(angle - 0) < 2.5 || Math.abs(angle - 90) < 2.5 || 
                      Math.abs(angle - 180) < 2.5 || Math.abs(angle - 270) < 2.5 || 
                      Math.abs(angle - 360) < 2.5;
    if (offset % 5 === 0 && !isCardinal) {
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = offset % 15 === 0 ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x, tapeHeight - 10);
      ctx.lineTo(x, tapeHeight);
      ctx.stroke();
    }
  }
  
  // ピッチインジケーターを更新
  updatePitchIndicator();

  // 最寄りCPの情報を更新
  let nearestCP = null;
  let nearestDist = Infinity;
  checkpoints.forEach(cp => {
    if (completedCheckpoints.has(cp.id)) return;
    const d = getCachedDistance(cp.id, currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
    if (d < nearestDist) {
      nearestDist = d;
      nearestCP = cp;
    }
  });
  
  const nearestInfo = document.getElementById('nearest-cp-info');
  if (nearestInfo && nearestCP) {
    const elevDiff = (nearestCP.elevation ?? 650) - (currentPosition.elevation ?? 650);
    const eta = calculateETA(nearestDist, elevDiff);
    const elevText = elevDiff !== 0 ? ` ${elevDiff > 0 ? '↗+' : '↘'}${Math.abs(Math.round(elevDiff))}m` : '';
    nearestInfo.textContent = `→ ${nearestCP.name} ${Math.round(nearestDist)}m${elevText} ETA: 約${Math.round(eta)}分`;
  }

  // レンジ基準のマーカーサイズ取得
  const sizes = getMarkerSizeByRange();
  
  // デバッグ用カウンター
  let visibleCount = 0;
  let debugInfo = [];

  checkpoints.forEach(cp => {
    // 距離計算（キャッシュ使用）
    const d = getCachedDistance(cp.id, currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
    
    // 方位計算（iOSでは直接取得可能）
    const b = bearing(currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
    const actualHeading = orientationManager ? orientationManager.getHeading() : smoothedHeading;
    let rel = ((b - actualHeading + 540) % 360) - 180; // -180～180
    
    // 標高差と仰角計算
    const elevDiff = (cp.elevation ?? 650) - (currentPosition.elevation ?? 650);
    const horiz = Math.max(1, d);
    const elevAngle = Math.atan2(elevDiff, horiz);
    
    // デバイスのピッチ角を補正（90°を0°として扱う）
    const correctedPitch = devicePitch - 90;
    const devicePitchRad = correctedPitch * Math.PI / 180;
    const screenElevAngle = elevAngle - devicePitchRad;
    
    // デバッグ情報を収集（デバッグモード時のみ）
    if (ar.debugMode && debugInfo.length < 3) { // 最初の3つのCPのみ
      const inRange = d <= ar.range;
      debugInfo.push({
        name: cp.name,
        dist: Math.round(d),
        rel: Math.round(rel),
        elev: Math.round(screenElevAngle * 180 / Math.PI),
        inRange
      });
    }
    
    // レンジ外は早期リターン
    if (d > ar.range) return;
    
    // 視野判定を削除（安定性のため）
    visibleCount++;
    
    // 画面座標計算（ピッチ補正済み）
    // 相対方位角をラジアンに変換
    const relRad = rel * Math.PI / 180;
    // FOV範囲内での正規化位置を計算
    const x = w/2 + (relRad / ar.fovH) * w;
    const y = h/2 - screenElevAngle / ar.fovV * h;

    // マーカー描画
    const r = sizes.marker / 2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI*2);
    ctx.fillStyle = completedCheckpoints.has(cp.id) ? '#48bb78' : '#667eea';
    ctx.fill();
    
    // ETA計算
    const eta = calculateETA(d, elevDiff);
    const etaText = `~${Math.round(eta)}分`;
    
    // ラベル描画
    ctx.font = `bold ${sizes.font}px system-ui, -apple-system`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,.6)';
    ctx.lineWidth = 4;
    
    const elevText = elevDiff !== 0 ? ` ${elevDiff > 0 ? '+' : ''}${Math.round(elevDiff)}m` : '';
    const label = `${cp.name} ${Math.round(d)}m${elevText} ${etaText}`;
    
    ctx.strokeText(label, x, y + r + 4);
    ctx.fillText(label, x, y + r + 4);
  });
  
  // デバッグ情報を画面に表示（デバッグモードONの時のみ）
  if (ar.debugMode) {
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(10, 10, 280, 180);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'left';
    
    let y = 25;
    
    // iOS専用情報
    ctx.fillText('📱 iOS AR Mode', 15, y); y += 15;
    
    // OrientationManager情報
    if (orientationManager) {
      const debugInfo = orientationManager.getDebugInfo();
      ctx.fillText(`Heading: ${debugInfo.heading}°`, 15, y); y += 15;
      ctx.fillText(`Accuracy: ${debugInfo.accuracy}`, 15, y); y += 15;
      ctx.fillText(`Confidence: ${debugInfo.confidence}`, 15, y); y += 15;
      ctx.fillText(`Pitch: ${debugInfo.beta}°`, 15, y); y += 15;
    }
    
    ctx.fillText(`Range: ${ar.range}m`, 15, y); y += 15;
    ctx.fillText(`FOV: ${Math.round(ar.fovH*180/Math.PI)}°`, 15, y); y += 15;
    ctx.fillText(`Visible: ${visibleCount}/${checkpoints.length}`, 15, y); y += 15;
    
    // 個別CP情報（デバッグ用）
    if (debugInfo.length > 0) {
      ctx.font = '10px monospace';
      debugInfo.slice(0, 2).forEach((info) => {
        ctx.fillText(`${info.name.substring(0,10)}: ${info.dist}m`, 15, y);
        y += 13;
      });
    }
  }
  
  // 個別CP情報
  ctx.font = '10px monospace';
  debugInfo.forEach((info, i) => {
    const status = info.inRange ? 'OK' : 'FAR';
    ctx.fillText(`${info.name.substring(0,8)} ${info.dist}m R:${info.rel}° E:${info.elev}° ${status}`, 15, y);
    y += 13;
  });

  requestAnimationFrame(arLoop);
}

for (const btn of document.querySelectorAll('.ar-range-selector .range-btn')){
  btn.addEventListener('click', ()=>{
    for (const b of document.querySelectorAll('.ar-range-selector .range-btn')) b.classList.remove('active');
    btn.classList.add('active');
    ar.range = Number(btn.dataset.range);
    ar.distanceCache = {}; // キャッシュクリア
    const label = ar.range >= 1000 ? `${ar.range/1000}km` : `${ar.range}m`;
    document.getElementById('max-distance-label').textContent = label;
    debugLog(`AR表示レンジ: ${label}`);
  });
}

for (const btn of document.querySelectorAll('.fov-btn')){
  btn.addEventListener('click', ()=>{
    for (const b of document.querySelectorAll('.fov-btn')) b.classList.remove('active');
    btn.classList.add('active');
    const fovType = btn.dataset.fov;
    ar.selectedFov = fovType;
    const preset = ar.fovPresets[fovType];
    ar.fovH = preset.h * Math.PI / 180;
    ar.fovV = preset.v * Math.PI / 180;
    debugLog(`AR視野角: ${preset.label} (${preset.h}°×${preset.v}°)`);
  });
}

function startARTimer(){
  ar.secondsLeft = 300;
  document.getElementById('ar-remaining').textContent = '05:00';
  if (ar.timerId) clearInterval(ar.timerId);
  ar.timerId = setInterval(()=>{
    ar.secondsLeft--;
    const m = String(Math.floor(ar.secondsLeft/60)).padStart(2,'0');
    const s = String(ar.secondsLeft%60).padStart(2,'0');
    document.getElementById('ar-remaining').textContent = `${m}:${s}`;
    
    // 段階的機能制限（3分経過で警告）
    if (ar.secondsLeft === 120) {
      debugLog('⚠️ AR残り2分：バッテリー節約のため間もなく終了します');
    }
    
    if (ar.secondsLeft<=0){
      clearInterval(ar.timerId); ar.timerId=null;
      alert('ARモードを終了します(5分経過)');
      switchView('compass');
    }
  }, 1000);
}

/* ======== Debug mode toggle button ======== */
const debugToggleBtn = document.createElement('button');
debugToggleBtn.textContent = '🛠';
debugToggleBtn.style.cssText = 'position:absolute;top:10px;right:10px;background:rgba(0,0,0,.5);color:#fff;border:none;padding:10px 15px;border-radius:8px;cursor:pointer;z-index:1000;';
debugToggleBtn.onclick = ()=>{
  ar.debugMode = !ar.debugMode;
  debugToggleBtn.style.backgroundColor = ar.debugMode ? 'rgba(255,0,0,.5)' : 'rgba(0,0,0,.5)';
  debugLog(`ARデバッグモード: ${ar.debugMode ? 'ON' : 'OFF'}`);
};
document.getElementById('ar-view')?.appendChild(debugToggleBtn);

/* ======== Events ======== */
document.getElementById('get-location-btn')?.addEventListener('click', getCurrentLocation);
document.getElementById('photo-btn')?.addEventListener('click', ()=>document.getElementById('photo-input').click());
document.getElementById('photo-input')?.addEventListener('change', handlePhoto);
document.getElementById('check-button')?.addEventListener('click', checkNearby);
document.getElementById('tracking-button')?.addEventListener('click', toggleTracking);
document.getElementById('clear-button')?.addEventListener('click', clearLocalStorage);

document.addEventListener('click', (e) => {
  if (activeTooltip && !e.target.classList.contains('checkpoint-marker') && 
      !e.target.classList.contains('distance-marker')) {
    hideTooltip();
  }
});

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
  startTimer();
  if (trackingEnabled) {
    startTracking();
  }
  document.getElementById('max-distance-label').textContent = '1km';
  
  // AR機能の可用性チェック
  if (!AR_AVAILABLE) {
    const arTab = document.getElementById('tab-ar');
    if (arTab) {
      arTab.style.opacity = '0.4';
      arTab.style.cursor = 'not-allowed';
      arTab.innerHTML = '📷 AR<br><span style="font-size:9px">iOS専用</span>';
    }
    debugLog('📱 AR機能: iOS専用（現在のデバイス: ' + (IS_IOS ? 'iOS' : 'その他') + '）');
  } else {
    debugLog('✅ AR機能: 利用可能（iOS検出）');
  }
  
  debugLog('アプリケーション初期化完了');
})();
