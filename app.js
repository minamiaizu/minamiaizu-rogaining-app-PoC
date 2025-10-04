/**
 * app.js - オーケストレーション層
 * 依存性注入パターン実装済み
 * iOS 13+のセンサー権限リクエスト対応
 * 
 * 改修: AR最寄りCP情報セクションの表示制御を追加
 * 改修日: 2025-10-04
 */

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

/* ======== グローバル変数 ======== */
let currentView = 'map';
let timerInterval = null;
let isOnline = navigator.onLine;
let arCapable = false;

/* ======== マネージャーインスタンス ======== */
let stateMgr, geoMgr, compassView, sonarView, arView, orientationMgr;

/* ======== 初期化 ======== */
async function init() {
  debugLog('🚀 アプリケーション初期化開始');
  
  // 1. データ読み込み
  stateMgr = new StateManager();
  await stateMgr.loadCheckpoints();
  await stateMgr.loadConfig();
  
  // 2. OrientationManager初期化
  orientationMgr = new OrientationManager();
  orientationMgr.onUpdate = handleOrientationUpdate;
  orientationMgr.onModeChange = handleOrientationModeChange;
  
  // iOS権限チェック
  if (orientationMgr.needsIOSPermission()) {
    debugLog('📱 iOS 13+: センサー権限が必要です');
    showIOSPermissionPrompt();
    // センサーは権限取得後に初期化される
  } else {
    // iOS以外、またはiOS 12以下は通常通り初期化
    await orientationMgr.init();
  }
  
  // 3. AR可用性チェック
  arCapable = await checkARCapability();
  
  // 4. その他のマネージャー
  geoMgr = new GeoManager();
  
  // 5. データ復元
  const restored = stateMgr.load();
  if (restored) {
    debugLog('💾 データ復元完了');
  }
  
  // 6. 地図初期化
  const mapConfig = stateMgr.config?.map || {};
  geoMgr.initMap('map', 
    [mapConfig.defaultCenter?.lat || 37.203, mapConfig.defaultCenter?.lng || 139.774],
    mapConfig.defaultZoom || 14
  );
  geoMgr.addCheckpointMarkers(stateMgr.checkpoints, stateMgr.completedIds);
  
  // 7. ビュー初期化(マネージャーを注入)
  compassView = new CompassView({
    containerId: 'compass-view',
    geoMgr: geoMgr
  });
  compassView.init();
  
  const sonarConfig = stateMgr.config?.sonar || {};
  sonarView = new SonarView({
    range: sonarConfig.defaultRange || 1000,
    audioEnabled: sonarConfig.audioEnabled || false,
    stateMgr: stateMgr,
    geoMgr: geoMgr,
    orientationMgr: orientationMgr
  });
  sonarView.init();
  
  if (arCapable) {
    const arConfig = stateMgr.config?.ar || {};
    arView = new ARView({
      range: arConfig.defaultRange || 1000,
      timerDuration: arConfig.timeLimitSeconds || 300,
      stateMgr: stateMgr,
      geoMgr: geoMgr,
      orientationMgr: orientationMgr
    });
    debugLog('✅ ARビュー初期化');
  } else {
    const arTab = document.getElementById('tab-ar');
    if (arTab) {
      arTab.style.opacity = '0.4';
      arTab.style.cursor = 'not-allowed';
      arTab.innerHTML = '📷 AR<br><span style="font-size:9px">センサー未対応</span>';
    }
    debugLog('⚠️ AR非対応デバイス');
  }
  
  // 8. PWA, イベント, UI更新, タイマー
  await initPWA();
  setupEventListeners();
  updateUI();
  startTimer();
  updateOnlineStatus();
  
  // 9. キャリブレーションUIチェック
  checkCalibrationUI();
  
  // ========== 自動起動処理(追加) ==========
  // 現在地を自動取得
  //getCurrentLocation().catch(err => {
  //  debugLog(`⚠️ 自動位置取得失敗: ${err.message}`);
  //});
  
  // 軌跡記録を自動開始
  startTracking();
  
  debugLog('🎉 アプリケーション初期化完了');
}

/* ======== iOS権限プロンプト表示 ======== */
function showIOSPermissionPrompt() {
  const prompt = document.getElementById('ios-permission-prompt');
  if (prompt) {
    prompt.hidden = false;
    debugLog('📱 iOS権限プロンプトを表示');
  }
}

function hideIOSPermissionPrompt() {
  const prompt = document.getElementById('ios-permission-prompt');
  if (prompt) {
    prompt.hidden = true;
  }
}

/* ======== iOS権限リクエスト処理 ======== */
async function handleIOSPermissionRequest() {
  debugLog('📱 iOS権限リクエストを実行...');
  
  const result = await orientationMgr.requestIOSPermission();
  
  if (result.success) {
    debugLog('✅ iOS権限取得成功');
    hideIOSPermissionPrompt();
    
    showNotification({
      type: 'success',
      message: '✅ センサーへのアクセスが許可されました',
      duration: 3000
    });
    
    // キャリブレーションUIチェック
    checkCalibrationUI();
  } else if (result.permission === 'denied') {
    debugLog('❌ iOS権限が拒否されました');
    hideIOSPermissionPrompt();
    
    alert(
      '⚠️ センサーへのアクセスが拒否されました\n\n' +
      'コンパス、AR、ソナー機能を使用するには、\n' +
      'Safari設定 > プライバシーとセキュリティ > モーションと画面の向き\n' +
      'から許可してください。\n\n' +
      'その後、ページを再読み込みしてください。'
    );
  } else {
    debugLog(`❌ iOS権限リクエスト失敗: ${result.error || 'unknown'}`);
    hideIOSPermissionPrompt();
    
    alert(
      '❌ センサー権限の取得に失敗しました\n\n' +
      'ページを再読み込みして、もう一度お試しください。'
    );
  }
}

/* ======== AR可用性チェック ======== */
async function checkARCapability() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const hasCamera = devices.some(d => d.kind === 'videoinput');
    if (!hasCamera) {
      debugLog('❌ カメラなし');
      return false;
    }
  } catch (error) {
    debugLog(`❌ カメラチェック失敗: ${error.message}`);
    return false;
  }
  
  const mode = orientationMgr.getMode();
  if (!mode || mode === 'relative') {
    debugLog('⚠️ AR推奨センサーなし(相対モード)');
    return true;
  }
  
  return true;
}

/* ======== OrientationManagerコールバック ======== */
function handleOrientationUpdate(data) {
  const { heading, pitch } = data;
  
  const currentPosition = stateMgr.currentPosition;
  if (!currentPosition) return;
  
  if (currentView === 'compass') {
    compassView.updateHeading(heading);
    compassView.updateCheckpointMarkers(
      currentPosition, heading, stateMgr.checkpoints, stateMgr.completedIds
    );
  } else if (currentView === 'sonar') {
    sonarView.update(currentPosition, heading, stateMgr.checkpoints, stateMgr.completedIds);
  } else if (currentView === 'ar' && arView) {
    arView.update(currentPosition, heading, pitch);
    arView.updateSensorMode(data.mode);
  }
}

function handleOrientationModeChange(data) {
  debugLog(`🔄 センサーモード変更: ${data.mode}`);
  
  checkCalibrationUI();
  
  if (data.mode === 'relative' && !data.isCalibrated) {
    showNotification({
      type: 'warning',
      message: '相対モードで動作中。正確な方位にはキャリブレーションが必要です。',
      duration: 5000
    });
  }
}

/* ======== キャリブレーションUI ======== */
function checkCalibrationUI() {
  const calibrationPrompt = document.getElementById('calibration-prompt');
  if (!calibrationPrompt) return;
  
  if (orientationMgr.needsCalibration()) {
    calibrationPrompt.hidden = false;
  } else {
    calibrationPrompt.hidden = true;
  }
}

function handleCalibrate() {
  const result = orientationMgr.calibrate();
  
  if (result.success) {
    alert('✅ キャリブレーション完了\n\n現在の向きを「北」として設定しました。');
    checkCalibrationUI();
  } else {
    if (result.reason === 'absolute-mode') {
      alert('ℹ️ このデバイスは絶対モードで動作しているため、キャリブレーションは不要です。');
    } else {
      alert('❌ キャリブレーションに失敗しました。');
    }
  }
}

/* ======== イベントリスナー ======== */
function setupEventListeners() {
  // iOS権限リクエスト
  document.getElementById('request-ios-permission')?.addEventListener('click', handleIOSPermissionRequest);
  document.getElementById('close-ios-permission')?.addEventListener('click', () => {
    hideIOSPermissionPrompt();
    showNotification({
      type: 'warning',
      message: '⚠️ センサー権限が未許可です。コンパス/AR/ソナーは使用できません。',
      duration: 5000
    });
  });
  
  document.getElementById('get-location-btn')?.addEventListener('click', getCurrentLocation);
  
  document.getElementById('photo-btn')?.addEventListener('click', () => {
    document.getElementById('photo-input').click();
  });
  document.getElementById('photo-input')?.addEventListener('change', handlePhoto);
  
  document.getElementById('check-button')?.addEventListener('click', checkNearby);
  document.getElementById('tracking-button')?.addEventListener('click', toggleTracking);
  document.getElementById('clear-button')?.addEventListener('click', clearData);
  
  document.getElementById('tab-map')?.addEventListener('click', () => switchView('map'));
  document.getElementById('tab-compass')?.addEventListener('click', () => switchView('compass'));
  document.getElementById('tab-sonar')?.addEventListener('click', () => switchView('sonar'));
  document.getElementById('tab-ar')?.addEventListener('click', () => switchView('ar'));
  
  document.getElementById('calibrate-button')?.addEventListener('click', handleCalibrate);
  
  document.getElementById('clear-calibration-button')?.addEventListener('click', () => {
    if (confirm('キャリブレーションをリセットしますか?')) {
      orientationMgr.clearCalibration();
      checkCalibrationUI();
    }
  });
  
  document.getElementById('photo-close')?.addEventListener('click', () => {
    document.getElementById('photo-modal').hidden = true;
  });
  
  document.querySelectorAll('#sonar-view .range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#sonar-view .range-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const range = Number(btn.dataset.range);
      sonarView.setRange(range);
      const label = range >= 1000 ? `${range/1000}km` : `${range}m`;
      document.getElementById('sonar-max-distance').textContent = label;
    });
  });
  
  document.querySelectorAll('.ar-range-selector .range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ar-range-selector .range-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const range = Number(btn.dataset.range);
      if (arView) {
        arView.setRange(range);
      }
    });
  });
  
  document.querySelectorAll('.fov-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.fov-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const fovType = btn.dataset.fov;
      if (arView) {
        arView.setFOV(fovType);
      }
    });
  });
  
  window.addEventListener('resize', () => {
    if (compassView) compassView.updateSize();
    if (currentView === 'ar' && arView) arView._resizeCanvas();
    if (currentView === 'sonar') sonarView.resizeCanvas();
  });
  
  document.addEventListener('click', (e) => {
    if (compassView && !e.target.classList.contains('checkpoint-marker') && 
        !e.target.classList.contains('distance-marker')) {
      compassView.hideTooltip();
    }
  });
}

/* ======== 位置情報取得 ======== */
function getCurrentLocation() {
  debugLog('📍 位置情報取得を開始...');
  
  if (location.protocol === 'http:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    alert('HTTPSでないため位置情報を取得できません。');
    return;
  }
  
  geoMgr.getCurrentPosition()
    .then(position => {
      stateMgr.setPosition(position);
      geoMgr.updateCurrentPositionMarker(position);
      geoMgr.centerOnCurrentPosition(position);
      
      document.getElementById('gps-status').textContent = '取得済み';
      document.getElementById('gps-accuracy').textContent = `±${position.accuracy.toFixed(1)}m`;
      document.getElementById('check-button').disabled = false;
      
      updateUI();
      stateMgr.save();
    })
    .catch(err => {
      alert('位置情報の取得に失敗しました。');
    });
}

/* ======== 写真撮影 ======== */
async function handlePhoto(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  try {
    const dataUrl = await compressImage(file, 1280, 0.6);
    stateMgr.addPhoto(dataUrl, stateMgr.currentPosition);
    
    updateUI();
    stateMgr.save();
    
    e.target.value = '';
  } catch (error) {
    debugLog(`❌ 写真処理エラー: ${error.message}`);
    alert('写真の処理に失敗しました。');
  }
}

function compressImage(file, maxWidth = 1280, quality = 0.6) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxWidth) { h = h * maxWidth / w; w = maxWidth; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('画像読込失敗'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('ファイル読込失敗'));
    reader.readAsDataURL(file);
  });
}

/* ======== チェックポイント確認 ======== */
function checkNearby() {
  const result = stateMgr.checkNearby(stateMgr.currentPosition, stateMgr.photos);
  
  if (result.success) {
    result.checkpoints.forEach(({ checkpoint }) => {
      geoMgr.updateCheckpointMarker(checkpoint.id, true);
    });
    alert(`🎉 チェックポイントをクリア!\n${result.message}`);
  } else {
    alert(result.message);
  }
  
  updateUI();
  stateMgr.save();
}

/* ======== トラッキング ======== */
function toggleTracking() {
  if (stateMgr.isTrackingEnabled()) {
    stopTracking();
  } else {
    startTracking();
  }
}

function startTracking() {
  stateMgr.setTrackingEnabled(true);
  
  geoMgr.startWatchPosition((position) => {
    stateMgr.setPosition(position);
    stateMgr.addTrackPoint(position);
    
    geoMgr.updateCurrentPositionMarker(position);
    geoMgr.updateTrackPolyline(stateMgr.trackPoints);
    
    updateUI();
    
    if (stateMgr.trackPoints.length % 5 === 0) {
      stateMgr.save();
    }
  }, {
    enableHighAccuracy: false,
    timeout: 10000,
    maximumAge: 0
  });
  
  updateTrackingButton();
  debugLog('軌跡記録を開始');
}

function stopTracking() {
  stateMgr.setTrackingEnabled(false);
  geoMgr.stopWatchPosition();
  updateTrackingButton();
  stateMgr.save();
  debugLog('軌跡記録を停止');
}

function updateTrackingButton() {
  const btn = document.getElementById('tracking-button');
  if (!btn) return;
  
  if (stateMgr.isTrackingEnabled()) {
    btn.textContent = '⏸️ 軌跡記録を停止';
    btn.classList.remove('button-success');
    btn.classList.add('danger');
    btn.style.background = '#48bb78';
  } else {
    btn.textContent = '▶️ 軌跡記録を開始';
    btn.classList.remove('danger');
    btn.classList.add('button-success');
    btn.style.background = '#ed8936';
  }
}

/* ======== データリセット ======== */
function clearData() {
  if (confirm('保存されているデータをすべて削除しますか?')) {
    stateMgr.clear();
    location.reload();
  }
}

/* ======== タイマー ======== */
function startTimer() {
  const update = () => {
    const remaining = stateMgr.getRemainingTime();
    const h = Math.floor(remaining / 3600);
    const m = Math.floor((remaining % 3600) / 60);
    const s = remaining % 60;
    document.getElementById('timer').textContent = 
      `残り時間: ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    
    if (stateMgr.decrementTime() <= 0) {
      clearInterval(timerInterval);
      alert('制限時間終了!');
      debugLog('競技終了');
      stateMgr.save();
    }
    
    if (remaining % 30 === 0) {
      stateMgr.save();
    }
  };
  
  update();
  timerInterval = setInterval(update, 1000);
}

/* ======== UI更新 ======== */
function updateUI() {
  const totalScore = stateMgr.getTotalScore();
  document.getElementById('score').textContent = `得点: ${totalScore}点`;
  
  document.getElementById('photo-count').textContent = `${stateMgr.photos.length}枚`;
  document.getElementById('track-count').textContent = `${stateMgr.trackPoints.length}個`;
  document.getElementById('cleared-count').textContent = 
    `${stateMgr.completedIds.size} / ${stateMgr.checkpoints.length}`;
  
  renderCheckpoints();
  renderPhotoGallery();
}

function renderCheckpoints() {
  const container = document.getElementById('checkpoints');
  if (!container) return;
  
  container.innerHTML = '';
  const currentPosition = stateMgr.currentPosition;
  
  stateMgr.checkpoints.forEach(cp => {
    const div = document.createElement('div');
    div.className = 'checkpoint-item';
    
    if (stateMgr.isCompleted(cp.id)) {
      div.classList.add('completed');
    } else if (currentPosition) {
      const d = geoMgr.distance(currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
      if (d <= 150) div.classList.add('near');
    }
    
    const distText = currentPosition 
      ? `${geoMgr.distance(currentPosition.lat, currentPosition.lng, cp.lat, cp.lng).toFixed(0)}m`
      : '';
    
    const trackingWarning = !stateMgr.isTrackingEnabled() 
      ? ' <span style="color:#e53e3e;">(更新停止中)</span>' 
      : '';
    
    div.innerHTML = `
      <div>
        <div class="checkpoint-name">${stateMgr.isCompleted(cp.id) ? '✓ ' : ''}${cp.name}</div>
        ${currentPosition ? `<div style="font-size:12px;color:#718096;margin-top:4px;">${distText}${trackingWarning}</div>` : ''}
      </div>
      <div class="checkpoint-points">${cp.points}点</div>
    `;
    
    container.appendChild(div);
  });
}

function renderPhotoGallery() {
  const grid = document.getElementById('photo-grid');
  if (!grid) return;
  
  grid.innerHTML = '';
  
  if (!stateMgr.photos.length) {
    grid.innerHTML = '<p style="color:#718096;text-align:center;padding:20px;">写真はまだありません</p>';
    return;
  }
  
  stateMgr.photos.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'photo-thumbnail';
    div.addEventListener('click', () => openPhotoModal(p.dataUrl));
    
    const img = document.createElement('img');
    img.src = p.dataUrl;
    img.alt = `写真 ${i+1}`;
    
    const info = document.createElement('div');
    info.className = 'photo-info';
    const time = new Date(p.timestamp).toLocaleTimeString('ja-JP', {hour:'2-digit', minute:'2-digit'});
    info.textContent = time;
    
    div.appendChild(img);
    div.appendChild(info);
    grid.appendChild(div);
  });
}

function openPhotoModal(src) {
  const modal = document.getElementById('photo-modal');
  const img = document.getElementById('modal-image');
  img.src = src;
  modal.hidden = false;
}

/* ======== ビュー切替 ======== */
function switchView(view) {
  // iOS権限チェック
  if ((view === 'compass' || view === 'sonar' || view === 'ar') && orientationMgr.needsIOSPermission()) {
    showIOSPermissionPrompt();
    return;
  }
  
  if (view === 'ar' && !arCapable) {
    alert('AR機能は利用できません。\n\n原因:\n・カメラがない\n・センサーが非対応\n・権限が拒否されている');
    return;
  }
  
  if ((view === 'compass' || view === 'sonar' || view === 'ar') && orientationMgr.needsCalibration()) {
    const proceed = confirm(
      '⚠️ キャリブレーションが未実施です。\n\n' +
      '相対モードで動作するため、方位が正確でない可能性があります。\n' +
      'キャリブレーションを実施することを推奨します。\n\n' +
      'このまま続行しますか?'
    );
    if (!proceed) return;
  }
  
  currentView = view;
  
  document.getElementById('map').hidden = view !== 'map';
  document.getElementById('compass-view').hidden = view !== 'compass';
  document.getElementById('sonar-view').hidden = view !== 'sonar';
  document.getElementById('ar-view').hidden = view !== 'ar';
  
  // AR最寄りCP情報セクションの表示制御(新規)
  const arNearestInfo = document.getElementById('ar-nearest-info');
  if (arNearestInfo) {
    arNearestInfo.hidden = view !== 'ar';
  }
  
  document.querySelectorAll('#tabs .tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.view === view);
  });
  
  if (view === 'compass') {
    orientationMgr?.setMode('compass');
    compassView.show();
  } else if (view === 'sonar') {
    sonarView.show();
    sonarView.startAnimation();
  } else if (view === 'ar') {
    orientationMgr?.setMode('ar');
    if (arView) arView.start();
  } else {
    compassView?.hide();
    sonarView.hide();
    if (arView) arView.stop();
  }
}

/* ======== オンライン/オフライン ======== */
function updateOnlineStatus() {
  const mapDiv = document.getElementById('map');
  const onlineEl = document.getElementById('online-status');
  
  if (!isOnline) {
    mapDiv.style.opacity = '0.5';
    mapDiv.style.pointerEvents = 'none';
    if (onlineEl) { onlineEl.textContent = '⚠️ オフライン'; onlineEl.style.color = '#e53e3e'; }
  } else {
    mapDiv.style.opacity = '1';
    mapDiv.style.pointerEvents = 'auto';
    if (onlineEl) { onlineEl.textContent = '✅ オンライン'; onlineEl.style.color = '#48bb78'; }
  }
}

window.addEventListener('online', () => { 
  isOnline = true; 
  updateOnlineStatus(); 
  debugLog('✅ オンラインに復帰'); 
});

window.addEventListener('offline', () => { 
  isOnline = false; 
  updateOnlineStatus(); 
  debugLog('⚠️ オフライン'); 
});

/* ======== PWA状態 ======== */
async function initPWA() {
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

/* ======== 通知システム ======== */
function showNotification({ type = 'info', message, duration = 3000 }) {
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 80px;
    left: 50%;
    transform: translateX(-50%);
    background: ${type === 'error' ? '#e53e3e' : type === 'warning' ? '#ed8936' : type === 'success' ? '#48bb78' : '#667eea'};
    color: #fff;
    padding: 12px 20px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    z-index: 10000;
    max-width: 90%;
    text-align: center;
    animation: fadeIn 0.2s;
  `;
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    if (notification.parentElement) {
      document.body.removeChild(notification);
    }
  }, duration);
}

/* ======== グローバル関数(switchViewのみ) ======== */
window.switchView = switchView;

/* ======== 初期化実行 ======== */
init().catch(error => {
  debugLog(`❌ 初期化エラー: ${error.message}`);
  alert('アプリケーションの初期化に失敗しました。');
});
