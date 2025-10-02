/**
 * SonarView - ソナー表示管理
 * 円形ソナー、距離バー、標高プロファイル管理
 */

class SonarView {
  constructor(options = {}) {
    this.options = {
      range: options.range ?? 1000,
      scanSpeed: options.scanSpeed ?? 72, // 度/秒
      audioEnabled: options.audioEnabled ?? false
    };
    
    // キャンバス
    this.canvas = null;
    this.ctx = null;
    this.distanceCanvas = null;
    this.distanceCtx = null;
    this.elevationCanvas = null;
    this.elevationCtx = null;
    
    // 状態
    this.size = 400;
    this.scanAngle = 0;
    this.lastUpdateTime = 0;
    this.animationId = null;
    
    // 音響
    this.audioContext = null;
    this.lastScanSoundAngle = 0;
    
    // キャッシュ
    this.distanceCache = {};
    this.lastCacheTime = 0;
  }
  
  // ========== 初期化 ==========
  init() {
    this.canvas = document.getElementById('sonar-canvas');
    if (!this.canvas) {
      this.log('❌ ソナーキャンバスが見つかりません');
      return false;
    }
    
    this.ctx = this.canvas.getContext('2d');
    this.distanceCanvas = document.getElementById('distance-gradient-canvas');
    this.distanceCtx = this.distanceCanvas?.getContext('2d');
    this.elevationCanvas = document.getElementById('elevation-profile-canvas');
    this.elevationCtx = this.elevationCanvas?.getContext('2d');
    
    this.resizeCanvas();
    
    // 音響システム初期化
    if (window.AudioContext || window.webkitAudioContext) {
      this.initAudio();
    }
    
    // 音響トグルの状態復元
    const audioToggle = document.getElementById('sonar-audio-enable');
    if (audioToggle) {
      audioToggle.checked = this.options.audioEnabled;
      audioToggle.addEventListener('change', (e) => {
        this.options.audioEnabled = e.target.checked;
        this.log(`ソナー音響: ${this.options.audioEnabled ? 'ON' : 'OFF'}`);
      });
    }
    
    // 標高キャンバスのクリックイベント
    if (this.elevationCanvas) {
      this.elevationCanvas.addEventListener('click', (e) => this.handleElevationClick(e));
    }
    
    // ソナー円のクリックイベント
    if (this.canvas) {
      this.canvas.addEventListener('click', (e) => this.handleSonarClick(e));
    }
    
    this.log('✅ SonarView初期化完了');
    return true;
  }
  
  // ========== キャンバスリサイズ ==========
  resizeCanvas() {
    const container = document.getElementById('sonar-container');
    if (!container) return;
    
    this.size = container.offsetWidth;
    
    if (this.canvas) {
      this.canvas.width = this.size;
      this.canvas.height = this.size;
    }
    
    if (this.distanceCanvas) {
      const rect = this.distanceCanvas.parentElement.getBoundingClientRect();
      this.distanceCanvas.width = rect.width;
      this.distanceCanvas.height = rect.height;
    }
    
    if (this.elevationCanvas) {
      const rect = this.elevationCanvas.parentElement.getBoundingClientRect();
      this.elevationCanvas.width = rect.width;
      this.elevationCanvas.height = rect.height;
    }
  }
  
  // ========== アニメーションループ ==========
  startAnimation() {
    if (this.animationId) return;
    
    this.lastUpdateTime = 0;
    this.scanAngle = 0;
    this.animationId = requestAnimationFrame((t) => this.loop(t));
    
    this.log('🎬 ソナーアニメーション開始');
  }
  
  stopAnimation() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    
    this.log('⏹️ ソナーアニメーション停止');
  }
  
  loop(timestamp) {
    if (!this.animationId) return;
    
    // スキャンライン角度更新
    if (this.lastUpdateTime === 0) {
      this.lastUpdateTime = timestamp;
    }
    
    const deltaTime = timestamp - this.lastUpdateTime;
    this.scanAngle = (this.scanAngle + (this.options.scanSpeed * deltaTime / 1000)) % 360;
    this.lastUpdateTime = timestamp;
    
    // 描画
    this.draw();
    
    // スキャン音チェック
    this.checkScanSound();
    
    this.animationId = requestAnimationFrame((t) => this.loop(t));
  }
  
  // ========== 更新 ==========
  update(currentPosition, heading, checkpoints, completedIds) {
    if (!currentPosition) return;
    
    // 最寄りCP情報更新
    this.updateNearestInfo(currentPosition, checkpoints, completedIds);
  }
  
  // ========== 描画 ==========
  draw() {
    this.drawSonarDisplay();
    this.drawDistanceGradientBar();
    this.drawElevationProfile();
  }
  
  drawSonarDisplay() {
    if (!this.ctx) return;
    
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(cx, cy) - 20;
    
    // 背景クリア
    ctx.clearRect(0, 0, w, h);
    
    // Canvasを保存して回転を適用
    ctx.save();
    ctx.translate(cx, cy);
    
    // ソナー円をheadingに応じて回転（北が上になるように）
    const heading = window.smoothedHeading || 0;
    ctx.rotate(-heading * Math.PI / 180);
    
    ctx.translate(-cx, -cy);
    
    // 背景グラデーション（明るいトップなグリーン - ドラゴンレーダー風）
    const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    bgGrad.addColorStop(0, '#a8e6cf');
    bgGrad.addColorStop(0.5, '#7ed6a8');
    bgGrad.addColorStop(1, '#6bc99b');
    ctx.fillStyle = bgGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    
    // 距離リング
    this.drawDistanceRings(ctx, cx, cy, radius);
    
    // スキャンライン
    this.drawScanLine(ctx, cx, cy, radius);
    
    // チェックポイント
    this.drawSonarCheckpoints(ctx, cx, cy, radius);
    
    // 中心点（ピンク色 - ドラゴンレーダー風の現在地マーカー）
    ctx.fillStyle = '#ff6b9d';
    ctx.beginPath();
    ctx.arc(cx, cy, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.stroke();
    
    // Canvasの状態を復元
    ctx.restore();
  }
  
  drawDistanceRings(ctx, cx, cy, radius) {
    const rings = 4;
    ctx.strokeStyle = 'rgba(45, 55, 72, 0.4)';
    ctx.lineWidth = 1.5;
    
    for (let i = 1; i <= rings; i++) {
      const r = (radius / rings) * i;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      
      // 距離ラベル
      ctx.fillStyle = 'rgba(45, 55, 72, 0.7)';
      ctx.font = 'bold 12px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const distLabel = Math.round((this.options.range / rings) * i);
      const labelText = distLabel >= 1000 ? `${(distLabel/1000).toFixed(1)}km` : `${distLabel}m`;
      ctx.fillText(labelText, cx, cy - r + 14);
    }
  }
  
  drawScanLine(ctx, cx, cy, radius) {
    const scanArc = 45;
    const startAngle = (this.scanAngle - 90) * Math.PI / 180;
    const endAngle = (this.scanAngle + scanArc - 90) * Math.PI / 180;
    
    // 扇形グラデーション（黄色系 - ドラゴンレーダー風）
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, 'rgba(255, 220, 100, 0.5)');
    grad.addColorStop(0.8, 'rgba(255, 220, 100, 0.2)');
    grad.addColorStop(1, 'rgba(255, 220, 100, 0)');
    
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.closePath();
    ctx.fill();
    
    // スキャンラインの先端（明るい黄色ライン）
    ctx.strokeStyle = 'rgba(255, 193, 7, 0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    const lineAngle = (this.scanAngle - 90) * Math.PI / 180;
    ctx.lineTo(cx + radius * Math.cos(lineAngle), cy + radius * Math.sin(lineAngle));
    ctx.stroke();
  }
  
  drawSonarCheckpoints(ctx, cx, cy, radius) {
    const currentPosition = window.currentPosition;
    const checkpoints = window.checkpoints || [];
    const completedCheckpoints = window.completedCheckpoints || new Set();
    
    if (!currentPosition) return;
    
    checkpoints.forEach(cp => {
      // 距離と方位計算
      const dist = this.getCachedDistance(cp.id, currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
      if (dist > this.options.range) return;
      
      const brng = this.bearing(currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
      const heading = window.smoothedHeading || 0;
      const relBearing = (brng - heading + 360) % 360;
      
      // 極座標から直交座標へ変換
      const normalizedDist = dist / this.options.range;
      const r = normalizedDist * radius;
      const angle = (relBearing - 90) * Math.PI / 180;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      
      // 光点の色（距離グラデーション）
      const color = this.getDistanceColor(dist, 0, this.options.range);
      
      // 光点サイズ（ドラゴンレーダー風に少し大きめ）
      const baseSize = 14;
      const size = baseSize * (1 - normalizedDist * 0.4);
      
      // グローエフェクト（黄色系で明るく）
      const glowGrad = ctx.createRadialGradient(x, y, 0, x, y, size * 2.5);
      glowGrad.addColorStop(0, '#ffd700');
      glowGrad.addColorStop(0.4, 'rgba(255, 215, 0, 0.6)');
      glowGrad.addColorStop(1, 'rgba(255, 215, 0, 0)');
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(x, y, size * 2.5, 0, Math.PI * 2);
      ctx.fill();
      
      // 光点本体（距離グラデーション）
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
      
      // 外周リング
      ctx.strokeStyle = '#ff6b00';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      // 完了済みの場合、チェックマーク
      if (completedCheckpoints.has(cp.id)) {
        ctx.fillStyle = '#2d3748';
        ctx.font = `bold ${size * 1.5}px system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('✓', x, y);
      } else {
        // ポイント数表示
        ctx.fillStyle = '#2d3748';
        ctx.font = `bold ${Math.max(size * 0.9, 10)}px system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(cp.points, x, y);
      }
      
      // スキャンライン通過時のフラッシュ効果
      const scanDiff = Math.abs(((relBearing - this.scanAngle + 540) % 360) - 180);
      if (scanDiff < 5) {
        ctx.strokeStyle = 'rgba(255, 193, 7, 0.9)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, size + 6, 0, Math.PI * 2);
        ctx.stroke();
        
        // 音響フィードバック
        if (this.options.audioEnabled) {
          this.playDetectionBeep(dist);
        }
      }
      
      // 最寄りCPにパルス効果
      if (cp.id === this.getNearestCheckpointId(currentPosition, checkpoints, completedCheckpoints)) {
        const pulsePhase = (Date.now() % 2000) / 2000;
        const pulseAlpha = 0.4 + Math.sin(pulsePhase * Math.PI * 2) * 0.3;
        ctx.strokeStyle = `rgba(255, 107, 0, ${pulseAlpha})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, size + 8, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  }
  
  drawDistanceGradientBar() {
    if (!this.distanceCtx) return;
    
    const currentPosition = window.currentPosition;
    if (!currentPosition) return;
    
    const ctx = this.distanceCtx;
    const w = this.distanceCanvas.width;
    const h = this.distanceCanvas.height;
    
    ctx.clearRect(0, 0, w, h);
    
    // グラデーションバー
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, 'hsl(240, 80%, 50%)');
    grad.addColorStop(0.25, 'hsl(180, 80%, 50%)');
    grad.addColorStop(0.5, 'hsl(120, 80%, 50%)');
    grad.addColorStop(0.75, 'hsl(60, 80%, 50%)');
    grad.addColorStop(1, 'hsl(0, 80%, 50%)');
    
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    
    // CPマーカー
    const markersContainer = document.getElementById('distance-markers-container');
    if (markersContainer) {
      markersContainer.innerHTML = '';
      
      const checkpoints = window.checkpoints || [];
      const completedCheckpoints = window.completedCheckpoints || new Set();
      
      checkpoints.forEach(cp => {
        if (completedCheckpoints.has(cp.id)) return;
        
        const dist = this.distance(currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
        if (dist > this.options.range) return;
        
        const position = (dist / this.options.range) * 100;
        const color = this.getDistanceColor(dist, 0, this.options.range);
        
        const marker = document.createElement('div');
        marker.className = 'distance-marker';
        marker.textContent = cp.points;
        marker.style.background = color;
        marker.style.left = `${position}%`;
        marker.style.width = '28px';
        marker.style.height = '28px';
        marker.style.fontSize = '12px';
        marker.title = `${cp.name}: ${Math.round(dist)}m`;
        
        markersContainer.appendChild(marker);
      });
    }
  }
  
  drawElevationProfile() {
    if (!this.elevationCtx) return;
    
    const currentPosition = window.currentPosition;
    if (!currentPosition) return;
    
    const ctx = this.elevationCtx;
    const w = this.elevationCanvas.width;
    const h = this.elevationCanvas.height;
    
    ctx.clearRect(0, 0, w, h);
    
    // 背景
    ctx.fillStyle = '#f7fafc';
    ctx.fillRect(0, 0, w, h);
    
    const currentElev = currentPosition.elevation || 650;
    const baselineY = h * 0.55;
    const leftMargin = 40;
    const rightMargin = 5;
    
    // 凡例を右上に追加
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.fillRect(w - 115, 8, 110, 38);
    ctx.strokeStyle = '#cbd5e0';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(w - 115, 8, 110, 38);
    
    ctx.font = 'bold 11px system-ui';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(w - 108, 15, 16, 11);
    ctx.fillStyle = '#2d3748';
    ctx.fillText('🔺登り', w - 87, 23);
    
    ctx.fillStyle = '#3b82f6';
    ctx.fillRect(w - 108, 31, 16, 11);
    ctx.fillStyle = '#2d3748';
    ctx.fillText('🔻下り', w - 87, 39);
    ctx.restore();
    
    // Yaxis スケール（左側）
    ctx.save();
    ctx.font = 'bold 10px system-ui';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#4a5568';
    
    const scaleSteps = [50, 25, 0, -25, -50];
    const maxScaleHeight = h * 0.35;
    
    scaleSteps.forEach(diff => {
      const y = baselineY - (diff / 50) * maxScaleHeight;
      
      // 横線
      ctx.strokeStyle = diff === 0 ? 'rgba(72, 187, 120, 0.8)' : 'rgba(160, 174, 192, 0.3)';
      ctx.lineWidth = diff === 0 ? 2.5 : 1;
      if (diff === 0) {
        ctx.setLineDash([]);
      } else {
        ctx.setLineDash([4, 4]);
      }
      ctx.beginPath();
      ctx.moveTo(leftMargin - 3, y);
      ctx.lineTo(w - rightMargin, y);
      ctx.stroke();
      
      // ラベル
      const label = diff === 0 ? `${currentElev}m` : `${diff > 0 ? '+' : ''}${diff}`;
      ctx.fillText(label, leftMargin - 6, y + 3);
    });
    ctx.setLineDash([]);
    ctx.restore();
    
    // タイトル
    ctx.fillStyle = '#2d3748';
    ctx.font = 'bold 12px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText('標高プロファイル', 8, 15);
    
    // 各CPの標高バー（Xaxisをsonar.rangeベースに統一）
    const checkpoints = window.checkpoints || [];
    const completedCheckpoints = window.completedCheckpoints || new Set();
    
    let cpData = [];
    checkpoints.forEach(cp => {
      const dist = this.distance(currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
      if (dist <= this.options.range && !completedCheckpoints.has(cp.id)) {
        cpData.push({ cp, dist });
      }
    });
    
    if (cpData.length === 0) {
      ctx.fillStyle = '#718096';
      ctx.font = 'bold 14px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('範囲内にCPがありません', w / 2, h / 2);
      return;
    }
    
    // CPバーとラベル（距離バーと同じスケールを使用）
    const graphWidth = w - leftMargin - rightMargin;
    
    cpData.forEach(({ cp, dist }) => {
      // 距離バーと同じ位置計算（sonar.rangeベース）
      const x = leftMargin + (dist / this.options.range) * graphWidth;
      
      const elevDiff = (cp.elevation || 650) - currentElev;
      const barHeight = Math.min(Math.abs(elevDiff) / 1.2, maxScaleHeight * 0.9);
      
      // バーの色
      const alpha = 0.6 + (barHeight / maxScaleHeight) * 0.3;
      const color = elevDiff > 0 
        ? `rgba(239, 68, 68, ${alpha})` 
        : `rgba(59, 130, 246, ${alpha})`;
      
      // バー本体
      ctx.fillStyle = color;
      const barWidth = 12;
      if (elevDiff > 0) {
        ctx.fillRect(x - barWidth/2, baselineY - barHeight, barWidth, barHeight);
      } else {
        ctx.fillRect(x - barWidth/2, baselineY, barWidth, Math.abs(barHeight));
      }
      
      // 外枠
      ctx.strokeStyle = '#2d3748';
      ctx.lineWidth = 1.5;
      if (elevDiff > 0) {
        ctx.strokeRect(x - barWidth/2, baselineY - barHeight, barWidth, barHeight);
      } else {
        ctx.strokeRect(x - barWidth/2, baselineY, barWidth, Math.abs(barHeight));
      }
      
      // CP番号と標高差（背景付き）
      const labelOffset = 22;
      const textY = elevDiff > 0 ? baselineY - barHeight - labelOffset : baselineY + barHeight + labelOffset;
      
      // 白い円背景（大きめ）
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x, textY, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#2d3748';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      // CP番号
      ctx.fillStyle = '#2d3748';
      ctx.font = 'bold 17px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(cp.points, x, textY);
      
      // 標高差ラベル（バーの外側）
      ctx.font = 'bold 11px system-ui';
      ctx.fillStyle = elevDiff > 0 ? '#ef4444' : '#3b82f6';
      const elevText = `${elevDiff > 0 ? '+' : ''}${Math.round(elevDiff)}m`;
      const elevLabelY = elevDiff > 0 ? textY - 20 : textY + 20;
      ctx.fillText(elevText, x, elevLabelY);
    });
    
    // 現在地マーカー（左端）の説明ラベル
    ctx.fillStyle = '#4a5568';
    ctx.font = 'bold 10px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText('現在地', leftMargin + 2, h - 8);
  }
  
  // ========== 最寄りCP情報 ==========
  updateNearestInfo(currentPosition, checkpoints, completedIds) {
    const infoName = document.querySelector('#sonar-nearest-info .info-name');
    const infoDetails = document.querySelector('#sonar-nearest-info .info-details');
    
    if (!infoName || !infoDetails || !currentPosition) {
      if (infoName) infoName.textContent = '最寄りのターゲット';
      if (infoDetails) infoDetails.innerHTML = '<span style="color:#718096;">位置情報を取得中...</span>';
      return;
    }
    
    let nearestCP = null;
    let nearestDist = Infinity;
    
    checkpoints.forEach(cp => {
      if (completedIds.has(cp.id)) return;
      const d = this.distance(currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
      if (d < nearestDist) {
        nearestDist = d;
        nearestCP = cp;
      }
    });
    
    if (nearestCP) {
      const elevDiff = (nearestCP.elevation || 650) - (currentPosition.elevation || 650);
      const eta = this.calculateETA(nearestDist, elevDiff);
      const elevText = elevDiff !== 0 ? ` ${elevDiff > 0 ? '↗+' : '↘'}${Math.abs(Math.round(elevDiff))}m` : '';
      
      infoName.textContent = '最寄りのターゲット';
      infoDetails.innerHTML = `
        <span style="font-size:18px;color:#667eea;font-weight:800;">${nearestCP.name}</span>
        <span>📍 ${Math.round(nearestDist)}m${elevText}</span>
        <span>⏱️ 約${Math.round(eta)}分</span>
        <span style="background:#667eea;color:#fff;padding:4px 12px;border-radius:12px;">⭐ ${nearestCP.points}点</span>
      `;
    } else {
      infoName.textContent = '最寄りのターゲット';
      infoDetails.innerHTML = '<span style="color:#48bb78;font-weight:800;font-size:18px;">🎉 すべてクリア!</span>';
    }
  }
  
  getNearestCheckpointId(currentPosition, checkpoints, completedIds) {
    if (!currentPosition) return null;
    
    let nearestId = null;
    let nearestDist = Infinity;
    
    checkpoints.forEach(cp => {
      if (completedIds.has(cp.id)) return;
      const d = this.distance(currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
      if (d < nearestDist) {
        nearestDist = d;
        nearestId = cp.id;
      }
    });
    
    return nearestId;
  }
  
  // ========== クリックイベント ==========
  handleElevationClick(e) {
    const currentPosition = window.currentPosition;
    if (!currentPosition) return;
    
    const rect = this.elevationCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    
    const checkpoints = window.checkpoints || [];
    const completedCheckpoints = window.completedCheckpoints || new Set();
    
    const w = this.elevationCanvas.width;
    const leftMargin = 40;
    const rightMargin = 5;
    const graphWidth = w - leftMargin - rightMargin;
    
    let cpData = [];
    checkpoints.forEach(cp => {
      const dist = this.distance(currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
      if (dist <= this.options.range && !completedCheckpoints.has(cp.id)) {
        cpData.push({ cp, dist });
      }
    });
    
    if (cpData.length === 0) return;
    
    // クリック位置に最も近いCPを探す
    let nearestCP = null;
    let minDistance = Infinity;
    
    cpData.forEach(({ cp, dist }) => {
      const cpX = leftMargin + (dist / this.options.range) * graphWidth;
      const clickDist = Math.abs(x - cpX);
      
      if (clickDist < 25 && clickDist < minDistance) {
        minDistance = clickDist;
        nearestCP = { cp, dist };
      }
    });
    
    if (nearestCP) {
      this.showDetailModal(nearestCP.cp, nearestCP.dist);
    }
  }
  
  handleSonarClick(e) {
    const currentPosition = window.currentPosition;
    if (!currentPosition) return;
    
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const w = this.canvas.width;
    const h = this.canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(cx, cy) - 20;
    
    const checkpoints = window.checkpoints || [];
    const completedCheckpoints = window.completedCheckpoints || new Set();
    
    // クリック位置に最も近いCPを探す
    let nearestCP = null;
    let minDistance = Infinity;
    
    checkpoints.forEach(cp => {
      const dist = this.distance(currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
      if (dist > this.options.range) return;
      
      const brng = this.bearing(currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
      const heading = window.smoothedHeading || 0;
      const relBearing = (brng - heading + 360) % 360;
      
      const normalizedDist = dist / this.options.range;
      const r = normalizedDist * radius;
      const angle = (relBearing - 90) * Math.PI / 180;
      const cpX = cx + r * Math.cos(angle);
      const cpY = cy + r * Math.sin(angle);
      
      const clickDist = Math.sqrt((x - cpX) ** 2 + (y - cpY) ** 2);
      if (clickDist < 30 && clickDist < minDistance) {
        minDistance = clickDist;
        nearestCP = { cp, dist };
      }
    });
    
    if (nearestCP) {
      this.showDetailModal(nearestCP.cp, nearestCP.dist);
    }
  }
  
  showDetailModal(cp, dist) {
    const currentPosition = window.currentPosition;
    if (!currentPosition) return;
    
    const elevDiff = (cp.elevation || 650) - (currentPosition.elevation || 650);
    const eta = this.calculateETA(dist, elevDiff);
    const brng = this.bearing(currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
    
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:10000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);animation:fadeIn 0.2s;';
    
    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:#fff;padding:25px;border-radius:16px;max-width:400px;width:90%;box-shadow:0 10px 40px rgba(0,0,0,0.3);';
    
    const title = document.createElement('h3');
    title.textContent = cp.name;
    title.style.cssText = 'margin:0 0 20px 0;font-size:22px;color:#2d3748;font-weight:800;';
    dialog.appendChild(title);
    
    const infoGrid = document.createElement('div');
    infoGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-bottom:20px;';
    
    const addInfoItem = (label, value, icon) => {
      const item = document.createElement('div');
      item.style.cssText = 'background:#f7fafc;padding:12px;border-radius:10px;';
      item.innerHTML = `
        <div style="font-size:12px;color:#718096;margin-bottom:4px;font-weight:600;">${icon} ${label}</div>
        <div style="font-size:18px;color:#2d3748;font-weight:800;">${value}</div>
      `;
      infoGrid.appendChild(item);
    };
    
    addInfoItem('距離', `${Math.round(dist)}m`, '📍');
    addInfoItem('方位', `${Math.round(brng)}°`, '🧭');
    addInfoItem('標高', `${cp.elevation || 650}m`, '⛰️');
    addInfoItem('標高差', `${elevDiff > 0 ? '↗+' : elevDiff < 0 ? '↘' : ''}${Math.abs(Math.round(elevDiff))}m`, '📊');
    addInfoItem('推定時間', `約${Math.round(eta)}分`, '⏱️');
    addInfoItem('ポイント', `${cp.points}点`, '⭐');
    
    dialog.appendChild(infoGrid);
    
    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = 'display:flex;gap:10px;';
    
    const mapBtn = document.createElement('button');
    mapBtn.textContent = '🗺️ 地図で確認';
    mapBtn.style.cssText = 'flex:1;padding:14px;background:#667eea;color:#fff;border:none;border-radius:10px;font-weight:800;cursor:pointer;font-size:15px;';
    mapBtn.onclick = () => {
      document.body.removeChild(modal);
      if (typeof switchView === 'function') {
        switchView('map');
      }
      if (window.geoMgr && window.geoMgr.map) {
        window.geoMgr.map.setView([cp.lat, cp.lng], 16);
      }
    };
    btnContainer.appendChild(mapBtn);
    
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '閉じる';
    closeBtn.style.cssText = 'flex:1;padding:14px;background:#cbd5e0;color:#2d3748;border:none;border-radius:10px;font-weight:800;cursor:pointer;font-size:15px;';
    closeBtn.onclick = () => {
      document.body.removeChild(modal);
    };
    btnContainer.appendChild(closeBtn);
    
    dialog.appendChild(btnContainer);
    modal.appendChild(dialog);
    
    // 背景クリックで閉じる
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        document.body.removeChild(modal);
      }
    });
    
    document.body.appendChild(modal);
    
    this.log(`CP詳細: ${cp.name}`);
  }
  
  // ========== 音響 ==========
  initAudio() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    this.audioContext = new AudioContext();
    this.log('音響システム初期化完了');
  }
  
  playDetectionBeep(distance) {
    if (!this.audioContext || !this.options.audioEnabled) return;
    
    const ctx = this.audioContext;
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    // 距離に応じた周波数（近いほど高い音）
    const freq = 400 + (1 - distance / this.options.range) * 400; // 400-800Hz
    oscillator.frequency.value = freq;
    oscillator.type = 'sine';
    
    // 音量（近いほど大きい）
    const volume = (1 - distance / this.options.range) * 0.1;
    gainNode.gain.value = volume;
    
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.05); // 50msの短いビープ
  }
  
  playScanSound() {
    if (!this.audioContext || !this.options.audioEnabled) return;
    
    const ctx = this.audioContext;
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    oscillator.frequency.value = 600;
    oscillator.type = 'sine';
    gainNode.gain.value = 0.03; // 控えめな音量
    
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.02);
  }
  
  checkScanSound() {
    if (Math.floor(this.scanAngle / 360) > Math.floor(this.lastScanSoundAngle / 360)) {
      this.playScanSound();
    }
    this.lastScanSoundAngle = this.scanAngle;
  }
  
  // ========== ユーティリティ ==========
  setRange(range) {
    this.options.range = range;
    this.distanceCache = {};
    this.log(`ソナーレンジ: ${range >= 1000 ? (range/1000)+'km' : range+'m'}`);
  }
  
  getCachedDistance(cpId, lat1, lon1, lat2, lon2) {
    const now = Date.now();
    if (now - this.lastCacheTime > 1000) {
      this.distanceCache = {};
      this.lastCacheTime = now;
    }
    if (!this.distanceCache[cpId]) {
      this.distanceCache[cpId] = this.distance(lat1, lon1, lat2, lon2);
    }
    return this.distanceCache[cpId];
  }
  
  distance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
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
    const baseSpeed = 67; // m/min
    const flatTime = distance / baseSpeed;
    const elevationPenalty = Math.max(0, elevationDiff) * 0.15;
    return flatTime + elevationPenalty;
  }
  
  getDistanceColor(distance, minDist, maxDist) {
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
  
  // ========== 表示/非表示 ==========
  show() {
    const container = document.getElementById('sonar-view');
    if (container) {
      container.hidden = false;
      this.resizeCanvas();
    }
  }
  
  hide() {
    this.stopAnimation();
    const container = document.getElementById('sonar-view');
    if (container) {
      container.hidden = true;
    }
  }
  
  log(message) {
    if (typeof debugLog === 'function') {
      debugLog(message);
    } else {
      console.log(`[SonarView] ${message}`);
    }
  }
}

// グローバルエクスポート
if (typeof window !== 'undefined') {
  window.SonarView = SonarView;
}

// 初期化完了ログ
if (typeof debugLog === 'function') {
  debugLog('✅ SonarView 読み込み完了');
} else {
  console.log('[SonarView] Loaded');
}

