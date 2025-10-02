/**
 * OrientationManager - クォータニオンモード固定版
 * 常に安定した方位計算を提供
 */

// 簡易Quaternionクラス
class Quaternion {
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
    w = ca * cb * cg - sa * sb * sg;
    x = sa * cb * cg - ca * sb * sg;
    y = ca * sb * cg + sa * cb * sg;
    z = ca * cb * sg + sa * sb * cg;
    
    return new Quaternion(w, x, y, z);
  }
  
  toEuler(order = 'ZXY') {
    const sinr_cosp = 2 * (this.w * this.x + this.y * this.z);
    const cosr_cosp = 1 - 2 * (this.x * this.x + this.y * this.y);
    const alpha = Math.atan2(sinr_cosp, cosr_cosp);
    
    const sinp = 2 * (this.w * this.y - this.z * this.x);
    const beta = Math.abs(sinp) >= 1 ? 
      Math.sign(sinp) * Math.PI / 2 : 
      Math.asin(sinp);
    
    const siny_cosp = 2 * (this.w * this.z + this.x * this.y);
    const cosy_cosp = 1 - 2 * (this.y * this.y + this.z * this.z);
    const gamma = Math.atan2(siny_cosp, cosy_cosp);
    
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
      q2 = new Quaternion(-q2.w, -q2.x, -q2.y, -q2.z);
      dot = -dot;
    }
    
    if (dot > 0.9995) {
      // 線形補間
      return new Quaternion(
        q1.w + t * (q2.w - q1.w),
        q1.x + t * (q2.x - q1.x),
        q1.y + t * (q2.y - q1.y),
        q1.z + t * (q2.z - q1.z)
      ).normalize();
    }
    
    const theta = Math.acos(dot);
    const sinTheta = Math.sin(theta);
    const w1 = Math.sin((1 - t) * theta) / sinTheta;
    const w2 = Math.sin(t * theta) / sinTheta;
    
    return new Quaternion(
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

class OrientationManager {
  constructor() {
    // 基本状態
    this.currentHeading = 0;
    this.smoothedHeading = 0;
    
    // センサーデータ
    this.deviceAlpha = 0;
    this.deviceBeta = 0;
    this.deviceGamma = 0;
    
    // クォータニオン
    this.currentQuaternion = new Quaternion();
    this.targetQuaternion = new Quaternion();
    
    // プラットフォーム検出
    this.platform = this.detectPlatform();
    
    // モード（互換性のため残すが常にar）
    this.mode = 'ar';
    
    // 平滑化係数
    this.smoothingFactor = 0.25;  // 25%新しい値を採用（より反応的）
    
    // コールバック
    this.onUpdate = null;
    
    // デバッグ
    this.debugInfo = {
      updateCount: 0,
      lastUpdate: Date.now()
    };
  }
  
  detectPlatform() {
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    const isAndroid = /Android/.test(ua);
    
    return {
      isIOS,
      isAndroid,
      hasWebkitCompass: 'webkitCompassHeading' in (window.DeviceOrientationEvent.prototype || {}),
      name: isIOS ? 'iOS' : (isAndroid ? 'Android' : 'Unknown')
    };
  }
  
  async init() {
    try {
      // iOS権限リクエスト
      if (this.platform.isIOS) {
        await this.requestIOSPermissions();
      }
      
      // イベントリスナー設定
      this.setupOrientationListener();
      
      this.log('✅ OrientationManager (Quaternion) 初期化完了');
      return true;
    } catch (error) {
      this.log('❌ 初期化エラー: ' + error.message);
      return false;
    }
  }
  
  async requestIOSPermissions() {
    const permissions = [];
    
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      const result = await DeviceOrientationEvent.requestPermission();
      this.log(`📱 iOS Orientation権限: ${result}`);
      if (result !== 'granted') throw new Error('Orientation permission denied');
    }
    
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      const result = await DeviceMotionEvent.requestPermission();
      this.log(`📱 iOS Motion権限: ${result}`);
    }
  }
  
  setupOrientationListener() {
    window.addEventListener('deviceorientation', (e) => {
      if (e.alpha === null || e.beta === null || e.gamma === null) return;
      
      // センサーデータ保存
      this.deviceAlpha = e.alpha;
      this.deviceBeta = e.beta;
      this.deviceGamma = e.gamma;
      
      // クォータニオン処理
      this.updateQuaternion(e);
    });
    
    // ピッチ角更新用
    window.addEventListener('deviceorientation', (e) => {
      if (e.beta !== null && typeof updatePitchIndicator === 'function') {
        // グローバル関数の互換性
        window.devicePitch = e.beta;
        updatePitchIndicator();
      }
    });
  }
  
  updateQuaternion(event) {
    // プラットフォーム別の方位値取得
    let alpha;
    if (this.platform.hasWebkitCompass && event.webkitCompassHeading !== undefined) {
      alpha = event.webkitCompassHeading;
    } else {
      alpha = event.alpha;
    }
    
    // 新しい姿勢のクォータニオン
    this.targetQuaternion = Quaternion.fromEuler(alpha, event.beta, event.gamma);
    
    // スラープで補間（常に適用）
    this.currentQuaternion = Quaternion.slerp(
      this.currentQuaternion,
      this.targetQuaternion,
      this.smoothingFactor
    );
    
    // オイラー角に戻す
    const euler = this.currentQuaternion.toEuler();
    
    // 方位を抽出（プラットフォーム別）
    let heading;
    if (this.platform.hasWebkitCompass) {
      heading = euler.alpha;  // iOSは直接使用
    } else {
      heading = (360 - euler.alpha) % 360;  // Androidは変換
    }
    
    // 0-360の範囲に正規化
    heading = (heading + 360) % 360;
    
    this.smoothedHeading = heading;
    this.currentHeading = heading;
    
    // 更新通知
    this.notifyUpdate();
  }
  
  notifyUpdate() {
    this.debugInfo.updateCount++;
    this.debugInfo.lastUpdate = Date.now();
    
    if (this.onUpdate) {
      this.onUpdate({
        heading: this.smoothedHeading,
        rawHeading: this.currentHeading,
        confidence: 1.0,  // クォータニオンモードは常に高信頼度
        status: 'quaternion',
        mode: this.mode,
        platform: this.platform.name,
        beta: this.deviceBeta
      });
    }
    
    // グローバル変数更新（互換性）
    if (typeof window !== 'undefined') {
      window.currentHeading = this.smoothedHeading;
      window.smoothedHeading = this.smoothedHeading;
      if (typeof window.updateCompassDisplay === 'function') {
        window.updateCompassDisplay();
      }
    }
  }
  
  setMode(mode) {
    // 互換性のため残すが、常にクォータニオンモード
    this.mode = mode;
    // ARモードはより反応的に、コンパスモードは滑らかに
    this.smoothingFactor = (mode === 'ar') ? 0.3 : 0.15;
    this.log(`🔄 モード: ${mode} (Quaternion, smoothing: ${this.smoothingFactor})`);
  }
  
  getHeading() {
    return this.smoothedHeading;
  }
  
  getDebugInfo() {
    return {
      heading: Math.round(this.smoothedHeading),
      confidence: '100%',
      mode: 'Quaternion',
      platform: this.platform.name,
      updates: this.debugInfo.updateCount,
      alpha: Math.round(this.deviceAlpha),
      beta: Math.round(this.deviceBeta),
      gamma: Math.round(this.deviceGamma)
    };
  }
  
  log(message) {
    if (typeof debugLog === 'function') {
      debugLog(message);
    } else {
      console.log(`[OrientationManager] ${message}`);
    }
  }
}

// エクスポート
if (typeof window !== 'undefined') {
  window.OrientationManager = OrientationManager;
}
