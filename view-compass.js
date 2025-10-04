/**
 * CompassView - コンパス表示管理（座標系統一版）
 * 依存性注入パターンを使用し、geoMgrから直接メソッドを使用
 * 
 * 修正版: iOS/Android両対応 - 回転方向を-headingに統一
 * バージョン: 1.1.0 - 2025-10-03
 */

class CompassView {
  constructor(options = {}) {
    this.containerId = options.containerId || 'compass-view';
    this.geoMgr = options.geoMgr;
    
    this.container = null;
    this.compassCircle = null;
    this.compassContainer = null;
    this.compassTicks = null;
    this.markersContainer = null;
    this.distanceBar = null;
    this.headingDisplay = null;
    
    this.compassSize = 400;
    this.currentHeading = 0;
    
    // ツールチップ
    this.activeTooltip = null;
    this.tooltipTimeout = null;
    
    if (!this.geoMgr) {
      this.log('⚠️ GeoManagerが注入されていません');
    }
  }
  
  // ========== 初期化 ==========
  init() {
    this.container = document.getElementById(this.containerId);
    if (!this.container) {
      this.log('❌ コンパスコンテナが見つかりません');
      return false;
    }
    
    this.compassContainer = document.getElementById('compass-container');
    this.compassCircle = document.getElementById('compass-circle');
    this.compassTicks = document.getElementById('compass-ticks');
    this.markersContainer = document.getElementById('checkpoint-markers');
    this.distanceBar = document.getElementById('distance-bar');
    this.headingDisplay = document.getElementById('heading-display');
    
    this.updateSize();
    this.drawTicks();
    
    this.log('✅ CompassView初期化完了');
    return true;
  }
  
  // ========== サイズ更新 ==========
  updateSize() {
    if (!this.compassContainer) return;
    
    this.compassSize = this.compassContainer.offsetWidth;
    
    if (this.compassTicks) {
      this.compassTicks.width = this.compassSize;
      this.compassTicks.height = this.compassSize;
      this.drawTicks();
    }
  }
  
  // ========== コンパス目盛り描画 ==========
  drawTicks() {
    if (!this.compassTicks) return;
    
    const canvas = this.compassTicks;
    const ctx = canvas.getContext('2d');
    const size = this.compassSize;
    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2 - 20;
    
    ctx.clearRect(0, 0, size, size);
    
    for (let i = 0; i < 360; i++) {
      const rad = (i - 90) * Math.PI / 180;
      let len = 0;
      let w = 1;
      let color = '#a0aec0';
      
      if (i % 90 === 0) {
        // 主要方位 (N/E/S/W)
        len = 25;
        w = 3;
        color = (i === 0) ? '#c53030' : '#2d3748';
      } else if (i % 45 === 0) {
        // 45度刻み
        len = 20;
        w = 2;
        color = '#4a5568';
      } else if (i % 15 === 0) {
        // 15度刻み
        len = 15;
        w = 2;
        color = '#718096';
      } else if (i % 5 === 0) {
        // 5度刻み
        len = 10;
        w = 1;
        color = '#a0aec0';
      } else {
        continue;
      }
      
      ctx.beginPath();
      ctx.moveTo(cx + (r - len) * Math.cos(rad), cy + (r - len) * Math.sin(rad));
      ctx.lineTo(cx + r * Math.cos(rad), cy + r * Math.sin(rad));
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  }
  
  // ========== 方位更新（修正版：-headingで回転） ==========
  updateHeading(heading) {
    this.currentHeading = heading;
    
    // 🔧 修正: ジャイロコンパス風の正しい回転方向
    // デバイスが東を向く(90°) → 方位盤は反時計回りに90°回転(-90deg)
    if (this.compassCircle) {
      const normalizedHeading = ((heading % 360) + 360) % 360;
      this.compassCircle.style.transform = `rotate(-${normalizedHeading}deg)`;
    }
    
    // 方位表示を更新
    if (this.headingDisplay) {
      this.headingDisplay.textContent = `方位: ${Math.round(heading)}°`;
    }
  }
  
  // ========== チェックポイントマーカー（修正版：-headingで回転） ==========
  updateCheckpointMarkers(currentPosition, heading, checkpoints, completedIds) {
    if (!this.markersContainer || !currentPosition || !this.geoMgr) return;
    
    this.markersContainer.innerHTML = '';
    
    // 🔧 修正: マーカーコンテナ全体を方位盤と同じ方向(-heading)で回転
    const normalizedHeading = ((heading % 360) + 360) % 360;
    this.markersContainer.style.transform = `rotate(-${normalizedHeading}deg)`;
    
    // 距離を計算
    let distances = [];
    checkpoints.forEach(cp => {
      if (completedIds.has(cp.id)) return;
      const d = this.geoMgr.distance(currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
      distances.push(d);
    });
    
    if (distances.length === 0) return;
    
    const minDistance = Math.min(...distances);
    const maxDistance = Math.max(...distances);
    const centerPoint = this.compassSize / 2;
    const radius = centerPoint * 0.85;
    
    // マーカー配置
    checkpoints.forEach(cp => {
      if (completedIds.has(cp.id)) return;
      
      const d = this.geoMgr.distance(currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
      const color = this._getDistanceColor(d, minDistance, maxDistance);
      const brng = this.geoMgr.bearing(currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
      
      // 絶対方位で配置（headingを引かない）
      const angle = (brng - 90) * Math.PI / 180;
      const x = centerPoint + radius * Math.cos(angle);
      const y = centerPoint + radius * Math.sin(angle);
      
      const marker = document.createElement('div');
      marker.className = 'checkpoint-marker';
      marker.textContent = cp.points;
      marker.style.background = color;
      marker.style.left = x + 'px';
      marker.style.top = y + 'px';
      
      // 🔧 修正: マーカー内の数字を水平に保つため、逆回転(+heading)を適用
      marker.style.transform = `rotate(${normalizedHeading}deg)`;
      
      marker.title = `${cp.name}: ${Math.round(d)}m`;
      
      marker.addEventListener('click', (e) => {
        e.stopPropagation();
        const rect = marker.getBoundingClientRect();
        const tooltipX = rect.left + rect.width / 2;
        const tooltipY = rect.top;
        this.showTooltip(`${cp.name}: ${Math.round(d)}m`, tooltipX, tooltipY);
      });
      
      this.markersContainer.appendChild(marker);
    });
    
    // 距離バー更新
    this.updateDistanceBar(currentPosition, heading, checkpoints, completedIds, minDistance, maxDistance);
  }
  
  // ========== 距離バー ==========
  updateDistanceBar(currentPosition, heading, checkpoints, completedIds, minDist, maxDist) {
    if (!this.distanceBar || !this.geoMgr) return;
    
    this.distanceBar.innerHTML = '';
    
    const maxLabel = document.getElementById('max-distance-label');
    if (maxLabel) {
      maxLabel.textContent = `${Math.round(maxDist)}m`;
    }
    
    checkpoints.forEach(cp => {
      if (completedIds.has(cp.id)) return;
      
      const d = this.geoMgr.distance(currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
      const color = this._getDistanceColor(d, minDist, maxDist);
      const position = maxDist > minDist ? ((d - minDist) / (maxDist - minDist)) * 100 : 50;
      
      const marker = document.createElement('div');
      marker.className = 'distance-marker';
      marker.textContent = cp.points;
      marker.style.background = color;
      marker.style.left = `${position}%`;
      marker.title = `${cp.name}: ${Math.round(d)}m`;
      
      marker.addEventListener('click', (e) => {
        e.stopPropagation();
        const rect = marker.getBoundingClientRect();
        const tooltipX = rect.left + rect.width / 2;
        const tooltipY = rect.top;
        this.showTooltip(`${cp.name}: ${Math.round(d)}m`, tooltipX, tooltipY);
      });
      
      this.distanceBar.appendChild(marker);
    });
  }
  
  // ========== ツールチップ ==========
  showTooltip(text, x, y) {
    this.hideTooltip();
    
    const tooltip = document.createElement('div');
    tooltip.className = 'custom-tooltip';
    tooltip.textContent = text;
    tooltip.style.left = x + 'px';
    tooltip.style.top = y + 'px';
    
    document.body.appendChild(tooltip);
    this.activeTooltip = tooltip;
    
    clearTimeout(this.tooltipTimeout);
    this.tooltipTimeout = setTimeout(() => this.hideTooltip(), 3000);
  }
  
  hideTooltip() {
    if (this.activeTooltip) {
      document.body.removeChild(this.activeTooltip);
      this.activeTooltip = null;
    }
    clearTimeout(this.tooltipTimeout);
  }
  
  // ========== 表示/非表示 ==========
  show() {
    if (this.container) {
      this.container.hidden = false;
      this.updateSize();
    }
  }
  
  hide() {
    if (this.container) {
      this.container.hidden = true;
    }
    this.hideTooltip();
  }
  
  // ========== ユーティリティ ==========
  _getDistanceColor(distance, minDist, maxDist) {
    if (maxDist === minDist) return 'hsl(120, 80%, 50%)';
    
    const normalized = (distance - minDist) / (maxDist - minDist);
    let hue;
    
    if (normalized <= 0.5) {
      hue = 240 - (120 * normalized * 2);
    } else {
      hue = 120 - (120 * (normalized - 0.5) * 2);
    }
    
    return `hsl(${hue}, 80%, 50%)`;
  }
  
  log(message) {
    if (typeof debugLog === 'function') {
      debugLog(message);
    } else {
      console.log(`[CompassView] ${message}`);
    }
  }
}

// グローバルエクスポート
if (typeof window !== 'undefined') {
  window.CompassView = CompassView;
}

// 初期化完了ログ
if (typeof debugLog === 'function') {
  debugLog('✅ CompassView v1.1.0 (座標系統一版) 読み込み完了');
} else {
  console.log('[CompassView] v1.1.0 - Coordinate system unified');
}
