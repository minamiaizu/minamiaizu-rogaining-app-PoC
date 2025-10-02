/**
 * OrientationManager Extended - クォータニオン補間モード付き
 * 暴れ検出時に動的にクォータニオンモードへ切り替え
 */

// 簡易Quaternionクラス（外部ライブラリを使わない場合）
class SimpleQuaternion {
  constructor(w = 1, x = 0, y = 0, z = 0) {
    this.w = w;
    this.x = x;
    this.y = y;
    this.z = z;
  }
  
  static fromEuler(alpha, beta, gamma, order = 'ZXY') {
    // 度からラジアンへ
    const a = alpha * Math.PI / 180;
    const b = beta * Math.PI / 180;
    const g = gamma * Math.PI / 180;
    
    const ca = Math.cos(a / 2);
    const cb = Math.cos(b / 2);
    const cg = Math.cos(g / 2);
    const sa = Math.sin(a / 2);
    const sb = Math.sin(b / 2);
    const sg = Math.sin(g / 2);
    
    let w, x, y, z;
    
    // ZXY順序（DeviceOrientation用）
    if (order === 'ZXY') {
      w = ca * cb * cg - sa * sb * sg;
      x = sa * cb * cg - ca * sb * sg;
      y = ca * sb * cg + sa * cb * sg;
      z = ca * cb * sg + sa * sb * cg;
    }
    
    return new SimpleQuaternion(w, x, y, z);
  }
  
  toEuler(order = 'ZXY') {
    let alpha, beta, gamma;
    
    if (order === 'ZXY') {
      const sinr_cosp = 2 * (this.w * this.x + this.y * this.z);
      const cosr_cosp = 1 - 2 * (this.x * this.x + this.y * this.y);
      alpha = Math.atan2(sinr_cosp, cosr_cosp);
      
      const sinp = 2 * (this.w * this.y - this.z * this.x);
      beta = Math.abs(sinp) >= 1 ? 
        Math.sign(sinp) * Math.PI / 2 : 
        Math.asin(sinp);
      
      const siny_cosp = 2 * (this.w * this.z + this.x * this.y);
      const cosy_cosp = 1 - 2 * (this.y * this.y + this.z * this.z);
      gamma = Math.atan2(siny_cosp, cosy_cosp);
    }
    
    return {
      alpha: alpha * 180 / Math.PI,
      beta: beta * 180 / Math.PI,
      gamma: gamma * 180 / Math.PI
    };
  }
  
  // スラープ（球面線形補間）
  static slerp(q1, q2, t) {
    let dot = q1.w * q2.w + q1.x * q2.x + q1.y * q2.y + q1.z * q2.z;
    
    if (dot < 0) {
      q2 = new SimpleQuaternion(-q2.w, -q2.x, -q2.y, -q2.z);
      dot = -dot;
    }
    
    if (dot > 0.9995) {
      // 線形補間で十分
      return new SimpleQuaternion(
        q1.w + t * (q2.w - q1.w),
        q1.x + t * (q2.x - q1.x),
        q1.y + t * (q2.y - q1.y),
        q1.z + t * (q2.z - q1.z)
      );
    }
    
    const theta = Math.acos(dot);
    const sinTheta = Math.sin(theta);
    const w1 = Math.sin((1 - t) * theta) / sinTheta;
    const w2 = Math.sin(t * theta) / sinTheta;
    
    return new SimpleQuaternion(
      w1 * q1.w + w2 * q2.w,
      w1 * q1.x + w2 * q2.x,
      w1 * q1.y + w2 * q2.y,
      w1 * q1.z + w2 * q2.z
    );
  }
  
  normalize() {
    const mag = Math.sqrt(this.w * this.w + this.x * this.x + 
                         this.y * this.y + this.z * this.z);
    if (mag > 0) {
      this.w /= mag;
      this.x /= mag;
      this.y /= mag;
      this.z /= mag;
    }
    return this;
  }
}

class OrientationManagerExtended {
  constructor() {
    // 基本状態（既存）
    this.currentHeading = 0;
    this.smoothedHeading = 0;
    this.lastStableHeading = 0;
    this.confidence = 1.0;
    
    // センサーデータ
    this.deviceAlpha = 0;
    this.deviceBeta = 0;
    this.deviceGamma = 0;
    
    // ジャイロデータ
    this.gyroHeading = 0;
    this.lastGyroTimestamp = null;
    this.gyroCalibrated = false;
    this.gyroAvailable = false;
    
    // クォータニオンモード用
    this.quaternionMode = false;
    this.currentQuaternion = new SimpleQuaternion();
    this.targetQuaternion = new SimpleQuaternion();
    this.lastStableQuaternion = new SimpleQuaternion();
    
    // 暴れ検出用
    this.instabilityDetector = {
      samples: [],
      maxSamples: 10,
      threshold: 30, // 30度/秒以上の変化で不安定と判定
      consecutiveUnstable: 0,
      switchThreshold: 3 // 3フレーム連続で不安定なら切り替え
    };
    
    // プラットフォーム検出
    this.platform = this.detectPlatform();
    
    // モード設定
    this.mode = 'compass'; // 'compass' or 'ar'
    this.interpolationMode = 'euler'; // 'euler' or 'quaternion'
    
    // コールバック
    this.onUpdate = null;
    
    // デバッグ
    this.debugInfo = {
      instabilityLevel: 0,
      quaternionActive: false,
      switchCount: 0
    };
  }
  
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
  
  async init() {
    try {
      if (this.platform.isIOS) {
        await this.requestIOSPermissions();
      }
      
      this.setupOrientationListener();
      this.setupMotionListener();
      
      this.log('✅ OrientationManager Extended 初期化完了');
      return true;
    } catch (error) {
      this.log('❌ 初期化エラー: ' + error.message);
      return false;
    }
  }
  
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
  
  setupOrientationListener() {
    window.addEventListener('deviceorientation', (e) => {
      this.deviceAlpha = e.alpha;
      this.deviceBeta = e.beta;
      this.deviceGamma = e.gamma;
      
      // 暴れ検出
      this.detectInstability(e.alpha, e.beta, e.gamma);
      
      // コンパスデータ処理
      const compassHeading = this.extractCompassHeading(e);
      if (compassHeading !== null) {
        this.processCompassData(compassHeading, e.beta);
      }
    });
  }
  
  setupMotionListener() {
    window.addEventListener('devicemotion', (e) => {
      if (!e.rotationRate) return;
      
      const { alpha, beta, gamma } = e.rotationRate;
      if (alpha !== null || beta !== null || gamma !== null) {
        this.gyroAvailable = true;
      }
      
      if (this.mode === 'ar' && this.gyroAvailable) {
        this.updateGyroHeading(e.rotationRate, e.timeStamp || Date.now());
      }
    });
  }
  
  /**
   * 暴れ検出
   */
  detectInstability(alpha, beta, gamma) {
    const now = Date.now();
    
    // サンプル追加
    this.instabilityDetector.samples.push({
      alpha, beta, gamma, timestamp: now
    });
    
    // 古いサンプル削除
    if (this.instabilityDetector.samples.length > this.instabilityDetector.maxSamples) {
      this.instabilityDetector.samples.shift();
    }
    
    // 2つ以上のサンプルがないと判定できない
    if (this.instabilityDetector.samples.length < 2) return;
    
    // 変化率計算
    const latest = this.instabilityDetector.samples[this.instabilityDetector.samples.length - 1];
    const previous = this.instabilityDetector.samples[this.instabilityDetector.samples.length - 2];
    const dt = (latest.timestamp - previous.timestamp) / 1000;
    
    if (dt <= 0) return;
    
    // 角速度計算
    let alphaDiff = this.calculateAngleDiff(latest.alpha, previous.alpha);
    const angularVelocity = Math.abs(alphaDiff / dt);
    
    // 不安定判定
    const isUnstable = angularVelocity > this.instabilityDetector.threshold ||
                       Math.abs(beta) > 75 && Math.abs(beta) < 105;
    
    if (isUnstable) {
      this.instabilityDetector.consecutiveUnstable++;
    } else {
      this.instabilityDetector.consecutiveUnstable = 0;
    }
    
    // デバッグ情報
    this.debugInfo.instabilityLevel = angularVelocity;
    
    // モード切り替え判定
    this.updateInterpolationMode();
  }
  
  /**
   * 補間モード更新
   */
  updateInterpolationMode() {
    const shouldUseQuaternion = 
      this.instabilityDetector.consecutiveUnstable >= this.instabilityDetector.switchThreshold ||
      (Math.abs(this.deviceBeta) > 70 && Math.abs(this.deviceBeta) < 110);
    
    // モード切り替え
    if (shouldUseQuaternion && this.interpolationMode === 'euler') {
      this.interpolationMode = 'quaternion';
      this.debugInfo.quaternionActive = true;
      this.debugInfo.switchCount++;
      this.log('🔄 クォータニオンモードに切り替え');
      
      // 現在の姿勢をクォータニオンとして保存
      this.currentQuaternion = SimpleQuaternion.fromEuler(
        this.deviceAlpha, this.deviceBeta, this.deviceGamma
      );
    } else if (!shouldUseQuaternion && this.interpolationMode === 'quaternion') {
      this.interpolationMode = 'euler';
      this.debugInfo.quaternionActive = false;
      this.log('🔄 オイラーモードに復帰');
    }
  }
  
  extractCompassHeading(event) {
    if (this.platform.hasWebkitCompass && event.webkitCompassHeading !== undefined) {
      return event.webkitCompassHeading;
    } else if (event.alpha !== null) {
      return (360 - event.alpha) % 360;
    }
    return null;
  }
  
  processCompassData(heading, beta) {
    if (this.interpolationMode === 'quaternion') {
      this.updateWithQuaternion(heading, beta);
    } else {
      if (this.mode === 'compass') {
        this.updateCompassMode(heading, beta);
      } else {
        this.updateARMode(heading, beta);
      }
    }
  }
  
  /**
   * クォータニオン補間による更新
   */
  updateWithQuaternion(heading, beta) {
    // 新しい姿勢のクォータニオン
    this.targetQuaternion = SimpleQuaternion.fromEuler(
      this.deviceAlpha, 
      this.deviceBeta, 
      this.deviceGamma
    );
    
    // スラープで補間
    const t = 0.1; // 補間係数（0.1 = 10%新しい値）
    this.currentQuaternion = SimpleQuaternion.slerp(
      this.currentQuaternion,
      this.targetQuaternion,
      t
    );
    
    // オイラー角に戻す
    const euler = this.currentQuaternion.toEuler();
    
    // 方位を抽出
    let stabilizedHeading;
    if (this.platform.hasWebkitCompass) {
      stabilizedHeading = euler.alpha; // iOSは直接使用
    } else {
      stabilizedHeading = (360 - euler.alpha) % 360; // Androidは変換
    }
    
    this.smoothedHeading = stabilizedHeading;
    this.confidence = 0.8; // クォータニオンモードでは信頼度を少し下げる
    
    // 安定時の値を保存
    if (Math.abs(beta) < 60) {
      this.lastStableHeading = this.smoothedHeading;
      this.lastStableQuaternion = this.currentQuaternion;
    }
    
    this.notifyUpdate({
      status: 'quaternion',
      canUpdate: true,
      confidence: this.confidence
    });
  }
  
  updateCompassMode(heading, beta) {
    const stability = this.evaluateStability(beta, 'compass');
    
    if (stability.canUpdate) {
      this.smoothedHeading = this.smoothAngle(
        this.smoothedHeading,
        heading,
        stability.smoothingFactor
      );
      this.currentHeading = heading;
      
      if (stability.confidence > 0.7) {
        this.lastStableHeading = this.smoothedHeading;
      }
      
      this.confidence = stability.confidence;
    } else {
      this.smoothedHeading = this.lastStableHeading;
      this.confidence = stability.confidence;
    }
    
    this.notifyUpdate(stability);
  }
  
  updateARMode(compassHeading, beta) {
    if (!this.gyroCalibrated && this.gyroAvailable) {
      this.gyroHeading = compassHeading;
      this.gyroCalibrated = true;
      this.log(`🎯 ジャイロ較正: ${Math.round(compassHeading)}°`);
    }
    
    const stability = this.evaluateStability(beta, 'ar');
    
    if (stability.canCorrect && this.gyroCalibrated) {
      const drift = this.calculateAngleDiff(compassHeading, this.gyroHeading);
      const correctionRate = 0.005;
      this.gyroHeading += drift * correctionRate;
      this.debugInfo.driftCorrection = drift;
    }
    
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
  
  updateGyroHeading(rotationRate, timestamp) {
    if (!this.lastGyroTimestamp) {
      this.lastGyroTimestamp = timestamp;
      return;
    }
    
    const dt = Math.min((timestamp - this.lastGyroTimestamp) / 1000, 0.1);
    this.lastGyroTimestamp = timestamp;
    
    let deltaHeading = rotationRate.alpha || rotationRate.z || 0;
    
    if (this.platform.isIOS) {
      deltaHeading = -deltaHeading;
    }
    
    if (Math.abs(deltaHeading) > 10) {
      deltaHeading = deltaHeading * (180 / Math.PI);
    }
    
    this.gyroHeading += deltaHeading * dt;
    this.gyroHeading = (this.gyroHeading + 360) % 360;
  }
  
  evaluateStability(beta, mode) {
    const absBeta = Math.abs(beta);
    
    if (mode === 'compass') {
      if (absBeta < 45) {
        return {
          canUpdate: true,
          canCorrect: true,
          confidence: 1.0,
          smoothingFactor: 0.08,
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
          smoothingFactor: 0.02,
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
      // ARモード
      if (absBeta < 60) {
        return {
          canUpdate: true,
          canCorrect: true,
          confidence: 1.0,
          smoothingFactor: 0.05,
          status: 'stable'
        };
      } else if (absBeta < 110) {
        return {
          canUpdate: true,
          canCorrect: false,
          confidence: 0.7,
          smoothingFactor: 0.01,
          status: 'vertical'
        };
      } else {
        return {
          canUpdate: true,
          canCorrect: false,
          confidence: 0.5,
          smoothingFactor: 0.01,
          status: 'overhead'
        };
      }
    }
  }
  
  smoothAngle(current, target, factor) {
    const diff = this.calculateAngleDiff(target, current);
    return (current + diff * factor + 360) % 360;
  }
  
  calculateAngleDiff(angle1, angle2) {
    let diff = angle1 - angle2;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    return diff;
  }
  
  setMode(mode) {
    if (this.mode === mode) return;
    
    this.mode = mode;
    this.gyroCalibrated = false;
    this.lastGyroTimestamp = null;
    this.log(`🔄 モード切替: ${mode}`);
  }
  
  notifyUpdate(stability) {
    this.debugInfo.lastUpdate = Date.now();
    
    if (this.onUpdate) {
      this.onUpdate({
        heading: this.smoothedHeading,
        rawHeading: this.currentHeading,
        confidence: this.confidence,
        status: stability.status,
        mode: this.mode,
        interpolation: this.interpolationMode,
        platform: this.platform.name,
        gyroAvailable: this.gyroAvailable,
        beta: this.deviceBeta,
        instability: this.debugInfo.instabilityLevel,
        quaternionActive: this.debugInfo.quaternionActive
      });
    }
  }
  
  log(message) {
    if (typeof debugLog === 'function') {
      debugLog(message);
    } else {
      console.log(`[OrientationManagerExt] ${message}`);
    }
  }
  
  getHeading() {
    return this.smoothedHeading;
  }
  
  getDebugInfo() {
    return {
      heading: Math.round(this.smoothedHeading),
      confidence: Math.round(this.confidence * 100) + '%',
      mode: this.mode,
      interpolation: this.interpolationMode,
      gyro: this.gyroAvailable ? 'OK' : 'NG',
      platform: this.platform.name,
      instability: Math.round(this.debugInfo.instabilityLevel),
      quaternion: this.debugInfo.quaternionActive ? 'ON' : 'OFF',
      switches: this.debugInfo.switchCount
    };
  }
}

// エクスポート
if (typeof window !== 'undefined') {
  window.OrientationManagerExtended = OrientationManagerExtended;
}
