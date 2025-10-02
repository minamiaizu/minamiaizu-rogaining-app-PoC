/**
 * OrientationManager - iOS最適化版
 * iPhone/iPad専用のシンプルな実装
 */

class OrientationManager {
  constructor() {
    // 基本状態
    this.currentHeading = 0;
    this.smoothedHeading = 0;
    this.confidence = 1.0;
    
    // センサーデータ
    this.deviceAlpha = 0;
    this.deviceBeta = 0;
    this.deviceGamma = 0;
    this.compassAccuracy = -1;
    
    // プラットフォーム情報
    this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    
    // モード
    this.mode = 'compass';
    
    // 平滑化設定（モード別）
    this.smoothingFactors = {
      compass: 0.15,  // コンパスモード：滑らか
      ar: 0.35        // ARモード：反応重視
    };
    
    // コールバック
    this.onUpdate = null;
    
    // デバッグ
    this.updateCount = 0;
  }
  
  async init() {
    try {
      // iOS権限リクエスト
      if (this.isIOS) {
        // Orientation権限
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
          const orientationPermission = await DeviceOrientationEvent.requestPermission();
          this.log(`📱 iOS Orientation権限: ${orientationPermission}`);
          if (orientationPermission !== 'granted') {
            throw new Error('方位センサーの使用が許可されませんでした');
          }
        }
        
        // Motion権限（ピッチ角用）
        if (typeof DeviceMotionEvent.requestPermission === 'function') {
          const motionPermission = await DeviceMotionEvent.requestPermission();
          this.log(`📱 iOS Motion権限: ${motionPermission}`);
        }
      } else {
        // Android等では権限リクエスト不要
        this.log('📱 Android/その他のデバイス: 権限リクエストをスキップ');
      }
      
      // イベントリスナー設定
      this.setupListeners();
      
      this.log('✅ OrientationManager 初期化完了' + (this.isIOS ? ' (iOS)' : ' (Android/その他)'));
      return true;
    } catch (error) {
      this.log('❌ 初期化エラー: ' + error.message);
      // Androidではエラーでもリスナーを設定してみる
      if (!this.isIOS) {
        this.log('🔄 Android: エラーを無視してリスナーを設定');
        this.setupListeners();
        return true;
      }
      return false;
    }
  }
  
  setupListeners() {
    window.addEventListener('deviceorientation', (e) => {
      if (e.alpha === null) return;
      
      // センサーデータ保存
      this.deviceAlpha = e.alpha;
      this.deviceBeta = e.beta;
      this.deviceGamma = e.gamma;
      
      // iOS専用処理
      if (this.isIOS && e.webkitCompassHeading !== undefined) {
        // webkitCompassHeadingを優先使用
        this.processIOSCompass(e);
      } else {
        // フォールバック（Android等）
        this.processFallbackCompass(e);
      }
      
      // ピッチ角更新（グローバル互換性）
      if (e.beta !== null) {
        window.devicePitch = e.beta;
        if (typeof window.updatePitchIndicator === 'function') {
          window.updatePitchIndicator();
        }
      }
    });
  }
  
  processIOSCompass(event) {
    // iOSの高精度コンパス値を使用
    const rawHeading = event.webkitCompassHeading;
    this.compassAccuracy = event.webkitCompassAccuracy || -1;
    
    // 平滑化
    const smoothing = this.smoothingFactors[this.mode];
    this.smoothedHeading = this.smoothAngle(this.smoothedHeading, rawHeading, smoothing);
    this.currentHeading = rawHeading;
    
    // 信頼度計算（精度に基づく）
    if (this.compassAccuracy >= 0) {
      // 精度が良いほど信頼度が高い（0°が最高精度）
      this.confidence = Math.max(0.3, 1.0 - (this.compassAccuracy / 180));
    } else {
      this.confidence = 1.0;
    }
    
    this.notifyUpdate();
  }
  
  processFallbackCompass(event) {
    // Android等のフォールバック処理（簡略版）
    const rawHeading = (360 - event.alpha) % 360;
    
    const smoothing = this.smoothingFactors[this.mode];
    this.smoothedHeading = this.smoothAngle(this.smoothedHeading, rawHeading, smoothing);
    this.currentHeading = rawHeading;
    this.confidence = 0.8; // フォールバックは信頼度を下げる
    
    this.notifyUpdate();
  }
  
  smoothAngle(current, target, factor) {
    // 角度の差を-180～180に正規化
    let diff = target - current;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    
    // 平滑化
    return (current + diff * factor + 360) % 360;
  }
  
  setMode(mode) {
    this.mode = mode;
    this.log(`🔄 モード切替: ${mode}`);
  }
  
  notifyUpdate() {
    this.updateCount++;
    
    // コールバック実行
    if (this.onUpdate) {
      this.onUpdate({
        heading: this.smoothedHeading,
        rawHeading: this.currentHeading,
        confidence: this.confidence,
        accuracy: this.compassAccuracy,
        mode: this.mode,
        platform: this.isIOS ? 'iOS' : 'Other',
        beta: this.deviceBeta
      });
    }
    
    // グローバル変数更新（互換性）
    window.currentHeading = this.smoothedHeading;
    window.smoothedHeading = this.smoothedHeading;
    if (typeof window.updateCompassDisplay === 'function') {
      window.updateCompassDisplay();
    }
  }
  
  getHeading() {
    return this.smoothedHeading;
  }
  
  getDebugInfo() {
    return {
      heading: Math.round(this.smoothedHeading),
      confidence: Math.round(this.confidence * 100) + '%',
      accuracy: this.compassAccuracy >= 0 ? `±${Math.round(this.compassAccuracy)}°` : 'N/A',
      mode: this.mode,
      platform: this.isIOS ? 'iOS' : 'Other',
      updates: this.updateCount,
      beta: Math.round(this.deviceBeta)
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
