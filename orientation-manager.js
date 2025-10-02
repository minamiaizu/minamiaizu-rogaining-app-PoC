/**
 * OrientationManager - クリーンで保守しやすい方位処理システム
 * Android/iOS両対応、ARモードとコンパスモードの切り替え対応
 */
class OrientationManager {
  constructor() {
    // 基本状態
    this.currentHeading = 0;
    this.smoothedHeading = 0;
    this.lastStableHeading = 0;
    this.confidence = 1.0;
    
    // センサーデータ
    this.deviceAlpha = 0;
    this.deviceBeta = 0;
    this.deviceGamma = 0;
    
    // ジャイロデータ（ARモード用）
    this.gyroHeading = 0;
    this.lastGyroTimestamp = null;
    this.gyroCalibrated = false;
    this.gyroAvailable = false;
    
    // プラットフォーム検出
    this.platform = this.detectPlatform();
    
    // モード設定
    this.mode = 'compass'; // 'compass' or 'ar'
    
    // 平滑化パラメータ
    this.smoothingConfig = {
      compass: { stable: 0.08, unstable: 0.02 },
      ar: { stable: 0.05, unstable: 0.01 }
    };
    
    // コールバック
    this.onUpdate = null;
    
    // デバッグ情報
    this.debugInfo = {
      lastUpdate: Date.now(),
      updateCount: 0,
      driftCorrection: 0
    };
  }
  
  /**
   * プラットフォーム検出
   */
  detectPlatform() {
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    const isAndroid = /Android/.test(ua);
    const hasWebkitCompass = 'webkitCompassHeading' in (window.DeviceOrientationEvent.prototype || {});
    
    return {
      isIOS,
      isAndroid,
      hasWebkitCompass,
      name: isIOS ? 'iOS' : (isAndroid ? 'Android' : 'Unknown')
    };
  }
  
  /**
   * 初期化
   */
  async init() {
    try {
      // iOS権限リクエスト
      if (this.platform.isIOS) {
        await this.requestIOSPermissions();
      }
      
      // イベントリスナー設定
      this.setupOrientationListener();
      this.setupMotionListener();
      
      this.log('✅ OrientationManager初期化完了');
      return true;
    } catch (error) {
      this.log('❌ 初期化エラー: ' + error.message);
      return false;
    }
  }
  
  /**
   * iOS権限リクエスト
   */
  async requestIOSPermissions() {
    const permissions = [];
    
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      permissions.push(
        DeviceOrientationEvent.requestPermission()
          .then(state => ({ type: 'orientation', state }))
      );
    }
    
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      permissions.push(
        DeviceMotionEvent.requestPermission()
          .then(state => ({ type: 'motion', state }))
      );
    }
    
    const results = await Promise.all(permissions);
    results.forEach(result => {
      this.log(`📱 iOS ${result.type}権限: ${result.state}`);
    });
  }
  
  /**
   * 方位センサーリスナー設定
   */
  setupOrientationListener() {
    window.addEventListener('deviceorientation', (e) => {
      this.deviceAlpha = e.alpha;
      this.deviceBeta = e.beta;
      this.deviceGamma = e.gamma;
      
      // コンパスデータ処理
      const compassHeading = this.extractCompassHeading(e);
      if (compassHeading !== null) {
        this.processCompassData(compassHeading, e.beta);
      }
    });
  }
  
  /**
   * モーションセンサーリスナー設定
   */
  setupMotionListener() {
    window.addEventListener('devicemotion', (e) => {
      if (!e.rotationRate) return;
      
      const { alpha, beta, gamma } = e.rotationRate;
      if (alpha !== null || beta !== null || gamma !== null) {
        this.gyroAvailable = true;
      }
      
      // ARモードでのジャイロ処理
      if (this.mode === 'ar' && this.gyroAvailable) {
        this.updateGyroHeading(e.rotationRate, e.timeStamp || Date.now());
      }
    });
  }
  
  /**
   * コンパス値の抽出（プラットフォーム別）
   */
  extractCompassHeading(event) {
    if (this.platform.hasWebkitCompass && event.webkitCompassHeading !== undefined) {
      // iOS: webkitCompassHeadingを使用
      return event.webkitCompassHeading;
    } else if (event.alpha !== null) {
      // Android: alphaを北基準に変換
      return (360 - event.alpha) % 360;
    }
    return null;
  }
  
  /**
   * コンパスデータ処理
   */
  processCompassData(heading, beta) {
    if (this.mode === 'compass') {
      this.updateCompassMode(heading, beta);
    } else {
      this.updateARMode(heading, beta);
    }
  }
  
  /**
   * コンパスモード更新
   */
  updateCompassMode(heading, beta) {
    const stability = this.evaluateStability(beta, 'compass');
    
    if (stability.canUpdate) {
      // 角度の平滑化
      this.smoothedHeading = this.smoothAngle(
        this.smoothedHeading,
        heading,
        stability.smoothingFactor
      );
      this.currentHeading = heading;
      
      // 安定時の値を保存
      if (stability.confidence > 0.7) {
        this.lastStableHeading = this.smoothedHeading;
      }
      
      this.confidence = stability.confidence;
    } else {
      // 不安定時は最後の安定値を使用
      this.smoothedHeading = this.lastStableHeading;
      this.confidence = stability.confidence;
    }
    
    this.notifyUpdate(stability);
  }
  
  /**
   * ARモード更新
   */
  updateARMode(compassHeading, beta) {
    // 初回較正
    if (!this.gyroCalibrated && this.gyroAvailable) {
      this.gyroHeading = compassHeading;
      this.gyroCalibrated = true;
      this.log(`🎯 ジャイロ較正: ${Math.round(compassHeading)}°`);
    }
    
    const stability = this.evaluateStability(beta, 'ar');
    
    // ドリフト補正（安定時のみ）
    if (stability.canCorrect && this.gyroCalibrated) {
      const drift = this.calculateAngleDiff(compassHeading, this.gyroHeading);
      const correctionRate = 0.005; // 0.5%/フレーム
      this.gyroHeading += drift * correctionRate;
      this.debugInfo.driftCorrection = drift;
    }
    
    // ジャイロが使えない場合はコンパスフォールバック
    if (!this.gyroAvailable) {
      this.smoothedHeading = this.smoothAngle(
        this.smoothedHeading,
        compassHeading,
        stability.smoothingFactor
      );
    } else {
      this.smoothedHeading = this.gyroHeading;
    }
    
    this.confidence = stability.confidence;
    this.notifyUpdate(stability);
  }
  
  /**
   * ジャイロによる方位更新
   */
  updateGyroHeading(rotationRate, timestamp) {
    if (!this.lastGyroTimestamp) {
      this.lastGyroTimestamp = timestamp;
      return;
    }
    
    const dt = Math.min((timestamp - this.lastGyroTimestamp) / 1000, 0.1); // 最大100ms
    this.lastGyroTimestamp = timestamp;
    
    // Z軸回転を方位変化として使用
    let deltaHeading = rotationRate.alpha || rotationRate.z || 0;
    
    // プラットフォーム別補正
    if (this.platform.isIOS) {
      // iOSは軸の向きが異なる場合がある
      deltaHeading = -deltaHeading;
    }
    
    // 度/秒に変換（既に度の場合はそのまま、ラジアンの場合は変換）
    if (Math.abs(deltaHeading) > 10) {
      // おそらくラジアン/秒
      deltaHeading = deltaHeading * (180 / Math.PI);
    }
    
    this.gyroHeading += deltaHeading * dt;
    this.gyroHeading = (this.gyroHeading + 360) % 360;
  }
  
  /**
   * 安定性評価
   */
  evaluateStability(beta, mode) {
    const absBeta = Math.abs(beta);
    
    if (mode === 'compass') {
      // コンパスモード：水平を重視
      if (absBeta < 45) {
        return {
          canUpdate: true,
          canCorrect: true,
          confidence: 1.0,
          smoothingFactor: this.smoothingConfig.compass.stable,
          status: 'stable'
        };
      } else if (absBeta < 60) {
        return {
          canUpdate: true,
          canCorrect: true,
          confidence: 0.7,
          smoothingFactor: 0.05,
          status: 'semi-stable'
        };
      } else if (absBeta < 75) {
        return {
          canUpdate: true,
          canCorrect: false,
          confidence: 0.3,
          smoothingFactor: this.smoothingConfig.compass.unstable,
          status: 'unstable'
        };
      } else {
        return {
          canUpdate: false,
          canCorrect: false,
          confidence: 0.1,
          smoothingFactor: 0,
          status: 'frozen'
        };
      }
    } else {
      // ARモード：垂直も許容
      if (absBeta < 60) {
        return {
          canUpdate: true,
          canCorrect: true,
          confidence: 1.0,
          smoothingFactor: this.smoothingConfig.ar.stable,
          status: 'stable'
        };
      } else if (absBeta < 110) {
        return {
          canUpdate: true,
          canCorrect: false, // 垂直付近では補正しない
          confidence: 0.7,
          smoothingFactor: this.smoothingConfig.ar.unstable,
          status: 'vertical'
        };
      } else if (absBeta < 150) {
        return {
          canUpdate: true,
          canCorrect: false,
          confidence: 0.5,
          smoothingFactor: this.smoothingConfig.ar.unstable,
          status: 'overhead'
        };
      } else {
        return {
          canUpdate: true,
          canCorrect: false,
          confidence: 0.3,
          smoothingFactor: 0,
          status: 'inverted'
        };
      }
    }
  }
  
  /**
   * 角度の平滑化
   */
  smoothAngle(current, target, factor) {
    const diff = this.calculateAngleDiff(target, current);
    return (current + diff * factor + 360) % 360;
  }
  
  /**
   * 角度差計算（-180〜180）
   */
  calculateAngleDiff(angle1, angle2) {
    let diff = angle1 - angle2;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    return diff;
  }
  
  /**
   * モード切り替え
   */
  setMode(mode) {
    if (this.mode === mode) return;
    
    this.mode = mode;
    this.gyroCalibrated = false;
    this.lastGyroTimestamp = null;
    this.log(`🔄 モード切替: ${mode}`);
    
    // ARモードの場合、ジャイロが使えるか確認
    if (mode === 'ar' && !this.gyroAvailable) {
      this.log('⚠️ ジャイロ未検出 - コンパスフォールバック');
    }
  }
  
  /**
   * 更新通知
   */
  notifyUpdate(stability) {
    this.debugInfo.lastUpdate = Date.now();
    this.debugInfo.updateCount++;
    
    if (this.onUpdate) {
      this.onUpdate({
        heading: this.smoothedHeading,
        rawHeading: this.currentHeading,
        confidence: this.confidence,
        status: stability.status,
        mode: this.mode,
        platform: this.platform.name,
        gyroAvailable: this.gyroAvailable,
        beta: this.deviceBeta
      });
    }
  }
  
  /**
   * デバッグログ
   */
  log(message) {
    if (typeof debugLog === 'function') {
      debugLog(message);
    } else {
      console.log(`[OrientationManager] ${message}`);
    }
  }
  
  /**
   * 現在の方位取得
   */
  getHeading() {
    return this.smoothedHeading;
  }
  
  /**
   * デバッグ情報取得
   */
  getDebugInfo() {
    return {
      ...this.debugInfo,
      heading: Math.round(this.smoothedHeading),
      confidence: Math.round(this.confidence * 100) + '%',
      mode: this.mode,
      gyro: this.gyroAvailable ? 'OK' : 'NG',
      platform: this.platform.name
    };
  }
}

// エクスポート（グローバル変数として利用可能に）
if (typeof window !== 'undefined') {
  window.OrientationManager = OrientationManager;
}
