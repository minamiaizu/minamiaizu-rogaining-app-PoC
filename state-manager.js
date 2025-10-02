/**
 * StateManager - アプリケーション状態管理
 * データの読み込み、保存、管理を担当
 */

class StateManager {
  constructor(storageKey = 'rogaining_data') {
    this.storageKey = storageKey;
    
    // データ
    this.checkpoints = [];
    this.config = null;
    
    // 状態
    this.completedIds = new Set();
    this.photos = [];
    this.currentPosition = null;
    this.remainingTime = 120 * 60; // デフォルト2時間
    this.startTime = Date.now();
    this.trackingEnabled = true;
    this.trackPoints = [];
    
    // UI状態
    this.selectedCameraId = null;
    this.sonarAudioEnabled = false;
  }
  
  // ========== JSON読み込み ==========
  async loadCheckpoints(url = './data/checkpoints.json') {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      this.checkpoints = data.checkpoints || [];
      
      this.log(`✅ チェックポイント読み込み: ${this.checkpoints.length}件 (v${data.version})`);
      return true;
    } catch (error) {
      this.log(`❌ チェックポイント読み込み失敗: ${error.message}`);
      
      // フォールバック: デフォルトデータ
      this.checkpoints = this._getDefaultCheckpoints();
      this.log('⚠️ デフォルトチェックポイントを使用');
      return false;
    }
  }
  
  async loadConfig(url = './data/config.json') {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      this.config = await response.json();
      
      // 設定を適用
      this.remainingTime = (this.config.app?.defaultTimeLimitMinutes || 120) * 60;
      
      this.log(`✅ 設定読み込み: v${this.config.version}`);
      return true;
    } catch (error) {
      this.log(`❌ 設定読み込み失敗: ${error.message}`);
      
      // フォールバック: デフォルト設定
      this.config = this._getDefaultConfig();
      this.log('⚠️ デフォルト設定を使用');
      return false;
    }
  }
  
  getConfig(path) {
    // ネストされた設定値を取得
    // 例: getConfig('map.defaultZoom') => 14
    const keys = path.split('.');
    let value = this.config;
    for (const key of keys) {
      value = value?.[key];
      if (value === undefined) break;
    }
    return value;
  }
  
  _getDefaultCheckpoints() {
    return [
      { id: 1, name: "会津田島駅", lat: 37.20329853, lng: 139.77424063, points: 10, elevation: 650 },
      { id: 5, name: "田島郵便局", lat: 37.20304087405265, lng: 139.77286576693686, points: 15, elevation: 660 },
      { id: 3, name: "南会津町役場", lat: 37.200710699416376, lng: 139.77372578165173, points: 20, elevation: 655 },
      { id: 4, name: "旧会津田島祇園会館", lat: 37.205534721685595, lng: 139.77515747555398, points: 25, elevation: 658 },
      { id: 7, name: "丸山公園", lat: 37.20270904301629, lng: 139.76594854526823, points: 30, elevation: 670 },
      { id: 8, name: "びわのかげ運動公園芝生広場", lat: 37.205439950626705, lng: 139.7619837579642, points: 35, elevation: 672 },
      { id: 2, name: "びわのかげ公園", lat: 37.19933810720546, lng: 139.76057080171373, points: 40, elevation: 671 },
      { id: 6, name: "たじま公園", lat: 37.211615192715506, lng: 139.78760153630893, points: 45, elevation: 690 }
    ];
  }
  
  _getDefaultConfig() {
    return {
      version: "1.0",
      app: { 
        defaultTimeLimitMinutes: 120, 
        checkpointThresholdMeters: 100,
        nearbyThresholdMeters: 150
      },
      map: { 
        defaultCenter: { lat: 37.20329853, lng: 139.77424063 }, 
        defaultZoom: 14,
        maxZoom: 19
      },
      tracking: {
        intervalSeconds: 60,
        highAccuracy: true,
        timeout: 10000
      },
      photo: {
        maxWidth: 1280,
        quality: 0.6,
        captureMode: 'environment'
      }
    };
  }
  
  // ========== チェックポイント ==========
  getCheckpoint(id) {
    return this.checkpoints.find(cp => cp.id === id);
  }
  
  isCompleted(id) {
    return this.completedIds.has(id);
  }
  
  completeCheckpoint(id) {
    this.completedIds.add(id);
    this.log(`✓ チェックポイント完了: ${id}`);
  }
  
  getTotalScore() {
    return this.checkpoints.reduce((sum, cp) => {
      return sum + (this.isCompleted(cp.id) ? cp.points : 0);
    }, 0);
  }
  
  getNearbyCheckpoints(position, threshold = null) {
    if (!position) return [];
    
    const dist = threshold || this.getConfig('app.nearbyThresholdMeters') || 150;
    
    return this.checkpoints.filter(cp => {
      if (this.isCompleted(cp.id)) return false;
      const d = this._distance(position.lat, position.lng, cp.lat, cp.lng);
      return d <= dist;
    });
  }
  
  checkNearby(position, photos = null) {
    if (!position) {
      return { success: false, message: '先に現在地を取得してください' };
    }
    
    if (photos !== null && photos.length === 0) {
      return { success: false, message: '先に写真を撮影してください' };
    }
    
    const threshold = this.getConfig('app.checkpointThresholdMeters') || 100;
    let found = [];
    
    this.checkpoints.forEach(cp => {
      if (this.isCompleted(cp.id)) return;
      
      const d = this._distance(position.lat, position.lng, cp.lat, cp.lng);
      if (d <= threshold) {
        this.completeCheckpoint(cp.id);
        found.push({ checkpoint: cp, distance: d });
      }
    });
    
    if (found.length > 0) {
      return { 
        success: true, 
        checkpoints: found,
        message: `${found.length}個のチェックポイントをクリア!`
      };
    } else {
      return { 
        success: false, 
        message: `近くにチェックポイントがありません(${threshold}m以内に接近してください)`
      };
    }
  }
  
  // ========== 位置情報 ==========
  setPosition(position) {
    this.currentPosition = position;
  }
  
  getPosition() {
    return this.currentPosition;
  }
  
  // ========== 写真 ==========
  addPhoto(dataUrl, position = null) {
    const photo = {
      timestamp: new Date().toISOString(),
      position: position ? {...position} : null,
      dataUrl: dataUrl
    };
    this.photos.push(photo);
    this.log(`📷 写真追加: ${this.photos.length}枚目`);
    return photo;
  }
  
  getPhotos() {
    return this.photos;
  }
  
  // ========== トラッキング ==========
  addTrackPoint(point) {
    this.trackPoints.push({
      ...point,
      timestamp: new Date().toISOString()
    });
  }
  
  getTrackPoints() {
    return this.trackPoints;
  }
  
  setTrackingEnabled(enabled) {
    this.trackingEnabled = enabled;
  }
  
  isTrackingEnabled() {
    return this.trackingEnabled;
  }
  
  // ========== タイマー ==========
  setRemainingTime(seconds) {
    this.remainingTime = seconds;
  }
  
  getRemainingTime() {
    return this.remainingTime;
  }
  
  decrementTime() {
    if (this.remainingTime > 0) {
      this.remainingTime--;
    }
    return this.remainingTime;
  }
  
  isTimeUp() {
    return this.remainingTime <= 0;
  }
  
  // ========== LocalStorage ==========
  save() {
    const data = {
      completedCheckpoints: Array.from(this.completedIds),
      photos: this.photos.map(p => ({
        timestamp: p.timestamp,
        position: p.position,
        dataUrl: p.dataUrl
      })),
      currentPosition: this.currentPosition,
      remainingTime: this.remainingTime,
      startTime: this.startTime,
      trackPoints: this.trackPoints,
      trackingEnabled: this.trackingEnabled,
      selectedCameraId: this.selectedCameraId,
      sonarAudioEnabled: this.sonarAudioEnabled,
      lastSaved: new Date().toISOString()
    };
    
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(data));
      this.log('💾 LocalStorage保存');
      return true;
    } catch (e) {
      this.log(`❌ LocalStorage保存エラー: ${e.message}`);
      return false;
    }
  }
  
  load() {
    try {
      const saved = localStorage.getItem(this.storageKey);
      if (!saved) return false;
      
      const data = JSON.parse(saved);
      
      this.completedIds = new Set(data.completedCheckpoints || []);
      this.currentPosition = data.currentPosition || null;
      this.remainingTime = data.remainingTime ?? this.remainingTime;
      this.startTime = data.startTime || Date.now();
      this.trackPoints = data.trackPoints || [];
      this.trackingEnabled = data.trackingEnabled !== undefined ? data.trackingEnabled : true;
      this.photos = data.photos || [];
      this.selectedCameraId = data.selectedCameraId || null;
      this.sonarAudioEnabled = data.sonarAudioEnabled || false;
      
      this.log(`💾 LocalStorageから復元 (保存日時: ${data.lastSaved})`);
      return true;
    } catch (e) {
      this.log(`❌ LocalStorage読み込みエラー: ${e.message}`);
      return false;
    }
  }
  
  clear() {
    this.completedIds.clear();
    this.photos = [];
    this.currentPosition = null;
    this.trackPoints = [];
    this.remainingTime = (this.config?.app?.defaultTimeLimitMinutes || 120) * 60;
    this.startTime = Date.now();
    this.trackingEnabled = true;
    
    localStorage.removeItem(this.storageKey);
    this.log('🗑️ データクリア');
  }
  
  // ========== ユーティリティ ==========
  _distance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // 地球の半径(m)
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
  
  log(message) {
    if (typeof debugLog === 'function') {
      debugLog(message);
    } else {
      console.log(`[StateManager] ${message}`);
    }
  }
  
  // ========== エクスポート/インポート ==========
  exportData() {
    return {
      checkpoints: this.checkpoints,
      completedIds: Array.from(this.completedIds),
      photos: this.photos,
      trackPoints: this.trackPoints,
      currentPosition: this.currentPosition,
      remainingTime: this.remainingTime,
      startTime: this.startTime,
      totalScore: this.getTotalScore(),
      exportedAt: new Date().toISOString()
    };
  }
  
  importData(data) {
    try {
      if (data.completedIds) {
        this.completedIds = new Set(data.completedIds);
      }
      if (data.photos) {
        this.photos = data.photos;
      }
      if (data.trackPoints) {
        this.trackPoints = data.trackPoints;
      }
      if (data.currentPosition) {
        this.currentPosition = data.currentPosition;
      }
      if (data.remainingTime !== undefined) {
        this.remainingTime = data.remainingTime;
      }
      if (data.startTime) {
        this.startTime = data.startTime;
      }
      
      this.log('📥 データインポート完了');
      return true;
    } catch (e) {
      this.log(`❌ データインポートエラー: ${e.message}`);
      return false;
    }
  }
}

// グローバルエクスポート
if (typeof window !== 'undefined') {
  window.StateManager = StateManager;
}

// 初期化完了ログ
if (typeof debugLog === 'function') {
  debugLog('✅ StateManager 読み込み完了');
} else {
  console.log('[StateManager] Loaded');
}
