/**
 * GeoManager - 地理情報・位置情報・地図管理
 * Leaflet地図、位置取得、距離・方位計算を担当
 */

class GeoManager {
  constructor() {
    this.map = null;
    this.currentPositionMarker = null;
    this.currentAccuracyCircle = null;
    this.checkpointMarkers = [];
    this.trackPolyline = null;
    this.watchId = null;
    
    // コールバック
    this.onPositionUpdate = null;
    this.onPositionError = null;
  }
  
  // ========== 地図初期化 ==========
  initMap(containerId, center = [37.20329853, 139.77424063], zoom = 14) {
    if (this.map) {
      this.log('⚠️ 地図は既に初期化されています');
      return this.map;
    }
    
    this.map = L.map(containerId);
    
    const tileUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
    const attribution = '&copy; OpenStreetMap';
    
    const tile = L.tileLayer(tileUrl, {
      maxZoom: 19,
      attribution: attribution
    });
    
    tile.addTo(this.map);
    this.map.setView(center, zoom);
    
    this.log(`✅ 地図初期化完了 (中心: ${center}, ズーム: ${zoom})`);
    return this.map;
  }
  
  getMap() {
    return this.map;
  }
  
  // ========== チェックポイントマーカー ==========
  addCheckpointMarkers(checkpoints, completedIds = new Set()) {
    if (!this.map) {
      this.log('❌ 地図が初期化されていません');
      return;
    }
    
    // 既存マーカーをクリア
    this.clearCheckpointMarkers();
    
    checkpoints.forEach(cp => {
      const isCompleted = completedIds.has(cp.id);
      
      const marker = L.marker([cp.lat, cp.lng], {
        icon: L.divIcon({
          className: 'custom-icon',
          html: `<div style="background: ${isCompleted ? '#48bb78' : '#667eea'}; color: white; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">${cp.points}</div>`,
          iconSize: [30, 30]
        })
      }).addTo(this.map);
      
      marker.bindPopup(`<strong>${cp.name}</strong><br>${cp.points}点${isCompleted ? '<br>✅ クリア済み' : ''}`);
      
      this.checkpointMarkers.push({ id: cp.id, marker: marker });
    });
    
    this.log(`📍 チェックポイントマーカー追加: ${checkpoints.length}個`);
  }
  
  updateCheckpointMarker(checkpointId, isCompleted) {
    const item = this.checkpointMarkers.find(m => m.id === checkpointId);
    if (item) {
      // マーカーのスタイルを更新
      const icon = item.marker.getIcon();
      if (icon && icon.options && icon.options.html) {
        const newHtml = icon.options.html.replace(
          /background: #[0-9a-f]+/,
          `background: ${isCompleted ? '#48bb78' : '#667eea'}`
        );
        item.marker.setIcon(L.divIcon({
          className: 'custom-icon',
          html: newHtml,
          iconSize: [30, 30]
        }));
      }
    }
  }
  
  clearCheckpointMarkers() {
    this.checkpointMarkers.forEach(item => {
      if (this.map) {
        this.map.removeLayer(item.marker);
      }
    });
    this.checkpointMarkers = [];
  }
  
  // ========== 現在地マーカー ==========
  updateCurrentPositionMarker(position) {
    if (!this.map) return;
    
    // 既存マーカーを削除
    if (this.currentPositionMarker) {
      this.map.removeLayer(this.currentPositionMarker);
    }
    if (this.currentAccuracyCircle) {
      this.map.removeLayer(this.currentAccuracyCircle);
    }
    
    // 新しいマーカーを追加
    this.currentPositionMarker = L.marker([position.lat, position.lng], {
      icon: L.divIcon({
        className: 'current-position-icon',
        html: '<div style="background:#48bb78;border:4px solid #fff;border-radius:50%;width:20px;height:20px;box-shadow:0 0 10px rgba(72,187,120,.6);"></div>',
        iconSize: [20, 20]
      })
    }).addTo(this.map);
    
    // 精度円を追加
    this.currentAccuracyCircle = L.circle([position.lat, position.lng], {
      radius: position.accuracy || 50,
      color: '#48bb78',
      fillColor: '#48bb78',
      fillOpacity: 0.1,
      weight: 1
    }).addTo(this.map);
  }
  
  centerOnCurrentPosition(position, zoom = 15) {
    if (!this.map) return;
    this.map.setView([position.lat, position.lng], zoom);
  }
  
  // ========== トラックポリライン ==========
  updateTrackPolyline(trackPoints) {
    if (!this.map) return;
    
    // 既存ポリラインを削除
    if (this.trackPolyline) {
      this.map.removeLayer(this.trackPolyline);
      this.trackPolyline = null;
    }
    
    // 2点以上あればポリラインを描画
    if (trackPoints.length >= 2) {
      const latlngs = trackPoints.map(p => [p.lat, p.lng]);
      this.trackPolyline = L.polyline(latlngs, {
        color: '#667eea',
        weight: 3,
        opacity: 0.7
      }).addTo(this.map);
      
      this.log(`🛤️ トラックポリライン更新: ${trackPoints.length}点`);
    }
  }
  
  // ========== 位置情報取得 ==========
  async getCurrentPosition(options = {}) {
    const defaultOptions = {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    };
    
    const opts = { ...defaultOptions, ...options };
    
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('このブラウザは位置情報に非対応です'));
        return;
      }
      
      this.log('📍 位置情報取得を開始...');
      
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const position = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            elevation: pos.coords.altitude || null,
            timestamp: new Date(pos.timestamp).toISOString()
          };
          
          this.log(`✅ 位置取得: ${position.lat.toFixed(6)}, ${position.lng.toFixed(6)} ±${position.accuracy.toFixed(1)}m`);
          
          if (this.onPositionUpdate) {
            this.onPositionUpdate(position);
          }
          
          resolve(position);
        },
        (err) => {
          this.log(`❌ 位置取得エラー: ${err.message}`);
          
          if (this.onPositionError) {
            this.onPositionError(err);
          }
          
          reject(err);
        },
        opts
      );
    });
  }
  
  // ========== 位置監視 ==========
  startWatchPosition(callback, options = {}) {
    const defaultOptions = {
      enableHighAccuracy: false,
      timeout: 10000,
      maximumAge: 0
    };
    
    const opts = { ...defaultOptions, ...options };
    
    if (this.watchId !== null) {
      this.log('⚠️ 位置監視は既に開始されています');
      return;
    }
    
    if (!navigator.geolocation) {
      this.log('❌ このブラウザは位置情報に非対応です');
      return;
    }
    
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const position = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          elevation: pos.coords.altitude || null,
          timestamp: new Date(pos.timestamp).toISOString()
        };
        
        if (callback) {
          callback(position);
        }
        
        if (this.onPositionUpdate) {
          this.onPositionUpdate(position);
        }
      },
      (err) => {
        this.log(`❌ 位置監視エラー: ${err.message}`);
        
        if (this.onPositionError) {
          this.onPositionError(err);
        }
      },
      opts
    );
    
    this.log('📍 位置監視を開始');
  }
  
  stopWatchPosition() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
      this.log('📍 位置監視を停止');
    }
  }
  
  // ========== 距離・方位計算 ==========
  distance(lat1, lon1, lat2, lon2) {
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
  
  bearing(lat1, lon1, lat2, lon2) {
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) -
              Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    
    let θ = Math.atan2(y, x) * 180 / Math.PI;
    return (θ + 360) % 360;
  }
  
  calculateETA(distance, elevationDiff = 0) {
    // 徒歩速度: 時速4km = 分速67m
    const baseSpeed = 67; // m/min
    const flatTime = distance / baseSpeed;
    
    // 登りのペナルティ: 100m登りで約15分追加
    const elevationPenalty = Math.max(0, elevationDiff) * 0.15;
    
    return flatTime + elevationPenalty;
  }
  
  // ========== ユーティリティ ==========
  log(message) {
    if (typeof debugLog === 'function') {
      debugLog(message);
    } else {
      console.log(`[GeoManager] ${message}`);
    }
  }
  
  // ========== クリーンアップ ==========
  destroy() {
    this.stopWatchPosition();
    this.clearCheckpointMarkers();
    
    if (this.currentPositionMarker && this.map) {
      this.map.removeLayer(this.currentPositionMarker);
    }
    if (this.currentAccuracyCircle && this.map) {
      this.map.removeLayer(this.currentAccuracyCircle);
    }
    if (this.trackPolyline && this.map) {
      this.map.removeLayer(this.trackPolyline);
    }
    
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
    
    this.log('🗑️ GeoManager クリーンアップ');
  }
}

// グローバルエクスポート
if (typeof window !== 'undefined') {
  window.GeoManager = GeoManager;
}

// 初期化完了ログ
if (typeof debugLog === 'function') {
  debugLog('✅ GeoManager 読み込み完了');
} else {
  console.log('[GeoManager] Loaded');
}
