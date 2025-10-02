/**
 * ARView - AR表示管理（マルチプラットフォーム対応）
 * iOS/Android/Windows/Linux対応のカメラAR
 */

class ARView {
  constructor(options = {}) {
    this.options = {
      range: options.range ?? 1000,
      fovH: 60 * Math.PI / 180,
      fovV: 45 * Math.PI / 180,
      fovPresets: {
        wide: { h: 70, v: 52, label: '広角' },
        normal: { h: 60, v: 45, label: '標準' },
        tele: { h: 45, v: 34, label: '望遠' }
      },
      selectedFov: 'normal',
      timerDuration: options.timerDuration ?? 300,
      debugMode: false
    };
    
    // カメラ・キャンバス
    this.stream = null;
    this.video = null;
    this.canvas = null;
    this.ctx = null;
    this.animationId = null;
    
    // タイマー
    this.timerInterval = null;
    this.secondsLeft = this.options.timerDuration;
    
    // FPS制限
    this.lastFrameTime = 0;
    this.fpsLimit = 30;
    
    // キャッシュ
    this.distanceCache = {};
    this.lastCacheTime = 0;
    
    // センサーモード
    this.sensorMode = null;
    
    // プラットフォーム検出
    this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    this.isAndroid = /Android/.test(navigator.userAgent);
  }
  
  // ========== 開始 ==========
  async start() {
    this.video = document.getElementById('camera');
    this.canvas = document.getElementById('ar-canvas');
    this.ctx = this.canvas?.getContext('2d');
    
    if (!this.video || !this.canvas) {
      throw new Error('AR要素が見つかりません');
    }
    
    // カメラ制約（プラットフォーム別）
    const constraints = this._getCameraConstraints();
    
    try {
      this.log('📷 ARカメラ起動試行...');
      
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.video.srcObject = this.stream;
      await this.video.play();
      
      this._resizeCanvas();
      this.startTimer();
      this._startRenderLoop();
      
      this.log('✅ ARカメラ起動成功');
    } catch (error) {
      this.log(`❌ ARカメラ起動失敗: ${error.message}`);
      
      // フォールバック: より緩い制約で再試行
      try {
        const fallbackConstraints = {
          video: { facingMode: 'user' },
          audio: false
        };
        
        this.stream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
        this.video.srcObject = this.stream;
        await this.video.play();
        
        this._resizeCanvas();
        this.startTimer();
        this._startRenderLoop();
        
        this.log('✅ ARカメラ起動（フロント）');
      } catch (e2) {
        alert('カメラの使用許可が必要です。\nブラウザの設定を確認してください。');
        throw e2;
      }
    }
  }
  
  _getCameraConstraints() {
    if (this.isIOS) {
      // iOS: 背面カメラ優先
      return {
        video: {
          facingMode: { exact: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      };
    } else if (this.isAndroid) {
      // Android: 背面カメラ優先（exactを使わない）
      return {
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      };
    } else {
      // PC/その他: フロントカメラ
      return {
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      };
    }
  }
  
  // ========== 停止 ==========
  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    
    this.distanceCache = {};
    
    this.log('⏹️ AR停止');
  }
  
  // ========== キャンバスリサイズ ==========
  _resizeCanvas() {
    const rect = document.getElementById('ar-view').getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
  }
  
  // ========== レンダリングループ ==========
  _startRenderLoop() {
    this.lastFrameTime = performance.now();
    this.animationId = requestAnimationFrame((t) => this._renderLoop(t));
  }
  
  _renderLoop(currentTime) {
    if (!this.animationId) return;
    
    // FPS制限
    if (currentTime - this.lastFrameTime < 1000 / this.fpsLimit) {
      this.animationId = requestAnimationFrame((t) => this._renderLoop(t));
      return;
    }
    this.lastFrameTime = currentTime;
    
    // 描画
    this._render();
    
    this.animationId = requestAnimationFrame((t) => this._renderLoop(t));
  }
  
  // ========== 描画 ==========
  _render() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    
    ctx.clearRect(0, 0, w, h);
    
    const currentPosition = window.currentPosition;
    if (!currentPosition) {
      this.animationId = requestAnimationFrame((t) => this._renderLoop(t));
      return;
    }
    
    // 方位テープをCanvasに描画
    this._drawCompassTape(ctx, w, h);
    
    // チェックポイントマーカー
    this._drawCheckpoints(ctx, w, h, currentPosition);
  }
  
  _drawCompassTape(ctx, w, h) {
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
    const fovHDeg = this.options.fovH * 180 / Math.PI;
    const displayRange = fovHDeg / 2 + 10;
    
    const heading = window.smoothedHeading || 0;
    
    // 5度刻みで目盛りを描画
    for (let offset = -displayRange; offset <= displayRange; offset += 5) {
      const angle = (heading + offset + 360) % 360;
      const normalizedOffset = offset / fovHDeg;
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
  }
  
  _drawCheckpoints(ctx, w, h, currentPosition) {
    const checkpoints = window.checkpoints || [];
    const completedCheckpoints = window.completedCheckpoints || new Set();
    
    const sizes = this._getMarkerSizeByRange();
    
    checkpoints.forEach(cp => {
      // 距離計算（キャッシュ使用）
      const d = this._getCachedDistance(cp.id, currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
      
      // レンジ外は早期リターン
      if (d > this.options.range) return;
      
      // 方位計算
      const b = this._bearing(currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
      const actualHeading = window.smoothedHeading || 0;
      let rel = ((b - actualHeading + 540) % 360) - 180; // -180〜180
      
      // 標高差と仰角計算
      const elevDiff = (cp.elevation ?? 650) - (currentPosition.elevation ?? 650);
      const horiz = Math.max(1, d);
      const elevAngle = Math.atan2(elevDiff, horiz);
      
      // デバイスのピッチ角を補正（90°を0°として扱う）
      const devicePitch = window.devicePitch || 0;
      const correctedPitch = devicePitch - 90;
      const devicePitchRad = correctedPitch * Math.PI / 180;
      const screenElevAngle = elevAngle - devicePitchRad;
      
      // 画面座標計算（ピッチ補正済み）
      const relRad = rel * Math.PI / 180;
      const x = w/2 + (relRad / this.options.fovH) * w;
      const y = h/2 - screenElevAngle / this.options.fovV * h;
      
      // マーカー描画
      const r = sizes.marker / 2;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI*2);
      ctx.fillStyle = completedCheckpoints.has(cp.id) ? '#48bb78' : '#667eea';
      ctx.fill();
      
      // ETAtext計算
      const eta = this._calculateETA(d, elevDiff);
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
    
    // デバッグ情報（デバッグモードONの時のみ）
    if (this.options.debugMode) {
      this._drawDebugInfo(ctx, w, h);
    }
  }
  
  _drawDebugInfo(ctx, w, h) {
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(10, 10, 280, 180);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'left';
    
    let y = 25;
    
    // プラットフォーム情報
    ctx.fillText(`📱 Platform: ${this.isIOS ? 'iOS' : this.isAndroid ? 'Android' : 'Other'}`, 15, y); y += 15;
    
    // OrientationManager情報
    if (window.orientationManager) {
      const debugInfo = window.orientationManager.getDebugInfo();
      ctx.fillText(`Heading: ${debugInfo.heading}°`, 15, y); y += 15;
      ctx.fillText(`Accuracy: ${debugInfo.accuracy}`, 15, y); y += 15;
      ctx.fillText(`Confidence: ${debugInfo.confidence}`, 15, y); y += 15;
      ctx.fillText(`Pitch: ${debugInfo.beta}°`, 15, y); y += 15;
    }
    
    ctx.fillText(`Range: ${this.options.range}m`, 15, y); y += 15;
    ctx.fillText(`FOV: ${Math.round(this.options.fovH*180/Math.PI)}°`, 15, y); y += 15;
  }
  
  // ========== 更新 ==========
  update(currentPosition, heading, pitch, checkpoints, completedIds) {
    // 最寄りCP情報更新
    this.updateNearestInfo(currentPosition, checkpoints, completedIds);
  }
  
  updateNearestInfo(currentPosition, checkpoints, completedIds) {
    const nearestInfo = document.getElementById('nearest-cp-info');
    if (!nearestInfo || !currentPosition) return;
    
    let nearestCP = null;
    let nearestDist = Infinity;
    
    checkpoints.forEach(cp => {
      if (completedIds.has(cp.id)) return;
      const d = this._distance(currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
      if (d < nearestDist) {
        nearestDist = d;
        nearestCP = cp;
      }
    });
    
    if (nearestCP) {
      const elevDiff = (nearestCP.elevation ?? 650) - (currentPosition.elevation ?? 650);
      const eta = this._calculateETA(nearestDist, elevDiff);
      const elevText = elevDiff !== 0 ? ` ${elevDiff > 0 ? '↗+' : '↘'}${Math.abs(Math.round(elevDiff))}m` : '';
      nearestInfo.textContent = `→ ${nearestCP.name} ${Math.round(nearestDist)}m${elevText} ETA: 約${Math.round(eta)}分`;
    }
  }
  
  // ========== センサーモード更新 ==========
  updateSensorMode(mode) {
    this.sensorMode = mode;
    
    // モードに応じたUI更新
    const indicator = document.querySelector('#ar-view .sensor-mode-indicator');
    if (indicator) {
      indicator.textContent = this._getSensorModeLabel(mode);
      indicator.className = `sensor-mode-indicator mode-${mode}`;
    }
  }
  
  _getSensorModeLabel(mode) {
    const labels = {
      'ios': '🧭 磁北基準（iOS）',
      'absolute-sensor': '🧭 磁北基準（高精度）',
      'absolute-event': '🧭 磁北基準',
      'relative-calibrated': '📍 キャリブレーション済み',
      'relative': '⚠️ 相対モード（要キャリブレーション）'
    };
    return labels[mode] || '❓ 不明';
  }
  
  // ========== タイマー ==========
  startTimer() {
    this.secondsLeft = this.options.timerDuration;
    const display = document.getElementById('ar-remaining');
    if (display) {
      display.textContent = this._formatTime(this.secondsLeft);
    }
    
    if (this.timerInterval) clearInterval(this.timerInterval);
    
    this.timerInterval = setInterval(() => {
      this.secondsLeft--;
      if (display) {
        display.textContent = this._formatTime(this.secondsLeft);
      }
      
      // 段階的機能制限（3分経過で警告）
      if (this.secondsLeft === 120) {
        this.log('⚠️ AR残り2分：バッテリー節約のため間もなく終了します');
      }
      
      if (this.secondsLeft <= 0) {
        clearInterval(this.timerInterval);
        this.timerInterval = null;
        alert('ARモードを終了します(5分経過)');
        if (typeof switchView === 'function') {
          switchView('compass');
        }
      }
    }, 1000);
  }
  
  _formatTime(seconds) {
    const m = String(Math.floor(seconds/60)).padStart(2,'0');
    const s = String(seconds%60).padStart(2,'0');
    return `${m}:${s}`;
  }
  
  // ========== 設定 ==========
  setRange(range) {
    this.options.range = range;
    this.distanceCache = {};
    this.log(`ARレンジ: ${range >= 1000 ? (range/1000)+'km' : range+'m'}`);
  }
  
  setFOV(fovType) {
    const preset = this.options.fovPresets[fovType];
    if (!preset) return;
    
    this.options.selectedFov = fovType;
    this.options.fovH = preset.h * Math.PI / 180;
    this.options.fovV = preset.v * Math.PI / 180;
    
    this.log(`AR視野角: ${preset.label} (${preset.h}°×${preset.v}°)`);
  }
  
  toggleDebugMode() {
    this.options.debugMode = !this.options.debugMode;
    this.log(`ARデバッグモード: ${this.options.debugMode ? 'ON' : 'OFF'}`);
  }
  
  // ========== ユーティリティ ==========
  _getMarkerSizeByRange() {
    if (this.options.range <= 250) return { marker: 50, font: 16 };
    if (this.options.range <= 500) return { marker: 50, font: 16 };
    if (this.options.range <= 1000) return { marker: 40, font: 14 };
    if (this.options.range <= 2500) return { marker: 30, font: 12 };
    return { marker: 30, font: 12 };
  }
  
  _getCachedDistance(cpId, lat1, lon1, lat2, lon2) {
    const now = Date.now();
    if (now - this.lastCacheTime > 1000) {
      this.distanceCache = {};
      this.lastCacheTime = now;
    }
    if (!this.distanceCache[cpId]) {
      this.distanceCache[cpId] = this._distance(lat1, lon1, lat2, lon2);
    }
    return this.distanceCache[cpId];
  }
  
  _distance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    
    return R * c;
  }
  
  _bearing(lat1, lon1, lat2, lon2) {
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) -
              Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    
    let θ = Math.atan2(y, x) * 180 / Math.PI;
    return (θ + 360) % 360;
  }
  
  _calculateETA(distance, elevationDiff = 0) {
    const baseSpeed = 67; // m/min
    const flatTime = distance / baseSpeed;
    const elevationPenalty = Math.max(0, elevationDiff) * 0.15;
    return flatTime + elevationPenalty;
  }
  
  log(message) {
    if (typeof debugLog === 'function') {
      debugLog(message);
    } else {
      console.log(`[ARView] ${message}`);
    }
  }
}

// グローバルエクスポート
if (typeof window !== 'undefined') {
  window.ARView = ARView;
}

// 初期化完了ログ
if (typeof debugLog === 'function') {
  debugLog('✅ ARView (Multi-Platform) 読み込み完了');
} else {
  console.log('[ARView] Multi-Platform version loaded');
}
