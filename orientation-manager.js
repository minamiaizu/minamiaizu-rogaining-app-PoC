/**
 * OrientationManager - マルチプラットフォーム対応版
 * iOS/Android/Windows/Linux対応
 * AbsoluteOrientationSensor + DeviceOrientationEvent + キャリブレーション
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
    
    // 平滑化設定（モード別）
    this.smoothingFactors = {
      compass: 0.15,  // コンパスモード：滑らか
      ar: 0.35,       // ARモード：反応重視
      sonar: 0.15     // ソナーモード：滑らか
    };
    this.currentViewMode = 'compass';
    
    // コールバック
    this.onUpdate = null;
    this.onModeChange = null;
    
    // プラットフォーム情報
    this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    this.isAndroid = /Android/.test(navigator.userAgent);
    
    // デバッグ
    this.updateCount = 0;
    this.lastUpdateTime = 0;
  }
  
  // ========== 初期化 ==========
  async init() {
    this.log('🧭 OrientationManager初期化開始');
    
    // 保存されたキャリブレーションを読み込み
    this.loadCalibration();
    
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
      // iOS 13+: 権限リクエスト
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        const permission = await DeviceOrientationEvent.requestPermission();
        if (permission !== 'granted') {
          this.log('❌ iOS方位センサー権限拒否');
          return false;
        }
      }
      
      this.deviceOrientationListener = (e) => {
        if (e.webkitCompassHeading !== undefined) {
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
  
  // ========== Quaternionから角度計算 ==========
  quaternionToEuler(q) {
    const [x, y, z, w] = q;
    
    // Yaw (方位角) - Z軸周りの回転
    const yaw = Math.atan2(
      2.0 * (w * z + x * y),
      1.0 - 2.0 * (y * y + z * z)
    ) * 180 / Math.PI;
    
    // Pitch (前後傾斜) - X軸周りの回転
    const sinPitch = 2.0 * (w * y - z * x);
    const pitch = Math.asin(
      Math.max(-1, Math.min(1, sinPitch))
    ) * 180 / Math.PI;
    
    // Roll (左右傾斜) - Y軸周りの回転
    const roll = Math.atan2(
      2.0 * (w * x + y * z),
      1.0 - 2.0 * (x * x + y * y)
    ) * 180 / Math.PI;
    
    return {
      yaw: (yaw + 360) % 360,
      pitch: pitch,
      roll: roll
    };
  }
  
  // ========== DeviceOrientationEvent ==========
  async startDeviceOrientation() {
    return new Promise((resolve) => {
      let resolved = false;
      
      this.deviceOrientationListener = (e) => {
        if (e.alpha === null) return;
        
        const rawHeading = (360 - e.alpha) % 360;
        
        if (e.absolute === true) {
          // 絶対モード（磁北基準）
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
      this.log('ℹ️ キャリブレーション不要（絶対モード）');
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
    
    // グローバル変数更新（互換性）
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
      calibration: {
        offset: this.calibrationOffset.toFixed(1),
        isCalibrated: this.isCalibrated,
        timestamp: localStorage.getItem('orientation_calibration_timestamp')
      },
      platform: this.isIOS ? 'iOS' : (this.isAndroid ? 'Android' : 'Other'),
      sensorAvailability: {
        ios: this.isIOS,
        absoluteSensor: 'AbsoluteOrientationSensor' in window,
        deviceOrientation: 'DeviceOrientationEvent' in window
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
  debugLog('✅ OrientationManager (Enhanced Multi-Platform) 読み込み完了');
} else {
  console.log('[OrientationManager] Enhanced Multi-Platform version loaded');
}
