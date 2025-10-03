/**
 * OrientationManager - マルチプラットフォーム対応版
 * iOS/Android/Windows/Linux対応
 * AbsoluteOrientationSensor + DeviceOrientationEvent + キャリブレーション
 * 
 * 修正版: 座標系統一 - iOS/Android両対応
 * バージョン: 1.5.0 - 2025-01-03
 * 変更点: Android座標系補正の条件を修正（absolute属性に関わらず補正）
 */

class OrientationManager {
  constructor() {
    // 基本状態
    this.currentHeading = 0;
    this.smoothedHeading = 0;
    this.devicePitch = 0;
    this.deviceRoll = 0;
    this.confidence = 0;
    
    // センサーモード
    // 'ios' | 'absolute-sensor' | 'absolute-event' | 'relative-calibrated' | 'relative'
    this.mode = null;
    
    // センサーインスタンス
    this.absoluteSensor = null;
    this.deviceOrientationListener = null;
    
    // キャリブレーション
    this.calibrationOffset = 0;
    this.isCalibrated = false;
    
    // 平滑化設定(モード別)
    this.smoothingFactors = {
      compass: 0.15,  // コンパスモード:滑らか
      ar: 0.35,       // ARモード:反応重視
      sonar: 0.15     // ソナーモード:滑らか
    };
    this.currentViewMode = 'compass';
    
    // コールバック
    this.onUpdate = null;
    this.onModeChange = null;
    
    // プラットフォーム情報（iPadOS 13+対応）
    this.isIOS = this.detectIOS();
    this.isAndroid = /Android/.test(navigator.userAgent);
    
    // iOS権限状態
    this.iosPermissionGranted = false;
    
    // デバッグ
    this.updateCount = 0;
    this.lastUpdateTime = 0;
  }
  
  // ========== iOS/iPadOS検出（iPadOS 13+対応） ==========
  detectIOS() {
    const ua = navigator.userAgent;
    
    // 1. 従来のiOS検出（iPhone, iPod, iPad）
    if (/iPad|iPhone|iPod/.test(ua) && !window.MSStream) {
      this.log('✅ iOS検出: 従来のUA');
      return true;
    }
    
    // 2. iPadOS 13+検出
    // Macintosh UAだが、タッチデバイス（maxTouchPoints > 1）
    if (/Macintosh/.test(ua) && navigator.maxTouchPoints && navigator.maxTouchPoints > 1) {
      this.log('✅ iPadOS 13+検出: Macintosh UA + タッチデバイス');
      return true;
    }
    
    // 3. DeviceOrientationEvent.requestPermissionの存在確認
    // これはiOS 13+特有のAPI
    if (typeof DeviceOrientationEvent !== 'undefined' && 
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      this.log('✅ iOS検出: requestPermission APIあり');
      return true;
    }
    
    return false;
  }
  
  // ========== 初期化 ==========
  async init() {
    this.log('🧭 OrientationManager初期化開始');
    this.log(`📱 プラットフォーム: ${this.isIOS ? 'iOS/iPadOS' : this.isAndroid ? 'Android' : 'Other'}`);
    
    // 保存されたキャリブレーションを読み込み
    this.loadCalibration();
    
    // iOS 13+の権限チェック
    if (this.isIOS && typeof DeviceOrientationEvent.requestPermission === 'function') {
      this.log('⚠️ iOS 13+: センサー権限が必要です');
      // 権限リクエストは外部(app.js)から呼び出されるまで待機
      return false;
    }
    
    // センサー検出を開始
    const success = await this.detectBestSensor();
    
    if (success) {
      this.log(`✅ センサー初期化完了: ${this.mode}`);
      this.notifyModeChange();
    } else {
      this.log('⚠️ センサー初期化に問題があります');
    }
    
    return success;
  }
  
  // ========== iOS権限リクエスト(外部から呼び出し) ==========
  async requestIOSPermission() {
    if (!this.isIOS) {
      this.log('❌ iOSではありません');
      return { success: false, reason: 'not-ios' };
    }
    
    if (typeof DeviceOrientationEvent.requestPermission !== 'function') {
      this.log('✅ iOS 12以下: 権限不要');
      // iOS 12以下は権限不要なので、センサーを開始
      const success = await this.detectBestSensor();
      return { success };
    }
    
    try {
      this.log('📱 iOS権限をリクエスト中...');
      const permission = await DeviceOrientationEvent.requestPermission();
      
      if (permission === 'granted') {
        this.log('✅ iOS権限が許可されました');
        this.iosPermissionGranted = true;
        
        // 権限取得後、センサーを開始
        const success = await this.detectBestSensor();
        return { success, permission };
      } else {
        this.log('❌ iOS権限が拒否されました');
        return { success: false, permission };
      }
    } catch (error) {
      this.log(`❌ iOS権限リクエストエラー: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
  
  // ========== iOS権限が必要かチェック ==========
  needsIOSPermission() {
    return this.isIOS && 
           typeof DeviceOrientationEvent.requestPermission === 'function' &&
           !this.iosPermissionGranted;
  }
  
  // ========== センサー検出 ==========
  async detectBestSensor() {
    // 1. iOS専用: webkitCompassHeading
    if (this.isIOS) {
      const iosSuccess = await this.startIOSOrientation();
      if (iosSuccess) return true;
    }
    
    // 2. AbsoluteOrientationSensor (Android/Windows/Linux)
    if ('AbsoluteOrientationSensor' in window) {
      const sensorSuccess = await this.startAbsoluteSensor();
      if (sensorSuccess) return true;
    }
    
    // 3. DeviceOrientationEvent
    const deviceSuccess = await this.startDeviceOrientation();
    return deviceSuccess;
  }
  
  // ========== iOS専用センサー ==========
  async startIOSOrientation() {
    try {
      // iOS 13+で権限が未取得の場合はスキップ
      if (this.needsIOSPermission()) {
        this.log('⏸️ iOS権限待機中...');
        return false;
      }
      
      this.deviceOrientationListener = (e) => {
        if (e.webkitCompassHeading !== undefined) {
          // iOS: webkitCompassHeadingは正しい磁北基準の方位
          // そのまま使用（反転不要）
          this.currentHeading = e.webkitCompassHeading;
          this.devicePitch = e.beta || 0;
          this.deviceRoll = e.gamma || 0;
          this.confidence = 1.0;
          this.mode = 'ios';
          
          // 平滑化
          const smoothing = this.smoothingFactors[this.currentViewMode];
          this.smoothedHeading = this.smoothAngle(
            this.smoothedHeading, 
            this.currentHeading, 
            smoothing
          );
          
          this.notifyUpdate();
        }
      };
      
      window.addEventListener('deviceorientation', this.deviceOrientationListener);
      
      // 初回データを待つ
      await new Promise((resolve) => {
        const checkData = () => {
          if (this.mode === 'ios') {
            resolve();
          } else {
            setTimeout(checkData, 100);
          }
        };
        checkData();
        setTimeout(resolve, 2000); // タイムアウト
      });
      
      if (this.mode === 'ios') {
        this.log('✅ iOS方位センサー開始');
        return true;
      } else {
        window.removeEventListener('deviceorientation', this.deviceOrientationListener);
        this.deviceOrientationListener = null;
        return false;
      }
    } catch (error) {
      this.log(`❌ iOS方位センサー失敗: ${error.message}`);
      return false;
    }
  }
  
  // ========== AbsoluteOrientationSensor ==========
  async startAbsoluteSensor() {
    try {
      // 権限チェック
      const permissions = await Promise.all([
        navigator.permissions.query({ name: 'accelerometer' }),
        navigator.permissions.query({ name: 'magnetometer' }),
        navigator.permissions.query({ name: 'gyroscope' })
      ]);
      
      if (permissions.some(p => p.state === 'denied')) {
        this.log('❌ センサー権限が拒否されています');
        return false;
      }
      
      // センサー初期化
      this.absoluteSensor = new AbsoluteOrientationSensor({
        frequency: 30,
        referenceFrame: 'device'
      });
      
      let errorOccurred = false;
      
      this.absoluteSensor.addEventListener('reading', () => {
        const q = this.absoluteSensor.quaternion;
        const angles = this.quaternionToEuler(q);
        
        // Android: Quaternionから計算した方位をそのまま使用
        this.currentHeading = angles.yaw;
        this.devicePitch = angles.pitch;
        this.deviceRoll = angles.roll;
        this.confidence = 1.0;
        this.mode = 'absolute-sensor';
        
        // 平滑化
        const smoothing = this.smoothingFactors[this.currentViewMode];
        this.smoothedHeading = this.smoothAngle(
          this.smoothedHeading,
          this.currentHeading,
          smoothing
        );
        
        this.notifyUpdate();
      });
      
      this.absoluteSensor.addEventListener('error', (e) => {
        this.log(`❌ AbsoluteOrientationSensor エラー: ${e.error.name}`);
        errorOccurred = true;
        this.fallbackToNextSensor();
      });
      
      this.absoluteSensor.start();
      
      // センサーの起動を待つ
      await new Promise((resolve) => {
        const checkSensor = () => {
          if (this.mode === 'absolute-sensor' || errorOccurred) {
            resolve();
          } else {
            setTimeout(checkSensor, 100);
          }
        };
        checkSensor();
        setTimeout(resolve, 2000); // タイムアウト
      });
      
      if (this.mode === 'absolute-sensor' && !errorOccurred) {
        this.log('✅ AbsoluteOrientationSensor開始');
        return true;
      } else {
        if (this.absoluteSensor) {
          this.absoluteSensor.stop();
          this.absoluteSensor = null;
        }
        return false;
      }
    } catch (error) {
      this.log(`❌ AbsoluteOrientationSensor失敗: ${error.message}`);
      return false;
    }
  }
  
  // ========== Quaternionから角度計算(修正版) ==========
  quaternionToEuler(q) {
    const [x, y, z, w] = q;
    
    // Yaw (方位角) - Z軸周りの回転
    const yaw = Math.atan2(
      2.0 * (w * z + x * y),
      1.0 - 2.0 * (y * y + z * z)
    ) * 180 / Math.PI;
    
    // Beta (前後傾斜): -180°~180°
    const beta = Math.atan2(
      2.0 * (w * x + y * z),
      1.0 - 2.0 * (x * x + y * y)
    ) * 180 / Math.PI;
    
    // Gamma (左右傾斜): -90°~90°
    const sinGamma = 2.0 * (w * y - z * x);
    const gamma = Math.asin(
      Math.max(-1, Math.min(1, sinGamma))
    ) * 180 / Math.PI;
    
    return {
      yaw: (yaw + 360) % 360,
      pitch: beta,
      roll: gamma
    };
  }
  
  // ========== DeviceOrientationEvent（修正版：Android座標系統一） ==========
  async startDeviceOrientation() {
    return new Promise((resolve) => {
      let resolved = false;
      
      this.deviceOrientationListener = (e) => {
        if (e.alpha === null) return;
        
        let rawHeading = e.alpha;
        
        // 🔧 修正: Androidの座標系補正（absolute属性に関わらず適用）
        //if (this.isAndroid) {
        //  rawHeading = (360 - rawHeading) % 360;
        //  this.log(`🔄 Android座標系補正: ${e.alpha.toFixed(1)}° → ${rawHeading.toFixed(1)}°`);
        //}
        
        if (e.absolute === true) {
          // 絶対モード(磁北基準)
          this.currentHeading = rawHeading;
          this.devicePitch = e.beta || 0;
          this.deviceRoll = e.gamma || 0;
          this.confidence = 0.8;
          this.mode = 'absolute-event';
        } else {
          // 相対モード
          this.currentHeading = (rawHeading - this.calibrationOffset + 360) % 360;
          this.devicePitch = e.beta || 0;
          this.deviceRoll = e.gamma || 0;
          this.confidence = this.isCalibrated ? 0.6 : 0.3;
          this.mode = this.isCalibrated ? 'relative-calibrated' : 'relative';
        }
        
        // 平滑化
        const smoothing = this.smoothingFactors[this.currentViewMode];
        this.smoothedHeading = this.smoothAngle(
          this.smoothedHeading,
          this.currentHeading,
          smoothing
        );
        
        this.notifyUpdate();
      };
      
      window.addEventListener('deviceorientation', this.deviceOrientationListener);
      
      // 1秒待ってabsoluteモードかチェック
      setTimeout(() => {
        if (this.mode) {
          this.log(`✅ DeviceOrientation開始: ${this.mode}`);
          resolved = true;
          resolve(true);
        } else {
          this.log('⚠️ DeviceOrientation: データなし');
          resolved = true;
          resolve(false);
        }
      }, 1000);
    });
  }
  
  // ========== キャリブレーション ==========
  calibrate() {
    if (this.mode === 'ios' || this.mode === 'absolute-sensor' || this.mode === 'absolute-event') {
      this.log('ℹ️ キャリブレーション不要(絶対モード)');
      return { success: false, reason: 'absolute-mode' };
    }
    
    // 現在のheadingを「北」として記録
    this.calibrationOffset = this.currentHeading;
    this.isCalibrated = true;
    this.mode = 'relative-calibrated';
    
    // LocalStorageに保存
    localStorage.setItem('orientation_calibration_offset', String(this.calibrationOffset));
    localStorage.setItem('orientation_calibration_timestamp', new Date().toISOString());
    
    this.log(`✅ キャリブレーション完了: offset=${this.calibrationOffset.toFixed(1)}°`);
    this.notifyModeChange();
    
    return { 
      success: true, 
      offset: this.calibrationOffset,
      timestamp: new Date().toISOString()
    };
  }
  
  loadCalibration() {
    const offset = localStorage.getItem('orientation_calibration_offset');
    const timestamp = localStorage.getItem('orientation_calibration_timestamp');
    
    if (offset) {
      this.calibrationOffset = parseFloat(offset);
      this.isCalibrated = true;
      this.log(`📂 キャリブレーション復元: ${this.calibrationOffset.toFixed(1)}° (${timestamp})`);
    }
  }
  
  clearCalibration() {
    this.calibrationOffset = 0;
    this.isCalibrated = false;
    localStorage.removeItem('orientation_calibration_offset');
    localStorage.removeItem('orientation_calibration_timestamp');
    
    if (this.mode === 'relative-calibrated') {
      this.mode = 'relative';
    }
    
    this.log('🗑️ キャリブレーションクリア');
    this.notifyModeChange();
  }
  
  // ========== フォールバック ==========
  async fallbackToNextSensor() {
    this.log('⚠️ センサーフォールバック実行');
    
    // 現在のセンサーを停止
    if (this.absoluteSensor) {
      try {
        this.absoluteSensor.stop();
      } catch (e) {
        // すでに停止している可能性
      }
      this.absoluteSensor = null;
    }
    
    if (this.deviceOrientationListener) {
      window.removeEventListener('deviceorientation', this.deviceOrientationListener);
      this.deviceOrientationListener = null;
    }
    
    // 次のセンサーを試行
    if (this.mode === 'absolute-sensor') {
      await this.startDeviceOrientation();
    } else if (this.mode === 'absolute-event') {
      // すでに最終フォールバック
      this.mode = 'relative';
      this.notifyModeChange();
    }
  }
  
  // ========== ユーティリティ ==========
  smoothAngle(current, target, factor) {
    let diff = target - current;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    return (current + diff * factor + 360) % 360;
  }
  
  getHeading() {
    return this.smoothedHeading;
  }
  
  getPitch() {
    return this.devicePitch;
  }
  
  getRoll() {
    return this.deviceRoll;
  }
  
  getMode() {
    return this.mode;
  }
  
  needsCalibration() {
    return this.mode === 'relative' && !this.isCalibrated;
  }
  
  // ========== モード切替 ==========
  setMode(viewMode) {
    this.currentViewMode = viewMode;
    this.log(`🔄 ビューモード切替: ${viewMode}`);
  }
  
  // ========== コールバック ==========
  notifyUpdate() {
    this.updateCount++;
    this.lastUpdateTime = Date.now();
    
    if (this.onUpdate) {
      this.onUpdate({
        heading: this.smoothedHeading,
        rawHeading: this.currentHeading,
        pitch: this.devicePitch,
        roll: this.deviceRoll,
        confidence: this.confidence,
        mode: this.mode,
        needsCalibration: this.needsCalibration(),
        updateCount: this.updateCount
      });
    }
    
    // グローバル変数更新(互換性)
    if (typeof window !== 'undefined') {
      window.currentHeading = this.smoothedHeading;
      window.smoothedHeading = this.smoothedHeading;
      window.devicePitch = this.devicePitch;
    }
  }
  
  notifyModeChange() {
    if (this.onModeChange) {
      this.onModeChange({
        mode: this.mode,
        needsCalibration: this.needsCalibration(),
        isCalibrated: this.isCalibrated
      });
    }
  }
  
  // ========== デバッグ情報 ==========
  getDebugInfo() {
    return {
      mode: this.mode,
      heading: Math.round(this.smoothedHeading),
      rawHeading: Math.round(this.currentHeading),
      pitch: Math.round(this.devicePitch),
      roll: Math.round(this.deviceRoll),
      confidence: Math.round(this.confidence * 100) + '%',
      needsCalibration: this.needsCalibration(),
      needsIOSPermission: this.needsIOSPermission(),
      iosPermissionGranted: this.iosPermissionGranted,
      calibration: {
        offset: this.calibrationOffset.toFixed(1),
        isCalibrated: this.isCalibrated,
        timestamp: localStorage.getItem('orientation_calibration_timestamp')
      },
      platform: this.isIOS ? 'iOS/iPadOS' : (this.isAndroid ? 'Android' : 'Other'),
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints,
      sensorAvailability: {
        ios: this.isIOS,
        absoluteSensor: 'AbsoluteOrientationSensor' in window,
        deviceOrientation: 'DeviceOrientationEvent' in window,
        requestPermission: typeof DeviceOrientationEvent !== 'undefined' && 
                          typeof DeviceOrientationEvent.requestPermission === 'function'
      },
      updates: this.updateCount,
      lastUpdate: this.lastUpdateTime ? new Date(this.lastUpdateTime).toISOString() : 'N/A'
    };
  }
  
  // ========== ロギング ==========
  log(message) {
    if (typeof debugLog === 'function') {
      debugLog(message);
    } else {
      console.log(`[OrientationManager] ${message}`);
    }
  }
}

// グローバルエクスポート
if (typeof window !== 'undefined') {
  window.OrientationManager = OrientationManager;
}

// 初期化完了ログ
if (typeof debugLog === 'function') {
  debugLog('✅ OrientationManager v1.5.0 (Android座標系補正対応) 読み込み完了');
} else {
  console.log('[OrientationManager] v1.5.0 - Android coordinate system fix applied');
}
