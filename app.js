/**
 * app.js - オーケストレーション層
 * 依存性注入パターン実装済み
 * iOS 13+のセンサー権限リクエスト対応
 * 
 * 改修: AR最寄りCP情報セクションの表示制御を追加
 * 改修日: 2025-10-04
 * 
 * 改修: バッテリー最適化 - タブ切り替え改善、省電力モード追加
 * 改修日: 2025-10-04
 * バージョン: 2.0.0
 * 
 * 改修: 地図タイル自動キャッシュ機能追加
 * 改修日: 2025-10-04
 * バージョン: 2.1.0
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

// 🔋 省電力モード状態
let batterySaverMode = false;

// 🗺️ 地図キャッシュ状態
let mapCacheEnabled = true;

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
    scanSpeed: sonarConfig.scanSpeed || 36,
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
  
  // 10. 🔋 省電力モード復元
  restoreBatterySaverMode();
  
  // 11. 🗺️ 地図キャッシュ初期化
  await initMapCache();
  
  // ========== 自動起動処理 ==========
  // 軌跡記録を自動開始
  startTracking();
  
  debugLog('🎉 アプリケーション初期化完了');
}

/* ======== 🗺️ 地図キャッシュ機能 ======== */

/**
 * 地図キャッシュの初期化
 */
async function initMapCache() {
  debugLog('🗺️ 地図キャッシュ初期化開始');
  
  // LocalStorageから設定復元
  const saved = localStorage.getItem('map_cache_enabled');
  mapCacheEnabled = saved !== 'false';
  
  const checkbox = document.getElementById('auto-map-cache-enable');
  if (checkbox) {
    checkbox.checked = mapCacheEnabled;
  }
  
  // 現在のキャッシュ状態を取得
  await updateMapCacheStatus();
  
  // 自動キャッシュが有効な場合、キャッシュを開始
  if (mapCacheEnabled) {
    // 2秒待ってから開始（初期化完了を待つ）
    setTimeout(() => {
      triggerMapCaching();
    }, 2000);
  }
  
  debugLog('✅ 地図キャッシュ初期化完了');
}

/**
 * 地図キャッシュを開始
 */
async function triggerMapCaching() {
  const checkpoints = stateMgr?.checkpoints || [];
  if (checkpoints.length === 0) {
    debugLog('⚠️ チェックポイントがないためキャッシュをスキップ');
    return;
  }
  
  // 矩形範囲計算
  const bounds = calculateTileBounds(checkpoints);
  
  // タイルリスト生成
  const tiles = generateTileList(bounds, [14, 15, 16]);
  
  debugLog(`📦 地図キャッシュ開始: ${tiles.length}枚のタイルをダウンロード`);
  
  // Service Workerにメッセージ送信
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    showProgressBar();
    
    navigator.serviceWorker.controller.postMessage({
      type: 'CACHE_MAP_TILES',
      tiles: tiles
    });
  } else {
    debugLog('⚠️ Service Workerが利用できません');
  }
}

/**
 * チェックポイントを含む矩形範囲を計算
 */
function calculateTileBounds(checkpoints) {
  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;
  
  checkpoints.forEach(cp => {
    if (cp.lat < minLat) minLat = cp.lat;
    if (cp.lat > maxLat) maxLat = cp.lat;
    if (cp.lng < minLng) minLng = cp.lng;
    if (cp.lng > maxLng) maxLng = cp.lng;
  });
  
  // バッファ追加（約500m）
  const buffer = 0.005;
  
  return {
    minLat: minLat - buffer,
    maxLat: maxLat + buffer,
    minLng: minLng - buffer,
    maxLng: maxLng + buffer
  };
}

/**
 * タイルリストを生成
 */
function generateTileList(bounds, zooms) {
  const tiles = [];
  
  zooms.forEach(zoom => {
    const minTile = latLngToTile(bounds.maxLat, bounds.minLng, zoom);
    const maxTile = latLngToTile(bounds.minLat, bounds.maxLng, zoom);
    
    for (let x = minTile.x; x <= maxTile.x; x++) {
      for (let y = minTile.y; y <= maxTile.y; y++) {
        tiles.push({ z: zoom, x: x, y: y });
      }
    }
  });
  
  return tiles;
}

/**
 * 緯度経度からタイル座標に変換
 */
function latLngToTile(lat, lng, zoom) {
  const n = Math.pow(2, zoom);
  const x = Math.floor((lng + 180) / 360 * n);
  const y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 
         1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
  return { x, y };
}

/**
 * プログレスバーを表示
 */
function showProgressBar() {
  const container = document.getElementById('map-cache-progress-container');
  if (container) {
    container.hidden = false;
  }
}

/**
 * プログレスバーを非表示
 */
function hideProgressBar() {
  const container = document.getElementById('map-cache-progress-container');
  if (container) {
    container.hidden = true;
  }
}

/**
 * プログレスバーを更新
 */
function updateProgressBar(current, total) {
  const fill = document.getElementById('map-cache-progress-fill');
  const text = document.getElementById('map-cache-progress-text');
  
  const percentage = Math.round((current / total) * 100);
  
  if (fill) {
    fill.style.width = `${percentage}%`;
  }
  
  if (text) {
    text.textContent = `${percentage}% (${current}/${total})`;
  }
}

/**
 * 地図キャッシュ状態を更新
 */
async function updateMapCacheStatus() {
  const statusEl = document.getElementById('map-cache-status');
  const countEl = document.getElementById('map-cache-tile-count');
  
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    // Service Workerにキャッシュ情報をリクエスト
    navigator.serviceWorker.controller.postMessage({
      type: 'GET_CACHE_INFO'
    });
  } else {
    if (statusEl) statusEl.textContent = '利用不可';
    if (countEl) countEl.textContent = '0枚';
  }
}

/**
 * 地図キャッシュを削除
 */
async function clearMapCache() {
  debugLog('🗑️ 地図キャッシュ削除開始');
  
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: 'CLEAR_MAP_CACHE'
    });
    
    // UIを更新
    setTimeout(() => {
      updateMapCacheStatus();
      debugLog('✅ 地図キャッシュ削除完了');
      alert('地図キャッシュを削除しました');
    }, 500);
  }
}

/* ======== Service Workerメッセージ受信 ======== */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data.type === 'CACHE_PROGRESS') {
      updateProgressBar(event.data.current, event.data.total);
    } else if (event.data.type === 'CACHE_COMPLETE') {
      hideProgressBar();
      updateMapCacheStatus();
      debugLog(`✅ 地図キャッシュ完了: ${event.data.total}枚（失敗: ${event.data.failed || 0}枚）`);
      
      showNotification({
        type: 'success',
        message: `✅ 地図キャッシュ完了: ${event.data.total}枚のタイルをダウンロードしました`,
        duration: 5000
      });
    } else if (event.data.type === 'CACHE_INFO') {
      const statusEl = document.getElementById('map-cache-status');
      const countEl = document.getElementById('map-cache-tile-count');
      
      if (statusEl) {
        statusEl.textContent = event.data.tileCount > 0 ? 'キャッシュ済み' : '未キャッシュ';
        statusEl.style.color = event.data.tileCount > 0 ? '#48bb78' : '#718096';
      }
      
      if (countEl) {
        countEl.textContent = `${event.data.tileCount}枚`;
      }
    } else if (event.data.type === 'CACHE_CLEARED') {
      debugLog('✅ 地図キャッシュ削除完了(SW応答)');
    }
  });
}

/* ======== iOSPermissionPrompt表示 ======== */
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
  
  // 🔋 省電力モードトグル
  document.getElementById('battery-saver-mode')?.addEventListener('change', handleBatterySaverModeChange);
  
  // 🗺️ 地図キャッシュ設定
  document.getElementById('auto-map-cache-enable')?.addEventListener('change', (e) => {
    mapCacheEnabled = e.target.checked;
    localStorage.setItem('map_cache_enabled', String(mapCacheEnabled));
    
    if (mapCacheEnabled) {
      debugLog('✅ 自動地図キャッシュ有効化');
      triggerMapCaching();
    } else {
      debugLog('ℹ️ 自動地図キャッシュ無効化');
    }
  });
  
  document.getElementById('clear-map-cache-btn')?.addEventListener('click', async () => {
    if (confirm('地図キャッシュを削除しますか？\nオフライン時は地図が表示されなくなります。')) {
      await clearMapCache();
    }
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
  
  // 🔋 省電力モードに応じた設定を取得
  const trackingConfig = stateMgr.config?.tracking || {};
  const options = {
    enableHighAccuracy: batterySaverMode ? false : (trackingConfig.highAccuracy ?? false),
    timeout: trackingConfig.timeout ?? 10000,
    maximumAge: trackingConfig.maximumAge ?? 30000
  };
  
  geoMgr.startWatchPosition((position) => {
    stateMgr.setPosition(position);
    stateMgr.addTrackPoint(position);
    
    geoMgr.updateCurrentPositionMarker(position);
    geoMgr.updateTrackPolyline(stateMgr.trackPoints);
    
    updateUI();
    
    if (stateMgr.trackPoints.length % 5 === 0) {
      stateMgr.save();
    }
  }, options);
  
  updateTrackingButton();
  debugLog(`📍 軌跡記録を開始 (省電力: ${batterySaverMode ? 'ON' : 'OFF'})`);
}

function stopTracking() {
  stateMgr.setTrackingEnabled(false);
  geoMgr.stopWatchPosition();
  updateTrackingButton();
  stateMgr.save();
  debugLog('📍 軌跡記録を停止');
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
        <div class="checkpoint-name">${stateMgr.isCompleted(cp.id) ? '✔ ' : ''}${cp.name}</div>
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

/* ======== ビュー切替（改善版） ======== */
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
  
  // ========== 🔧 修正: まず全ビューを停止 ==========
  debugLog(`🔄 ビュー切り替え: ${currentView} → ${view}`);
  
  // Compass停止
  if (compassView) {
    compassView.hide();
  }
  
  // Sonar停止（音も確実に停止）
  if (sonarView) {
    sonarView.hide();
  }
  
  // AR停止（カメラも確実に停止）
  if (arView) {
    arView.stop();
  }
  
  // ========== ビュー切り替え実行 ==========
  currentView = view;
  
  // DOM表示制御
  document.getElementById('map').hidden = view !== 'map';
  document.getElementById('compass-view').hidden = view !== 'compass';
  document.getElementById('sonar-view').hidden = view !== 'sonar';
  document.getElementById('ar-view').hidden = view !== 'ar';
  
  // AR最寄りCP情報セクションの表示制御
  const arNearestInfo = document.getElementById('ar-nearest-info');
  if (arNearestInfo) {
    arNearestInfo.hidden = view !== 'ar';
  }
  
  // タブハイライト
  document.querySelectorAll('#tabs .tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.view === view);
  });
  
  // ========== 選択されたビューのみ開始 ==========
  if (view === 'compass') {
    orientationMgr?.setMode('compass');
    compassView.show();
    debugLog('✅ Compassビュー開始');
  } else if (view === 'sonar') {
    orientationMgr?.setMode('sonar');
    sonarView.show();
    sonarView.startAnimation();
    debugLog('✅ Sonarビュー開始');
  } else if (view === 'ar') {
    orientationMgr?.setMode('ar');
    if (arView) {
      arView.start().catch(err => {
        debugLog(`❌ AR起動失敗: ${err.message}`);
        alert('ARカメラの起動に失敗しました。\nカメラの使用許可を確認してください。');
        // フォールバック: Compassに戻る
        switchView('compass');
      });
    }
    debugLog('✅ ARビュー開始');
  } else if (view === 'map') {
    debugLog('✅ Mapビュー表示');
  }
}

/* ======== 🔋 省電力モード ======== */
function handleBatterySaverModeChange(e) {
  batterySaverMode = e.target.checked;
  
  if (batterySaverMode) {
    debugLog('🔋 省電力モード: ON');
    
    // GPS精度を下げる（トラッキング再起動）
    if (stateMgr.isTrackingEnabled()) {
      stopTracking();
      setTimeout(() => {
        startTracking(); // 低精度モードで再起動
      }, 500);
    }
    
    // センサー頻度を下げる
    if (orientationMgr && orientationMgr.setBatterySaverMode) {
      orientationMgr.setBatterySaverMode(true);
    }
    
    // AR FPS制限を強化
    if (arView && arView.setBatterySaverMode) {
      arView.setBatterySaverMode(true);
    }
    
    // ユーザーに通知
    showNotification({
      type: 'success',
      message: '🔋 省電力モードON: GPS精度↓、センサー頻度↓、AR FPS↓',
      duration: 4000
    });
    
    // 画面輝度の提案
    setTimeout(() => {
      showNotification({
        type: 'info',
        message: '💡 画面の明るさを手動で下げると、さらに省電力になります',
        duration: 5000
      });
    }, 1000);
    
  } else {
    debugLog('🔋 省電力モード: OFF');
    
    // 通常モードに戻す
    if (stateMgr.isTrackingEnabled()) {
      stopTracking();
      setTimeout(() => startTracking(), 500);
    }
    
    if (orientationMgr && orientationMgr.setBatterySaverMode) {
      orientationMgr.setBatterySaverMode(false);
    }
    
    if (arView && arView.setBatterySaverMode) {
      arView.setBatterySaverMode(false);
    }
    
    showNotification({
      type: 'info',
      message: 'ℹ️ 省電力モードOFF: 通常動作に戻りました',
      duration: 3000
    });
  }
  
  // LocalStorageに保存
  localStorage.setItem('battery_saver_mode', batterySaverMode ? 'true' : 'false');
}

function restoreBatterySaverMode() {
  const saved = localStorage.getItem('battery_saver_mode') === 'true';
  const checkbox = document.getElementById('battery-saver-mode');
  
  if (checkbox) {
    checkbox.checked = saved;
    
    if (saved) {
      batterySaverMode = true;
      // 設定を適用（UIイベントをトリガー）
      checkbox.dispatchEvent(new Event('change'));
      debugLog('🔋 省電力モード復元: ON');
    }
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
