/**
 * ARView - AR表示管理(画面向き対応版 - シンプル再構築)
 * Portrait/Landscape両対応のピッチ補正
 * iOS/Android/Windows/Linux対応のカメラAR
 * 依存性注入パターンを使用し、グローバル変数への依存を排除
 * 
 * 修正版: iPad対応 - 背面カメラ確実選択
 * バージョン: 1.2.0 - 2025-10-03
 * 
 * 改修: 距離に応じたCP色変更機能追加
 * 改修日: 2025-10-04
 * 
 * 改修: AR最寄りCP情報をAR view外のセクションに移動
 * 改修日: 2025-10-04
 * 
 * 改修: マーカー縦軸調整機能追加
 * 改修日: 2025-10-04
 * バージョン: 1.3.0
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
      debugMode: false,
      verticalOffset: 0  // 縦軸補正値（ピクセル単位）
    };
    
    // LocalStorageキー
    this.STORAGE_KEY_VERTICAL_OFFSET = 'ar_vertical_offset';
    
    // 依存性注入
    this.stateMgr = options.stateMgr;
    this.geoMgr = options.geoMgr;
    this.orientationMgr = options.orientationMgr;
    
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
    
    // デバッグ
    this._lastDebugLog = 0;
    
    // プラットフォーム検出(iPadOS対応強化)
    this.isIOS = this.detectIOS();
    this.isAndroid = /Android/.test(navigator.userAgent);
    this.isIPad = this.detectIPad();
    
    if (!this.stateMgr || !this.geoMgr || !this.orientationMgr) {
      this.log('⚠️ StateManager/GeoManager/OrientationManagerが注入されていません');
    }
  }
  
  // ========== iOS/iPadOS検出(強化版) ==========
  detectIOS() {
    const ua = navigator.userAgent;
    
    // 従来のiOS検出
    if (/iPad|iPhone|iPod/.test(ua) && !window.MSStream) {
      return true;
    }
    
    // iPadOS 13+検出
    if (/Macintosh/.test(ua) && navigator.maxTouchPoints && navigator.maxTouchPoints > 1) {
      return true;
    }
    
    // DeviceOrientationEvent.requestPermissionの存在確認
    if (typeof DeviceOrientationEvent !== 'undefined' && 
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      return true;
    }
    
    return false;
  }
  
  detectIPad() {
    const ua = navigator.userAgent;
    
    // iPadOS 13+検出(Macintosh UA + タッチデバイス)
    if (/Macintosh/.test(ua) && navigator.maxTouchPoints && navigator.maxTouchPoints > 1) {
      this.log('✅ iPadOS検出: Macintosh UA + タッチデバイス');
      return true;
    }
    
    // 従来のiPad検出
    if (/iPad/.test(ua)) {
      this.log('✅ iPad検出: 従来のUA');
      return true;
    }
    
    return false;
  }
  
  // ========== LocalStorage 永続化機能 ==========
  
  /**
   * 補正値をLocalStorageから読み込み
   */
  _loadVerticalOffset() {
    try {
      const saved = localStorage.getItem(this.STORAGE_KEY_VERTICAL_OFFSET);
      if (saved !== null) {
        const value = parseFloat(saved);
        if (!isNaN(value)) {
          this.options.verticalOffset = value;
          this.log(`📂 縦軸補正値復元: ${this.options.verticalOffset}px`);
        }
      }
    } catch (e) {
      this.log(`⚠️ 縦軸補正値読み込みエラー: ${e.message}`);
    }
  }
  
  /**
   * 補正値をLocalStorageに保存
   */
  _saveVerticalOffset() {
    try {
      localStorage.setItem(
        this.STORAGE_KEY_VERTICAL_OFFSET, 
        String(this.options.verticalOffset)
      );
      this.log(`💾 縦軸補正値保存: ${this.options.verticalOffset}px`);
    } catch (e) {
      this.log(`⚠️ 縦軸補正値保存エラー: ${e.message}`);
    }
  }
  
  /**
   * 補正値をリセット
   */
  resetVerticalOffset() {
    this.options.verticalOffset = 0;
    this._saveVerticalOffset();
    this._updateOffsetFeedback();
    this.log('🔄 縦軸補正値リセット');
  }
  
  // ========== マーカー調整ボタンのセットアップ ==========
  
  /**
   * マーカー調整ボタンのイベントハンドラーを設定
   */
  _setupMarkerAdjustButtons() {
    const ADJUST_STEP = 10; // 1回のタップで10px移動
    const MAX_OFFSET = 200;
    const MIN_OFFSET = -200;
    
    const btnUp = document.getElementById('marker-up');
    const btnDown = document.getElementById('marker-down');
    
    if (btnUp) {
      btnUp.addEventListener('click', () => {
        // 上ボタン: マーカーを上に移動（値を減らす）
        this.options.verticalOffset = Math.max(
          this.options.verticalOffset - ADJUST_STEP,
          MIN_OFFSET
        );
        this._saveVerticalOffset();
        this._updateOffsetFeedback();
      });
    }
    
    if (btnDown) {
      btnDown.addEventListener('click', () => {
        // 下ボタン: マーカーを下に移動（値を増やす）
        this.options.verticalOffset = Math.min(
          this.options.verticalOffset + ADJUST_STEP,
          MAX_OFFSET
        );
        this._saveVerticalOffset();
        this._updateOffsetFeedback();
      });
    }
    
    this.log('✅ マーカー調整ボタン設定完了');
  }
  
  /**
   * オフセットフィードバック要素を作成
   */
  _createOffsetFeedbackElement() {
    const feedback = document.createElement('div');
    feedback.id = 'offset-feedback';
    feedback.className = 'offset-feedback';
    feedback.textContent = '縦軸: 0px';
    feedback.style.cssText = `
      position: absolute;
      top: 60px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0,0,0,0.7);
      color: #fff;
      padding: 8px 16px;
      border-radius: 20px;
      font-size: 14px;
      font-weight: 700;
      opacity: 0;
      transition: opacity 0.3s;
      pointer-events: none;
      z-index: 102;
    `;
    
    const arView = document.getElementById('ar-view');
    if (arView) {
      arView.appendChild(feedback);
    }
    
    return feedback;
  }
  
  /**
   * 調整時のフィードバック表示
   */
  _updateOffsetFeedback() {
    let feedback = document.getElementById('offset-feedback');
    
    if (!feedback) {
      feedback = this._createOffsetFeedbackElement();
    }
    
    feedback.textContent = `縦軸: ${this.options.verticalOffset > 0 ? '+' : ''}${this.options.verticalOffset}px`;
    feedback.style.opacity = '1';
    
    // 2秒後にフェードアウト
    clearTimeout(this._feedbackTimeout);
    this._feedbackTimeout = setTimeout(() => {
      if (feedback) {
        feedback.style.opacity = '0';
      }
    }, 2000);
  }
  
  // ========== 開始 ==========
  async start() {
    this.video = document.getElementById('camera');
    this.canvas = document.getElementById('ar-canvas');
    this.ctx = this.canvas?.getContext('2d');
    
    if (!this.video || !this.canvas) {
      throw new Error('AR要素が見つかりません');
    }
    
    // 補正値を読み込み
    this._loadVerticalOffset();
    
    // デバッグボタンを追加
    this._addDebugButtons();
    
    // マーカー調整ボタンのイベント設定
    this._setupMarkerAdjustButtons();
    
    // カメラ制約(プラットフォーム別・iPad対応強化)
    const constraints = this._getCameraConstraints();
    
    try {
      this.log('📷 ARカメラ起動試行...');
      this.log(`📱 検出デバイス: ${this.isIPad ? 'iPad' : this.isIOS ? 'iPhone/iPod' : this.isAndroid ? 'Android' : 'Other'}`);
      
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.video.srcObject = this.stream;
      await this.video.play();
      
      this._resizeCanvas();
      this.startTimer();
      this._startRenderLoop();
      
      this.log('✅ ARカメラ起動成功(背面カメラ優先)');
    } catch (error) {
      this.log(`⚠️ ARカメラ起動失敗(1回目): ${error.message}`);
      
      // フォールバック1: より緩い制約で背面カメラを再試行
      try {
        const fallbackConstraints = {
          video: {
            facingMode: 'environment',  // 背面カメラ優先
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        };
        
        this.log('🔄 フォールバック1: 背面カメラ再試行...');
        this.stream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
        this.video.srcObject = this.stream;
        await this.video.play();
        
        this._resizeCanvas();
        this.startTimer();
        this._startRenderLoop();
        
        this.log('✅ ARカメラ起動(フォールバック - 背面カメラ)');
      } catch (e2) {
        this.log(`⚠️ ARカメラ起動失敗(2回目): ${e2.message}`);
        
        // フォールバック2: 最終手段としてフロントカメラを試行
        try {
          const finalFallback = {
            video: { facingMode: 'user' },
            audio: false
          };
          
          this.log('🔄 フォールバック2: フロントカメラ試行...');
          this.stream = await navigator.mediaDevices.getUserMedia(finalFallback);
          this.video.srcObject = this.stream;
          await this.video.play();
          
          this._resizeCanvas();
          this.startTimer();
          this._startRenderLoop();
          
          this.log('⚠️ ARカメラ起動(フロントカメラ)');
          
          // ユーザーに通知
          if (this.isIPad || this.isIOS) {
            alert('⚠️ 背面カメラの起動に失敗したため、フロントカメラを使用しています。\n\nSafariの設定でカメラのアクセス許可を確認してください。');
          }
        } catch (e3) {
          this.log(`❌ ARカメラ起動完全失敗: ${e3.message}`);
          alert('カメラの使用許可が必要です。\nブラウザの設定を確認してください。');
          throw e3;
        }
      }
    }
  }
  
  _getCameraConstraints() {
    if (this.isIPad || this.isIOS) {
      // iOS/iPadOS: exactを使わず、環境カメラを優先
      // iPadではexact制約が不安定なため、通常のfacingModeを使用
      this.log('📱 iOS/iPadOS用カメラ制約を使用(exact制約なし)');
      return {
        video: {
          facingMode: 'environment',  // { exact: 'environment' } から変更
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      };
    } else if (this.isAndroid) {
      // Android: 背面カメラ優先(exactを使わない)
      this.log('📱 Android用カメラ制約を使用');
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
      this.log('💻 PC用カメラ制約を使用');
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
    
    if (this._feedbackTimeout) {
      clearTimeout(this._feedbackTimeout);
      this._feedbackTimeout = null;
    }
    
    this.distanceCache = {};
    
    // フィードバック要素を削除
    const feedback = document.getElementById('offset-feedback');
    if (feedback && feedback.parentElement) {
      feedback.parentElement.removeChild(feedback);
    }
    
    // デバッグボタンを削除
    this._removeDebugButtons();
    
    this.log('ℹ️ AR停止');
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
    
    const currentPosition = this.stateMgr?.currentPosition;
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
    
    // FOVに応じた表示範囲を計算(FOVの半分±余裕)
    const fovHDeg = this.options.fovH * 180 / Math.PI;
    const displayRange = fovHDeg / 2 + 10;
    
    const heading = this.orientationMgr?.getHeading() || 0;
    
    // 5度刻みで目盛りを描画
    for (let offset = -displayRange; offset <= displayRange; offset += 5) {
      const angle = (heading + offset + 360) % 360;
      const normalizedOffset = offset / fovHDeg;
      const x = w/2 + normalizedOffset * w;
      
      // 画面外は描画しない
      if (x < 0 || x > w) continue;
      
      // 主要方位(N/E/S/W)
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
      
      // 目盛り線(5度刻み)
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
    const checkpoints = this.stateMgr?.checkpoints || [];
    const completedCheckpoints = this.stateMgr?.completedIds || new Set();
    
    if (checkpoints.length === 0) {
      this.log('⚠️ チェックポイントが0件です');
      return;
    }
    
    const sizes = this._getMarkerSizeByRange();
    let drawnCount = 0;
    
    // ========== 距離範囲の計算 ==========
    const distances = [];
    checkpoints.forEach(cp => {
      const d = this._getCachedDistance(
        cp.id, 
        currentPosition.lat, 
        currentPosition.lng, 
        cp.lat, 
        cp.lng
      );
      
      // レンジ内のすべてのCP(完了・未完了問わず)
      if (d <= this.options.range) {
        distances.push(d);
      }
    });
    
    // 最小・最大距離
    const minDist = distances.length > 0 ? Math.min(...distances) : 0;
    const maxDist = distances.length > 0 ? Math.max(...distances) : this.options.range;
    
    checkpoints.forEach(cp => {
      // 距離計算(キャッシュ使用)
      const d = this._getCachedDistance(cp.id, currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
      
      // レンジ外は早期リターン
      if (d > this.options.range) return;
      
      // 方位計算
      const b = this.geoMgr?.bearing(currentPosition.lat, currentPosition.lng, cp.lat, cp.lng) || 0;
      const actualHeading = this.orientationMgr?.getHeading() || 0;
      let rel = ((b - actualHeading + 540) % 360) - 180; // -180~180
      
      // FOV外は描画しない
      const fovHDeg = this.options.fovH * 180 / Math.PI;
      if (Math.abs(rel) > fovHDeg / 2 + 10) return;
      
      // 標高差と仰角計算
      const elevDiff = (cp.elevation ?? 650) - (currentPosition.elevation ?? 650);
      const horiz = Math.max(1, d);
      const elevAngle = Math.atan2(elevDiff, horiz);
      
      // 画面の向きを考慮したピッチ補正を取得
      const correctedPitchDeg = this._getCurrentCorrectedPitch();
      const devicePitchRad = correctedPitchDeg * Math.PI / 180;
      const screenElevAngle = elevAngle - devicePitchRad;
      
      // 画面座標計算(ピッチ補正済み + 縦軸オフセット)
      const relRad = rel * Math.PI / 180;
      const x = w/2 + (relRad / this.options.fovH) * w;
      const y = h/2 - screenElevAngle / this.options.fovV * h + this.options.verticalOffset;
      
      // 画面外チェック(マージン付き)
      if (x < -50 || x > w + 50 || y < -50 || y > h + 50) return;
      
      // ========== 色の決定 ==========
      // すべてのCPで距離ベースの色を使用
      const markerColor = this._getDistanceColor(d, minDist, maxDist);
      
      // 完了状態は縁の色で表現
      const borderColor = completedCheckpoints.has(cp.id) ? '#48bb78' : '#fff';
      
      // マーカー描画
      const r = sizes.marker / 2;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI*2);
      ctx.fillStyle = markerColor;
      ctx.fill();
      
      // 縁(完了状態を示す)
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 3;
      ctx.stroke();
      
      // ポイント表示
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${sizes.font}px system-ui`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(cp.points, x, y);
      
      // ETAtextの計算
      const eta = this.geoMgr?.calculateETA(d, elevDiff) || 0;
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
      
      drawnCount++;
    });
    
    if (drawnCount === 0 && this.options.debugMode) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = 'bold 16px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(`⚠️ 範囲内にCPなし (${this.options.range}m)`, w/2, h/2);
    }
    
    // デバッグ情報(デバッグモードONの時のみ)
    if (this.options.debugMode) {
      this._drawDebugInfo(ctx, w, h);
    }
  }
  
  _drawDebugInfo(ctx, w, h) {
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(10, 10, 320, 300);
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 2;
    ctx.strokeRect(10, 10, 320, 300);
    
    ctx.fillStyle = '#00ff00';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'left';
    
    let y = 30;
    const lineHeight = 16;
    
    ctx.fillStyle = '#00ffff';
    ctx.fillText('=== ARビュー デバッグ ===', 15, y); y += lineHeight + 5;
    
    ctx.fillStyle = '#00ff00';
    
    // プラットフォーム情報
    ctx.fillText(`📱 Platform: ${this.isIPad ? 'iPad' : this.isIOS ? 'iPhone/iPod' : this.isAndroid ? 'Android' : 'Other'}`, 15, y); y += lineHeight;
    
    // 画面の向き
    const orientation = this._getScreenOrientation();
    ctx.fillText(`📐 Orientation: ${orientation}`, 15, y); y += lineHeight;
    y += 5;
    
    // OrientationManager情報
    if (this.orientationMgr) {
      const heading = this.orientationMgr.getHeading();
      const pitch = this.orientationMgr.getPitch();
      const roll = this.orientationMgr.getRoll();
      const mode = this.orientationMgr.getMode();
      
      ctx.fillText(`Heading: ${Math.round(heading)}°`, 15, y); y += lineHeight;
      ctx.fillText(`Pitch(β): ${Math.round(pitch)}°`, 15, y); y += lineHeight;
      ctx.fillText(`Roll(γ): ${Math.round(roll)}°`, 15, y); y += lineHeight;
      
      const corrected = this._getCurrentCorrectedPitch();
      ctx.fillStyle = '#ffd700';
      ctx.fillText(`>>> Corrected: ${Math.round(corrected)}°`, 15, y); y += lineHeight;
      ctx.fillStyle = '#00ff00';
      
      ctx.fillText(`Mode: ${mode}`, 15, y); y += lineHeight;
      
      // 縦軸オフセット
      ctx.fillStyle = '#ff6b9d';
      ctx.fillText(`V Offset: ${this.options.verticalOffset}px`, 15, y); y += lineHeight;
      ctx.fillStyle = '#00ff00';
      
      y += 5;
    }
    
    // 位置情報
    const pos = this.stateMgr?.currentPosition;
    if (pos) {
      ctx.fillText(`Lat: ${pos.lat.toFixed(6)}`, 15, y); y += lineHeight;
      ctx.fillText(`Lng: ${pos.lng.toFixed(6)}`, 15, y); y += lineHeight;
      ctx.fillText(`Elev: ${(pos.elevation || 0).toFixed(1)}m`, 15, y); y += lineHeight;
    } else {
      ctx.fillStyle = '#ff6b9d';
      ctx.fillText('⚠️ 位置情報なし', 15, y); y += lineHeight;
      ctx.fillStyle = '#00ff00';
    }
    y += 5;
    
    // CP情報
    const cpCount = this.stateMgr?.checkpoints?.length || 0;
    const completedCount = this.stateMgr?.completedIds?.size || 0;
    ctx.fillText(`CPs: ${completedCount}/${cpCount}`, 15, y); y += lineHeight;
    
    // AR設定
    ctx.fillText(`Range: ${this.options.range}m`, 15, y); y += lineHeight;
    ctx.fillText(`FOV: ${Math.round(this.options.fovH*180/Math.PI)}°`, 15, y); y += lineHeight;
    ctx.fillText(`FPS: ${this.fpsLimit}`, 15, y); y += lineHeight;
  }
  
  // ========== 更新 ==========
  update(currentPosition, heading, pitch) {
    // ピッチインジケーター更新
    this.updatePitchIndicator(pitch);
    
    // 最寄りCP情報更新
    const checkpoints = this.stateMgr?.checkpoints || [];
    const completedIds = this.stateMgr?.completedIds || new Set();
    this.updateNearestInfo(currentPosition, checkpoints, completedIds);
  }
  
  // ========== ピッチインジケーター(シンプル再構築版) ==========
  updatePitchIndicator(pitch) {
    const leftMarker = document.querySelector('#pitch-indicator-left .pitch-marker');
    const rightMarker = document.querySelector('#pitch-indicator-right .pitch-marker');
    
    if (!leftMarker || !rightMarker) return;
    
    // シンプルな補正: 引数のpitchを信頼して使用
    const correctedPitch = this._correctPitchForScreen(pitch);
    
    // -30°~+30°の範囲に制限
    const clampedPitch = Math.max(-30, Math.min(30, correctedPitch));
    
    // インジケーター位置を計算
    // +30° (上向き) → 0% (top)
    // 0° (水平) → 50% (center)
    // -30° (下向き) → 100% (bottom)
    const markerTop = 50 - (clampedPitch / 30) * 50;
    
    leftMarker.style.top = `${markerTop}%`;
    rightMarker.style.top = `${markerTop}%`;
    
    // デバッグモード時は値を表示
    if (this.options.debugMode) {
      this._logPitchDebug(pitch, correctedPitch, clampedPitch, markerTop);
    }
  }
  
  /**
   * 画面の向きに応じてピッチを補正(シンプル版)
   */
  _correctPitchForScreen(rawPitch) {
    const orientation = this._getScreenOrientation();
    
    // Portrait(縦持ち): beta = 90°が水平なので、90を引く
    if (orientation.includes('portrait')) {
      return rawPitch - 90;
    }
    
    // Landscape(横持ち): gammaを使用
    if (orientation.includes('landscape')) {
      const roll = this.orientationMgr?.getRoll() || 0;
      
      // landscape-secondary(ホームボタンが左)は符号を反転
      if (orientation === 'landscape-secondary') {
        return -roll;
      }
      
      // landscape-primary(ホームボタンが右)はそのまま
      return roll;
    }
    
    // フォールバック: portraitとして扱う
    return rawPitch - 90;
  }
  
  /**
   * 現在の補正済みピッチを取得(描画用)
   */
  _getCurrentCorrectedPitch() {
    const rawPitch = this.orientationMgr?.getPitch() || 0;
    return this._correctPitchForScreen(rawPitch);
  }
  
  /**
   * 画面の向きを取得(シンプル版)
   */
  _getScreenOrientation() {
    // 最優先: Screen Orientation API
    if (screen.orientation?.type) {
      return screen.orientation.type;
    }
    
    // フォールバック: 幅と高さから推測
    // primary/secondaryの区別はできないが、portrait/landscapeは判定可能
    if (window.innerWidth > window.innerHeight) {
      return 'landscape-primary';
    }
    
    return 'portrait-primary';
  }
  
  /**
   * ピッチのデバッグ情報をログ出力
   */
  _logPitchDebug(rawPitch, correctedPitch, clampedPitch, markerPosition) {
    const orientation = this._getScreenOrientation();
    const roll = this.orientationMgr?.getRoll() || 0;
    
    if (this._lastDebugLog && Date.now() - this._lastDebugLog < 1000) {
      return; // 1秒に1回だけログ
    }
    this._lastDebugLog = Date.now();
    
    console.log('[AR Pitch Debug]', {
      orientation: orientation,
      rawPitch: Math.round(rawPitch) + '°',
      roll: Math.round(roll) + '°',
      corrected: Math.round(correctedPitch) + '°',
      clamped: Math.round(clampedPitch) + '°',
      markerTop: Math.round(markerPosition) + '%'
    });
  }
  
  updateNearestInfo(currentPosition, checkpoints, completedIds) {
    const infoName = document.querySelector('#ar-nearest-info .info-name');
    const infoDetails = document.querySelector('#ar-nearest-info .info-details');
    
    if (!infoName || !infoDetails || !currentPosition || !this.geoMgr) {
      if (infoName) infoName.textContent = '最寄りのターゲット';
      if (infoDetails) infoDetails.innerHTML = '<span style="color:#718096;">位置情報を取得中...</span>';
      return;
    }
    
    let nearestCP = null;
    let nearestDist = Infinity;
    
    checkpoints.forEach(cp => {
      if (completedIds.has(cp.id)) return;
      const d = this.geoMgr.distance(currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
      if (d < nearestDist) {
        nearestDist = d;
        nearestCP = cp;
      }
    });
    
    if (nearestCP) {
      const elevDiff = (nearestCP.elevation || 650) - (currentPosition.elevation || 650);
      const eta = this.geoMgr.calculateETA(nearestDist, elevDiff);
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
  
  // ========== センサーモード更新 ==========
  updateSensorMode(mode) {
    this.sensorMode = mode;
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
      
      // 段階的機能制限(3分経過で警告)
      if (this.secondsLeft === 120) {
        this.log('⚠️ AR残り2分:バッテリー節約のため間もなく終了します');
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
    return this.options.debugMode;
  }
  
  // ========== デバッグボタン ==========
  _addDebugButtons() {
    const arView = document.getElementById('ar-view');
    if (!arView || arView.querySelector('.debug-buttons')) return;
    
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'debug-buttons';
    buttonContainer.style.cssText = `
      position: absolute;
      top: 10px;
      left: 10px;
      display: flex;
      gap: 8px;
      z-index: 1000;
    `;
    
    // デバッグボタン
    const debugBtn = document.createElement('button');
    debugBtn.textContent = '🐛';
    debugBtn.title = 'デバッグ情報を表示/非表示';
    debugBtn.style.cssText = `
      background: rgba(0, 0, 0, 0.7);
      color: #00ff00;
      border: 2px solid #00ff00;
      padding: 8px 12px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 16px;
      transition: all 0.2s;
      pointer-events: auto;
    `;
    debugBtn.onmouseover = () => {
      debugBtn.style.background = 'rgba(0, 255, 0, 0.2)';
      debugBtn.style.transform = 'scale(1.1)';
    };
    debugBtn.onmouseout = () => {
      debugBtn.style.background = 'rgba(0, 0, 0, 0.7)';
      debugBtn.style.transform = 'scale(1)';
    };
    debugBtn.onclick = () => {
      const isEnabled = this.toggleDebugMode();
      debugBtn.style.color = isEnabled ? '#ffd700' : '#00ff00';
      debugBtn.style.borderColor = isEnabled ? '#ffd700' : '#00ff00';
    };
    
    // 診断ボタン
    const diagBtn = document.createElement('button');
    diagBtn.textContent = '🔍';
    diagBtn.title = 'AR診断';
    diagBtn.style.cssText = `
      background: rgba(0, 0, 0, 0.7);
      color: #00bfff;
      border: 2px solid #00bfff;
      padding: 8px 12px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 16px;
      transition: all 0.2s;
      pointer-events: auto;
    `;
    diagBtn.onmouseover = () => {
      diagBtn.style.background = 'rgba(0, 191, 255, 0.2)';
      diagBtn.style.transform = 'scale(1.1)';
    };
    diagBtn.onmouseout = () => {
      diagBtn.style.background = 'rgba(0, 0, 0, 0.7)';
      diagBtn.style.transform = 'scale(1)';
    };
    diagBtn.onclick = () => this.runDiagnostics();
    
    buttonContainer.appendChild(debugBtn);
    buttonContainer.appendChild(diagBtn);
    arView.appendChild(buttonContainer);
    
    this.log('✅ ARデバッグボタンを追加');
  }
  
  _removeDebugButtons() {
    const arView = document.getElementById('ar-view');
    const buttons = arView?.querySelector('.debug-buttons');
    if (buttons) {
      arView.removeChild(buttons);
    }
  }
  
  // ========== 診断機能 ==========
  runDiagnostics() {
    const report = [];
    
    report.push('🔍 === ARビュー診断レポート ===\n');
    
    // 1. 依存マネージャー
    report.push('【依存性チェック】');
    report.push(`StateMgr: ${this.stateMgr ? '✅' : '❌'}`);
    report.push(`GeoMgr: ${this.geoMgr ? '✅' : '❌'}`);
    report.push(`OrientationMgr: ${this.orientationMgr ? '✅' : '❌'}`);
    report.push('');
    
    // 2. デバイス情報
    report.push('【デバイス情報】');
    report.push(`Platform: ${this.isIPad ? 'iPad' : this.isIOS ? 'iPhone/iPod' : this.isAndroid ? 'Android' : 'Other'}`);
    report.push(`User Agent: ${navigator.userAgent.substring(0, 60)}...`);
    report.push(`Max Touch Points: ${navigator.maxTouchPoints}`);
    report.push('');
    
    // 3. 画面の向き
    report.push('【画面の向き】');
    const orientation = this._getScreenOrientation();
    report.push(`Orientation: ${orientation}`);
    report.push('');
    
    // 4. センサー状態
    report.push('【センサー状態】');
    if (this.orientationMgr) {
      const heading = this.orientationMgr.getHeading();
      const pitch = this.orientationMgr.getPitch();
      const roll = this.orientationMgr.getRoll();
      const mode = this.orientationMgr.getMode();
      const corrected = this._correctPitchForScreen(pitch);
      
      report.push(`方位: ${Math.round(heading)}°`);
      report.push(`ピッチ(beta): ${Math.round(pitch)}°`);
      report.push(`ロール(gamma): ${Math.round(roll)}°`);
      report.push(`>>> 補正後ピッチ: ${Math.round(corrected)}° <<<`);
      report.push(`モード: ${mode}`);
      report.push(`キャリブ必要: ${this.orientationMgr.needsCalibration() ? '⚠️ はい' : '✅ いいえ'}`);
    } else {
      report.push('❌ OrientationMgrなし');
    }
    report.push('');
    
    // 5. 位置情報
    report.push('【位置情報】');
    const pos = this.stateMgr?.currentPosition;
    if (pos) {
      report.push(`✅ 取得済み`);
      report.push(`緯度: ${pos.lat.toFixed(6)}`);
      report.push(`経度: ${pos.lng.toFixed(6)}`);
      report.push(`精度: ±${pos.accuracy?.toFixed(1) || 'N/A'}m`);
      report.push(`標高: ${(pos.elevation || 0).toFixed(1)}m`);
    } else {
      report.push('❌ 未取得');
    }
    report.push('');
    
    // 6. チェックポイント
    report.push('【チェックポイント】');
    const checkpoints = this.stateMgr?.checkpoints || [];
    const completedIds = this.stateMgr?.completedIds || new Set();
    report.push(`総数: ${checkpoints.length}`);
    report.push(`クリア済み: ${completedIds.size}`);
    
    if (pos && checkpoints.length > 0) {
      const inRange = checkpoints.filter(cp => {
        const d = this.geoMgr?.distance(pos.lat, pos.lng, cp.lat, cp.lng) || Infinity;
        return d <= this.options.range;
      });
      report.push(`範囲内: ${inRange.length} (${this.options.range}m)`);
      
      if (inRange.length === 0) {
        report.push('⚠️ 範囲内にCPなし→レンジを拡大してください');
      }
    }
    report.push('');
    
    // 7. カメラ
    report.push('【カメラ】');
    report.push(`ストリーム: ${this.stream ? '✅' : '❌'}`);
    report.push(`ビデオ再生中: ${this.video?.paused === false ? '✅' : '❌'}`);
    
    // カメラのfacingModeを取得
    if (this.stream) {
      const videoTracks = this.stream.getVideoTracks();
      if (videoTracks.length > 0) {
        const settings = videoTracks[0].getSettings();
        report.push(`FacingMode: ${settings.facingMode || 'N/A'}`);
        report.push(`解像度: ${settings.width}x${settings.height}`);
      }
    }
    report.push('');
    
    // 8. レンダリング
    report.push('【レンダリング】');
    report.push(`アニメID: ${this.animationId ? '✅ 動作中' : '❌ 停止'}`);
    report.push(`FPS制限: ${this.fpsLimit}`);
    report.push(`Canvas: ${this.canvas?.width}x${this.canvas?.height}`);
    report.push('');
    
    // 9. 設定
    report.push('【設定】');
    report.push(`レンジ: ${this.options.range}m`);
    report.push(`FOV: ${Math.round(this.options.fovH*180/Math.PI)}° × ${Math.round(this.options.fovV*180/Math.PI)}°`);
    report.push(`縦軸オフセット: ${this.options.verticalOffset}px`);
    report.push(`デバッグモード: ${this.options.debugMode ? 'ON' : 'OFF'}`);
    
    const message = report.join('\n');
    console.log(message);
    alert(message);
    
    this.log('🔍 診断完了');
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
    if (!this.distanceCache[cpId] && this.geoMgr) {
      this.distanceCache[cpId] = this.geoMgr.distance(lat1, lon1, lat2, lon2);
    }
    return this.distanceCache[cpId] || 0;
  }
  
  /**
   * 距離に応じた色を計算(view-sonar.jsと同じロジック)
   * @param {number} distance - 対象までの距離(m)
   * @param {number} minDist - 範囲内の最小距離(m)
   * @param {number} maxDist - 範囲内の最大距離(m)
   * @returns {string} HSL色文字列
   */
  _getDistanceColor(distance, minDist, maxDist) {
    // 距離差がない場合は緑
    if (maxDist === minDist) return 'hsl(120, 80%, 50%)';
    
    // 0.0(最近)~1.0(最遠)に正規化
    const normalized = (distance - minDist) / (maxDist - minDist);
    
    let hue;
    // 前半50%: 青(240°) → 緑(120°)
    if (normalized <= 0.5) {
      hue = 240 - (120 * normalized * 2);
    } 
    // 後半50%: 緑(120°) → 赤(0°)
    else {
      hue = 120 - (120 * (normalized - 0.5) * 2);
    }
    
    return `hsl(${hue}, 80%, 50%)`;
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
  debugLog('✅ ARView v1.3.0 (マーカー縦軸調整機能追加) 読み込み完了');
} else {
  console.log('[ARView] v1.3.0 - Marker vertical offset feature added');
}
