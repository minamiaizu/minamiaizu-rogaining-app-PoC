/**
 * Debug Manager - デバッグ関連機能を統合管理
 * ロゲイニングPoCアプリケーション用
 */

/* ======== デバッグログ（画面下部） ======== */
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

/* ======== デバッグオーバーレイシステム ======== */

// デバッグシステムのグローバル状態
window.debugOverlay = {
  element: null,
  isVisible: false,
  updateInterval: null,
  currentView: null,
  sensorData: {}
};

/**
 * デバッグオーバーレイを作成・表示
 */
window.createDebugOverlay = function(viewName) {
  if (!window.debugOverlay.element) {
    const overlay = document.createElement('div');
    overlay.id = 'debug-overlay';
    overlay.className = 'debug-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 80px;
      left: 10px;
      right: 10px;
      max-width: 500px;
      background: rgba(0, 0, 0, 0.92);
      color: #00ff00;
      padding: 15px;
      border-radius: 12px;
      font-family: 'Courier New', monospace;
      font-size: 11px;
      z-index: 10000;
      max-height: 70vh;
      overflow-y: auto;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(4px);
    `;
    
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.style.cssText = `
      position: absolute;
      top: 8px;
      right: 8px;
      background: #ff3030;
      color: #fff;
      border: none;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      font-size: 18px;
      cursor: pointer;
      font-weight: bold;
      line-height: 1;
    `;
    closeBtn.onclick = () => window.hideDebugOverlay();
    
    overlay.appendChild(closeBtn);
    
    const content = document.createElement('div');
    content.id = 'debug-content';
    content.style.marginTop = '35px';
    overlay.appendChild(content);
    
    document.body.appendChild(overlay);
    window.debugOverlay.element = overlay;
  }
  
  window.debugOverlay.currentView = viewName;
  window.debugOverlay.element.style.display = 'block';
  window.debugOverlay.isVisible = true;
  
  // デバッグ情報の更新を開始
  window.startDebugUpdate();
  
  window.debugLog(`デバッグオーバーレイ表示: ${viewName}`);
};

/**
 * デバッグオーバーレイを非表示
 */
window.hideDebugOverlay = function() {
  if (window.debugOverlay.element) {
    window.debugOverlay.element.style.display = 'none';
  }
  window.debugOverlay.isVisible = false;
  window.stopDebugUpdate();
  window.debugLog('デバッグオーバーレイ非表示');
};

/**
 * デバッグオーバーレイの表示切替
 */
window.toggleDebugOverlay = function(viewName) {
  if (window.debugOverlay.isVisible && window.debugOverlay.currentView === viewName) {
    window.hideDebugOverlay();
  } else {
    window.createDebugOverlay(viewName);
  }
};

/**
 * デバッグ情報の収集
 */
window.collectDebugData = function() {
  const data = {
    timestamp: new Date().toISOString(),
    view: window.debugOverlay.currentView || window.currentView,
    
    // 現在地情報
    position: window.currentPosition ? {
      lat: window.currentPosition.lat.toFixed(6),
      lng: window.currentPosition.lng.toFixed(6),
      accuracy: window.currentPosition.accuracy?.toFixed(1) + 'm',
      elevation: (window.currentPosition.elevation || 0).toFixed(1) + 'm'
    } : null,
    
    // OrientationManager情報
    orientation: window.orientationManager ? window.orientationManager.getDebugInfo() : {
      heading: Math.round(window.smoothedHeading),
      confidence: 'N/A',
      accuracy: 'N/A',
      mode: 'fallback',
      platform: window.IS_IOS ? 'iOS' : 'Other',
      updates: 0,
      beta: Math.round(window.devicePitch)
    },
    
    // センサー生データ
    sensors: {
      alpha: window.debugOverlay.sensorData.alpha?.toFixed(1) + '°' || 'N/A',
      beta: window.debugOverlay.sensorData.beta?.toFixed(1) + '°' || 'N/A',
      gamma: window.debugOverlay.sensorData.gamma?.toFixed(1) + '°' || 'N/A',
      webkitCompassHeading: window.debugOverlay.sensorData.webkitCompassHeading?.toFixed(1) + '°' || 'N/A',
      webkitCompassAccuracy: window.debugOverlay.sensorData.webkitCompassAccuracy?.toFixed(1) + '°' || 'N/A'
    },
    
    // 画面・デバイス向き
    screen: {
      orientation: screen.orientation?.type || 'N/A',
      angle: screen.orientation?.angle + '°' || 'N/A',
      windowOrientation: window.orientation !== undefined ? window.orientation + '°' : 'N/A'
    },
    
    // bearing計算結果（最寄り3つのCP）
    bearings: []
  };
  
  // チェックポイントへのbearing計算
  if (window.currentPosition && window.checkpoints) {
    const bearingData = [];
    window.checkpoints.forEach(cp => {
      if (window.completedCheckpoints.has(cp.id)) return;
      const dist = window.distance(window.currentPosition.lat, window.currentPosition.lng, cp.lat, cp.lng);
      const brng = window.bearing(window.currentPosition.lat, window.currentPosition.lng, cp.lat, cp.lng);
      bearingData.push({ cp, dist, brng });
    });
    
    // 距離順にソート
    bearingData.sort((a, b) => a.dist - b.dist);
    
    // 最寄り3つを表示
    data.bearings = bearingData.slice(0, 3).map(item => ({
      name: item.cp.name,
      distance: Math.round(item.dist) + 'm',
      bearing: Math.round(item.brng) + '°',
      // 相対方位（現在の向きからの角度差）
      relative: Math.round(((item.brng - window.smoothedHeading + 540) % 360) - 180) + '°'
    }));
  }
  
  return data;
};

/**
 * デバッグ情報を表示用HTMLに変換
 */
window.formatDebugData = function(data) {
  let html = `
    <div style="margin-bottom: 12px;">
      <strong style="color: #00ffff; font-size: 13px;">📊 デバッグ情報 [${data.view}]</strong>
      <div style="color: #888; font-size: 10px;">${new Date(data.timestamp).toLocaleTimeString('ja-JP')}</div>
    </div>
  `;
  
  // 現在地
  if (data.position) {
    html += `
      <div style="margin-bottom: 10px; border-left: 3px solid #00ff00; padding-left: 8px;">
        <strong style="color: #00ff00;">📍 現在地</strong>
        <div>緯度: ${data.position.lat}</div>
        <div>経度: ${data.position.lng}</div>
        <div>精度: ${data.position.accuracy}</div>
        <div>標高: ${data.position.elevation}</div>
      </div>
    `;
  } else {
    html += `
      <div style="margin-bottom: 10px; border-left: 3px solid #ff3030; padding-left: 8px;">
        <strong style="color: #ff3030;">📍 現在地: 未取得</strong>
      </div>
    `;
  }
  
  // 方位情報
  html += `
    <div style="margin-bottom: 10px; border-left: 3px solid #ffd700; padding-left: 8px;">
      <strong style="color: #ffd700;">🧭 方位センサー</strong>
      <div>方位角: ${data.orientation.heading}° (smoothed)</div>
      <div>信頼度: ${data.orientation.confidence}</div>
      <div>精度: ${data.orientation.accuracy}</div>
      <div>モード: ${data.orientation.mode}</div>
      <div>プラットフォーム: ${data.orientation.platform}</div>
      <div>ピッチ: ${data.orientation.beta}°</div>
      <div>更新回数: ${data.orientation.updates}</div>
    </div>
  `;
  
  // センサー生データ
  html += `
    <div style="margin-bottom: 10px; border-left: 3px solid #ff6b9d; padding-left: 8px;">
      <strong style="color: #ff6b9d;">📱 センサー生データ</strong>
      <div>alpha: ${data.sensors.alpha}</div>
      <div>beta: ${data.sensors.beta}</div>
      <div>gamma: ${data.sensors.gamma}</div>
      <div>webkitCompassHeading: ${data.sensors.webkitCompassHeading}</div>
      <div>webkitCompassAccuracy: ${data.sensors.webkitCompassAccuracy}</div>
    </div>
  `;
  
  // 画面向き
  html += `
    <div style="margin-bottom: 10px; border-left: 3px solid #9d6bff; padding-left: 8px;">
      <strong style="color: #9d6bff;">📐 画面・デバイス向き</strong>
      <div>Screen Orientation: ${data.screen.orientation}</div>
      <div>Screen Angle: ${data.screen.angle}</div>
      <div>Window Orientation: ${data.screen.windowOrientation}</div>
    </div>
  `;
  
  // bearing計算結果
  if (data.bearings.length > 0) {
    html += `
      <div style="margin-bottom: 10px; border-left: 3px solid #00ffff; padding-left: 8px;">
        <strong style="color: #00ffff;">🎯 最寄りCP（bearing計算）</strong>
    `;
    data.bearings.forEach((b, i) => {
      html += `
        <div style="margin-top: 6px; padding: 6px; background: rgba(0, 255, 255, 0.1); border-radius: 4px;">
          <div style="font-weight: bold;">${i + 1}. ${b.name}</div>
          <div style="font-size: 10px;">
            <span style="color: #aaa;">距離:</span> ${b.distance} | 
            <span style="color: #aaa;">方位:</span> ${b.bearing} | 
            <span style="color: #aaa;">相対:</span> ${b.relative}
          </div>
        </div>
      `;
    });
    html += `</div>`;
  }
  
  // 期待値との差分（将来の拡張用）
  html += `
    <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #444; font-size: 10px; color: #888;">
      <strong>ℹ️ ヒント:</strong> bearing計算の「方位」が北=0°, 東=90°, 南=180°, 西=270°になっているか確認してください。
    </div>
  `;
  
  return html;
};

/**
 * デバッグ情報の定期更新を開始
 */
window.startDebugUpdate = function() {
  window.stopDebugUpdate();
  window.debugOverlay.updateInterval = setInterval(() => {
    if (window.debugOverlay.isVisible && window.debugOverlay.element) {
      const data = window.collectDebugData();
      const html = window.formatDebugData(data);
      const content = document.getElementById('debug-content');
      if (content) {
        content.innerHTML = html;
      }
    }
  }, 500); // 0.5秒ごとに更新
};

/**
 * デバッグ情報の定期更新を停止
 */
window.stopDebugUpdate = function() {
  if (window.debugOverlay.updateInterval) {
    clearInterval(window.debugOverlay.updateInterval);
    window.debugOverlay.updateInterval = null;
  }
};

/**
 * センサーデータの更新（deviceorientationイベントから呼び出される）
 */
window.updateSensorData = function(event) {
  window.debugOverlay.sensorData = {
    alpha: event.alpha,
    beta: event.beta,
    gamma: event.gamma,
    webkitCompassHeading: event.webkitCompassHeading,
    webkitCompassAccuracy: event.webkitCompassAccuracy
  };
};

/**
 * センサーのリロード（再初期化）
 */
window.reloadSensors = function() {
  window.debugLog('🔄 センサーをリロード中...');
  
  // OrientationManagerの再初期化
  if (window.orientationManager) {
    window.orientationManager.init().then(success => {
      if (success) {
        window.debugLog('✅ センサーリロード完了');
        alert('センサーのリロードが完了しました');
      } else {
        window.debugLog('⚠️ センサーリロード中に問題が発生');
        alert('センサーのリロード中に問題が発生しました');
      }
    });
  } else {
    // OrientationManagerが未初期化の場合は初期化
    window.debugLog('OrientationManagerを初期化中...');
    if (typeof window.startOrientation === 'function') {
      window.startOrientation();
    }
  }
};

/**
 * デバッグボタンを特定のコンテナに追加
 */
window.addDebugButtons = function(containerId, viewName) {
  const container = document.getElementById(containerId);
  if (!container) {
    window.debugLog(`⚠️ コンテナ ${containerId} が見つかりません`);
    return;
  }
  
  // 既にボタンが存在する場合は追加しない
  if (container.querySelector('.debug-buttons')) {
    return;
  }
  
  // ボタンコンテナを作成
  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'debug-buttons';
  buttonContainer.style.cssText = `
    position: absolute;
    top: 10px;
    right: 10px;
    display: flex;
    gap: 8px;
    z-index: 1000;
  `;
  
  // デバッグボタン
  const debugBtn = document.createElement('button');
  debugBtn.textContent = '🐛';
  debugBtn.title = 'デバッグ情報を表示';
  debugBtn.style.cssText = `
    background: rgba(0, 0, 0, 0.7);
    color: #00ff00;
    border: 2px solid #00ff00;
    padding: 8px 12px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 16px;
    transition: all 0.2s;
  `;
  debugBtn.onmouseover = () => {
    debugBtn.style.background = 'rgba(0, 255, 0, 0.2)';
    debugBtn.style.transform = 'scale(1.1)';
  };
  debugBtn.onmouseout = () => {
    debugBtn.style.background = 'rgba(0, 0, 0, 0.7)';
    debugBtn.style.transform = 'scale(1)';
  };
  debugBtn.onclick = () => window.toggleDebugOverlay(viewName);
  
  // リロードボタン
  const reloadBtn = document.createElement('button');
  reloadBtn.textContent = '🔄';
  reloadBtn.title = 'センサーをリロード';
  reloadBtn.style.cssText = `
    background: rgba(0, 0, 0, 0.7);
    color: #ffd700;
    border: 2px solid #ffd700;
    padding: 8px 12px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 16px;
    transition: all 0.2s;
  `;
  reloadBtn.onmouseover = () => {
    reloadBtn.style.background = 'rgba(255, 215, 0, 0.2)';
    reloadBtn.style.transform = 'scale(1.1)';
  };
  reloadBtn.onmouseout = () => {
    reloadBtn.style.background = 'rgba(0, 0, 0, 0.7)';
    reloadBtn.style.transform = 'scale(1)';
  };
  reloadBtn.onclick = () => window.reloadSensors();
  
  buttonContainer.appendChild(debugBtn);
  buttonContainer.appendChild(reloadBtn);
  
  container.appendChild(buttonContainer);
  
  window.debugLog(`✅ デバッグボタンを ${viewName} に追加`);
};

// デバッグマネージャーの初期化完了をログ
window.debugLog('🛠️ Debug Manager 読み込み完了');
