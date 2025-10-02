/**
 * SonarView - ソナー表示管理（リファクタリング版）
 * 依存性注入パターンを使用し、グローバル変数への依存を排除
 */

class SonarView {
  constructor(options = {}) {
    this.options = {
      range: options.range ?? 1000,
      scanSpeed: options.scanSpeed ?? 72,
      audioEnabled: options.audioEnabled ?? false
    };
    
    // 依存性注入
    this.stateMgr = options.stateMgr;
    this.geoMgr = options.geoMgr;
    this.orientationMgr = options.orientationMgr;
    
    // Canvas要素
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
    
    if (!this.stateMgr || !this.geoMgr || !this.orientationMgr) {
      this.log('⚠️ StateManager/GeoManager/OrientationManagerが注入されていません');
    }
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
    this.initAudio();
    this.setupEventListeners();
    
    this.log('✅ SonarView初期化完了');
    return true;
  }
  
  setupEventListeners() {
    // 音響トグル
    const audioToggle = document.getElementById('sonar-audio-enable');
    if (audioToggle) {
      audioToggle.checked = this.options.audioEnabled;
      audioToggle.addEventListener('change', (e) => {
        this.options.audioEnabled = e.target.checked;
      });
    }
    
    // クリックイベント
    this.elevationCanvas?.addEventListener('click', (e) => this.handleElevationClick(e));
    this.canvas?.addEventListener('click', (e) => this.handleSonarClick(e));
  }
  
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
  }
  
  loop(timestamp) {
    if (!this.animationId) return;
    
    if (this.lastUpdateTime === 0) {
      this.lastUpdateTime = timestamp;
    }
    
    const deltaTime = timestamp - this.lastUpdateTime;
    this.scanAngle = (this.scanAngle + (this.options.scanSpeed * deltaTime / 1000)) % 360;
    this.lastUpdateTime = timestamp;
    
    this.draw();
    this.checkScanSound();
    
    this.animationId = requestAnimationFrame((t) => this.loop(t));
  }
  
  // ========== 更新 ==========
  update(currentPosition, heading, checkpoints, completedIds) {
    if (!currentPosition) return;
    this.updateNearestInfo(currentPosition, checkpoints, completedIds);
  }
  
  // ========== 描画メイン ==========
  draw() {
    this.drawSonarDisplay();
    this.drawDistanceGradientBar();
    this.drawElevationProfile();
  }
  
  // ========== ソナー円形ディスプレイ ==========
  drawSonarDisplay() {
    if (!this.ctx || !this.stateMgr) return;
    
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(cx, cy) - 20;
    
    ctx.clearRect(0, 0, w, h);
    
    ctx.save();
    ctx.translate(cx, cy);
    const heading = this.orientationMgr?.getHeading() || 0;
    ctx.rotate(heading * Math.PI / 180);  // 修正: +headingで正しい回転方向
    ctx.translate(-cx, -cy);
    
    // 背景
    const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    bgGrad.addColorStop(0, '#a8e6cf');
    bgGrad.addColorStop(0.5, '#7ed6a8');
    bgGrad.addColorStop(1, '#6bc99b');
    ctx.fillStyle = bgGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    
    this.drawDistanceRings(ctx, cx, cy, radius);
    this.drawScanLine(ctx, cx, cy, radius);
    this.drawSonarCheckpoints(ctx, cx, cy, radius);
    
    // 中心点
    ctx.fillStyle = '#ff6b9d';
    ctx.beginPath();
    ctx.arc(cx, cy, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.stroke();
    
    ctx.restore();
  }
  
  drawDistanceRings(ctx, cx, cy, radius) {
    const rings = 4;
    ctx.strokeStyle = 'rgba(45, 55, 72, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.fillStyle = 'rgba(45, 55, 72, 0.7)';
    ctx.font = 'bold 12px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    for (let i = 1; i <= rings; i++) {
      const r = (radius / rings) * i;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      
      const distLabel = Math.round((this.options.range / rings) * i);
      const labelText = distLabel >= 1000 ? `${(distLabel/1000).toFixed(1)}km` : `${distLabel}m`;
      ctx.fillText(labelText, cx, cy - r + 14);
    }
  }
  
  drawScanLine(ctx, cx, cy, radius) {
    const scanArc = 45;
    const startAngle = (this.scanAngle - 90) * Math.PI / 180;
    const endAngle = (this.scanAngle + scanArc - 90) * Math.PI / 180;
    
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
    
    ctx.strokeStyle = 'rgba(255, 193, 7, 0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    const lineAngle = (this.scanAngle - 90) * Math.PI / 180;
    ctx.lineTo(cx + radius * Math.cos(lineAngle), cy + radius * Math.sin(lineAngle));
    ctx.stroke();
  }
  
  drawSonarCheckpoints(ctx, cx, cy, radius) {
    const currentPosition = this.stateMgr?.currentPosition;
    const checkpoints = this.stateMgr?.checkpoints || [];
    const completedCheckpoints = this.stateMgr?.completedIds || new Set();
    
    if (!currentPosition || !this.geoMgr) return;
    
    checkpoints.forEach(cp => {
      const dist = this.getCachedDistance(cp.id, currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
      if (dist > this.options.range) return;
      
      const brng = this.geoMgr.bearing(currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
      // 修正: Canvas全体が既に-headingで回転しているため、CPは絶対方位(brng)で配置
      const relBearing = brng;
      
      const normalizedDist = dist / this.options.range;
      const r = normalizedDist * radius;
      const angle = (relBearing - 90) * Math.PI / 180;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      
      const color = this.getDistanceColor(dist, 0, this.options.range);
      const baseSize = 14;
      const size = baseSize * (1 - normalizedDist * 0.4);
      
      // グロー
      const glowGrad = ctx.createRadialGradient(x, y, 0, x, y, size * 2.5);
      glowGrad.addColorStop(0, '#ffd700');
      glowGrad.addColorStop(0.4, 'rgba(255, 215, 0, 0.6)');
      glowGrad.addColorStop(1, 'rgba(255, 215, 0, 0)');
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(x, y, size * 2.5, 0, Math.PI * 2);
      ctx.fill();
      
      // 光点
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ff6b00';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      // ラベル
      if (completedCheckpoints.has(cp.id)) {
        ctx.fillStyle = '#2d3748';
        ctx.font = `bold ${size * 1.5}px system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('✓', x, y);
      } else {
        ctx.fillStyle = '#2d3748';
        ctx.font = `bold ${Math.max(size * 0.9, 10)}px system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(cp.points, x, y);
      }
      
      // スキャンライン通過時のフラッシュ
      const scanDiff = Math.abs(((relBearing - this.scanAngle + 540) % 360) - 180);
      if (scanDiff < 5) {
        ctx.strokeStyle = 'rgba(255, 193, 7, 0.9)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, size + 6, 0, Math.PI * 2);
        ctx.stroke();
        
        if (this.options.audioEnabled) {
          this.playDetectionBeep(dist);
        }
      }
    });
  }
  
  // ========== 距離バー ==========
  drawDistanceGradientBar() {
    if (!this.distanceCtx || !this.stateMgr) return;
    
    const currentPosition = this.stateMgr.currentPosition;
    if (!currentPosition) return;
    
    const ctx = this.distanceCtx;
    const w = this.distanceCanvas.width;
    const h = this.distanceCanvas.height;
    
    ctx.clearRect(0, 0, w, h);
    
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, 'hsl(240, 80%, 50%)');
    grad.addColorStop(0.25, 'hsl(180, 80%, 50%)');
    grad.addColorStop(0.5, 'hsl(120, 80%, 50%)');
    grad.addColorStop(0.75, 'hsl(60, 80%, 50%)');
    grad.addColorStop(1, 'hsl(0, 80%, 50%)');
    
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    
    this.updateDistanceMarkers(currentPosition);
  }
  
  updateDistanceMarkers(currentPosition) {
    const markersContainer = document.getElementById('distance-markers-container');
    if (!markersContainer || !this.stateMgr || !this.geoMgr) return;
    
    markersContainer.innerHTML = '';
    
    const checkpoints = this.stateMgr.checkpoints || [];
    const completedCheckpoints = this.stateMgr.completedIds || new Set();
    
    checkpoints.forEach(cp => {
      if (completedCheckpoints.has(cp.id)) return;
      
      const dist = this.geoMgr.distance(currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
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
  
  // ========== 標高プロファイル ==========
  drawElevationProfile() {
    if (!this.elevationCtx || !this.stateMgr) return;
    
    const currentPosition = this.stateMgr.currentPosition;
    if (!currentPosition) return;
    
    const ctx = this.elevationCtx;
    const w = this.elevationCanvas.width;
    const h = this.elevationCanvas.height;
    
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#f7fafc';
    ctx.fillRect(0, 0, w, h);
    
    const currentElev = currentPosition.elevation || 650;
    const baselineY = h * 0.55;
    const leftMargin = 40;
    const rightMargin = 5;
    const maxScaleHeight = h * 0.35;
    
    this.drawElevationLegend(ctx, w);
    this.drawElevationScale(ctx, h, baselineY, leftMargin, rightMargin, maxScaleHeight, currentElev);
    this.drawElevationTitle(ctx);
    
    const cpData = this.getVisibleCheckpoints(currentPosition);
    
    if (cpData.length === 0) {
      ctx.fillStyle = '#718096';
      ctx.font = 'bold 14px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('範囲内にCPがありません', w / 2, h / 2);
      return;
    }
    
    this.drawElevationBars(ctx, cpData, w, h, baselineY, leftMargin, rightMargin, maxScaleHeight, currentElev);
  }
  
  drawElevationLegend(ctx, w) {
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
  }
  
  drawElevationScale(ctx, h, baselineY, leftMargin, rightMargin, maxScaleHeight, currentElev) {
    ctx.save();
    ctx.font = 'bold 10px system-ui';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#4a5568';
    
    const scaleSteps = [50, 25, 0, -25, -50];
    
    scaleSteps.forEach(diff => {
      const y = baselineY - (diff / 50) * maxScaleHeight;
      
      ctx.strokeStyle = diff === 0 ? 'rgba(72, 187, 120, 0.8)' : 'rgba(160, 174, 192, 0.3)';
      ctx.lineWidth = diff === 0 ? 2.5 : 1;
      ctx.setLineDash(diff === 0 ? [] : [4, 4]);
      
      ctx.beginPath();
      ctx.moveTo(leftMargin - 3, y);
      ctx.lineTo(this.elevationCanvas.width - rightMargin, y);
      ctx.stroke();
      
      const label = diff === 0 ? `${currentElev}m` : `${diff > 0 ? '+' : ''}${diff}`;
      ctx.fillText(label, leftMargin - 6, y + 3);
    });
    
    ctx.setLineDash([]);
    ctx.restore();
  }
  
  drawElevationTitle(ctx) {
    ctx.fillStyle = '#2d3748';
    ctx.font = 'bold 12px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText('標高プロファイル', 8, 15);
  }
  
  drawElevationBars(ctx, cpData, w, h, baselineY, leftMargin, rightMargin, maxScaleHeight, currentElev) {
    const graphWidth = w - leftMargin - rightMargin;
    
    cpData.forEach(({ cp, dist }) => {
      const x = leftMargin + (dist / this.options.range) * graphWidth;
      const elevDiff = (cp.elevation || 650) - currentElev;
      const barHeight = Math.min(Math.abs(elevDiff) / 1.2, maxScaleHeight * 0.9);
      
      const alpha = 0.6 + (barHeight / maxScaleHeight) * 0.3;
      const color = elevDiff > 0 
        ? `rgba(239, 68, 68, ${alpha})` 
        : `rgba(59, 130, 246, ${alpha})`;
      
      const barWidth = 12;
      ctx.fillStyle = color;
      
      if (elevDiff > 0) {
        ctx.fillRect(x - barWidth/2, baselineY - barHeight, barWidth, barHeight);
      } else {
        ctx.fillRect(x - barWidth/2, baselineY, barWidth, Math.abs(barHeight));
      }
      
      ctx.strokeStyle = '#2d3748';
      ctx.lineWidth = 1.5;
      
      if (elevDiff > 0) {
        ctx.strokeRect(x - barWidth/2, baselineY - barHeight, barWidth, barHeight);
      } else {
        ctx.strokeRect(x - barWidth/2, baselineY, barWidth, Math.abs(barHeight));
      }
      
      this.drawElevationLabel(ctx, x, baselineY, barHeight, elevDiff, cp);
    });
    
    ctx.fillStyle = '#4a5568';
    ctx.font = 'bold 10px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText('現在地', leftMargin + 2, h - 8);
  }
  
  drawElevationLabel(ctx, x, baselineY, barHeight, elevDiff, cp) {
    const labelOffset = 22;
    const textY = elevDiff > 0 ? baselineY - barHeight - labelOffset : baselineY + barHeight + labelOffset;
    
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, textY, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2d3748';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    ctx.fillStyle = '#2d3748';
    ctx.font = 'bold 17px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(cp.points, x, textY);
    
    ctx.font = 'bold 11px system-ui';
    ctx.fillStyle = elevDiff > 0 ? '#ef4444' : '#3b82f6';
    const elevText = `${elevDiff > 0 ? '+' : ''}${Math.round(elevDiff)}m`;
    const elevLabelY = elevDiff > 0 ? textY - 20 : textY + 20;
    ctx.fillText(elevText, x, elevLabelY);
  }
  
  getVisibleCheckpoints(currentPosition) {
    const checkpoints = this.stateMgr?.checkpoints || [];
    const completedCheckpoints = this.stateMgr?.completedIds || new Set();
    
    if (!this.geoMgr) return [];
    
    let cpData = [];
    checkpoints.forEach(cp => {
      const dist = this.geoMgr.distance(currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
      if (dist <= this.options.range && !completedCheckpoints.has(cp.id)) {
        cpData.push({ cp, dist });
      }
    });
    
    return cpData;
  }
  
  // ========== 最寄りCP情報 ==========
  updateNearestInfo(currentPosition, checkpoints, completedIds) {
    const infoName = document.querySelector('#sonar-nearest-info .info-name');
    const infoDetails = document.querySelector('#sonar-nearest-info .info-details');
    
    if (!infoName || !infoDetails || !currentPosition || !this.geoMgr) {
      if (infoName) infoName.textContent = '最寄りのターゲット';
      if (infoDetails) infoDetails.innerHTML = '<span style="color:#718096;">位置情報を取得中...</span>';
      return;
    }
    
    let nearestCP = null;
    let nearestDist = Infinity;
    
    checkpoints.forEach(cp => {
      if (completedIds.has(cp.id)) return;
      const d = this.geoMgr.distance(currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
      if (d < nearestDist) {
        nearestDist = d;
        nearestCP = cp;
      }
    });
    
    if (nearestCP) {
      const elevDiff = (nearestCP.elevation || 650) - (currentPosition.elevation || 650);
      const eta = this.geoMgr.calculateETA(nearestDist, elevDiff);
      const elevText = elevDiff !== 0 ? ` ${elevDiff > 0 ? '↗+' : '↘'}${Math.abs(Math.round(elevDiff))}m` : '';
      
      infoName.textContent = '最寄りのターゲット';
      infoDetails.innerHTML = `
        <span style="font-size:18px;color:#667eea;font-weight:800;">${nearestCP.name}</span>
        <span>📏 ${Math.round(nearestDist)}m${elevText}</span>
        <span>⏱️ 約${Math.round(eta)}分</span>
        <span style="background:#667eea;color:#fff;padding:4px 12px;border-radius:12px;">⭐ ${nearestCP.points}点</span>
      `;
    } else {
      infoName.textContent = '最寄りのターゲット';
      infoDetails.innerHTML = '<span style="color:#48bb78;font-weight:800;font-size:18px;">🎉 すべてクリア!</span>';
    }
  }
  
  // ========== クリックイベント ==========
  handleElevationClick(e) {
    const cp = this.findClickedCheckpoint(e, 'elevation');
    if (cp) this.showDetailModal(cp.cp, cp.dist);
  }
  
  handleSonarClick(e) {
    const cp = this.findClickedCheckpoint(e, 'sonar');
    if (cp) this.showDetailModal(cp.cp, cp.dist);
  }
  
  findClickedCheckpoint(e, type) {
    const currentPosition = this.stateMgr?.currentPosition;
    if (!currentPosition || !this.geoMgr) return null;
    
    if (type === 'elevation') {
      return this.findElevationCheckpoint(e, currentPosition);
    } else {
      return this.findSonarCheckpoint(e, currentPosition);
    }
  }
  
  findElevationCheckpoint(e, currentPosition) {
    const rect = this.elevationCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const w = this.elevationCanvas.width;
    const leftMargin = 40;
    const rightMargin = 5;
    const graphWidth = w - leftMargin - rightMargin;
    
    const cpData = this.getVisibleCheckpoints(currentPosition);
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
    
    return nearestCP;
  }
  
  findSonarCheckpoint(e, currentPosition) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(cx, cy) - 20;
    
    const checkpoints = this.stateMgr?.checkpoints || [];
    let nearestCP = null;
    let minDistance = Infinity;
    
    checkpoints.forEach(cp => {
      const dist = this.geoMgr.distance(currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
      if (dist > this.options.range) return;
      
      const brng = this.geoMgr.bearing(currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
      
      // 修正: Canvas全体が既に回転しているため、絶対方位を使用
      const relBearing = brng;
      
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
    
    return nearestCP;
  }
  
  showDetailModal(cp, dist) {
    const currentPosition = this.stateMgr?.currentPosition;
    if (!currentPosition || !this.geoMgr) return;
    
    const elevDiff = (cp.elevation || 650) - (currentPosition.elevation || 650);
    const eta = this.geoMgr.calculateETA(dist, elevDiff);
    const brng = this.geoMgr.bearing(currentPosition.lat, currentPosition.lng, cp.lat, cp.lng);
    
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:10000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);animation:fadeIn 0.2s;';
    
    modal.innerHTML = `
      <div style="background:#fff;padding:25px;border-radius:16px;max-width:400px;width:90%;box-shadow:0 10px 40px rgba(0,0,0,0.3);">
        <h3 style="margin:0 0 20px 0;font-size:22px;color:#2d3748;font-weight:800;">${cp.name}</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-bottom:20px;">
          ${this.createInfoItem('距離', `${Math.round(dist)}m`, '📏')}
          ${this.createInfoItem('方位', `${Math.round(brng)}°`, '🧭')}
          ${this.createInfoItem('標高', `${cp.elevation || 650}m`, '⛰️')}
          ${this.createInfoItem('標高差', `${elevDiff > 0 ? '↗+' : elevDiff < 0 ? '↘' : ''}${Math.abs(Math.round(elevDiff))}m`, '📊')}
          ${this.createInfoItem('推定時間', `約${Math.round(eta)}分`, '⏱️')}
          ${this.createInfoItem('ポイント', `${cp.points}点`, '⭐')}
        </div>
        <div style="display:flex;gap:10px;">
          <button id="modal-map-btn" style="flex:1;padding:14px;background:#667eea;color:#fff;border:none;border-radius:10px;font-weight:800;cursor:pointer;font-size:15px;">🗺️ 地図で確認</button>
          <button id="modal-close-btn" style="flex:1;padding:14px;background:#cbd5e0;color:#2d3748;border:none;border-radius:10px;font-weight:800;cursor:pointer;font-size:15px;">閉じる</button>
        </div>
      </div>
    `;
    
    modal.querySelector('#modal-map-btn').onclick = () => {
      document.body.removeChild(modal);
      if (typeof switchView === 'function') {
        switchView('map');
      }
      if (this.geoMgr && this.geoMgr.map) {
        this.geoMgr.map.setView([cp.lat, cp.lng], 16);
      }
    };
    
    modal.querySelector('#modal-close-btn').onclick = () => {
      document.body.removeChild(modal);
    };
    
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        document.body.removeChild(modal);
      }
    });
    
    document.body.appendChild(modal);
    this.log(`CP詳細: ${cp.name}`);
  }
  
  createInfoItem(label, value, icon) {
    return `
      <div style="background:#f7fafc;padding:12px;border-radius:10px;">
        <div style="font-size:12px;color:#718096;margin-bottom:4px;font-weight:600;">${icon} ${label}</div>
        <div style="font-size:18px;color:#2d3748;font-weight:800;">${value}</div>
      </div>
    `;
  }
  
  // ========== 音響 ==========
  initAudio() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      this.audioContext = new AudioContext();
    }
  }
  
  playDetectionBeep(distance) {
    if (!this.audioContext || !this.options.audioEnabled) return;
    
    const ctx = this.audioContext;
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    const freq = 400 + (1 - distance / this.options.range) * 400;
    oscillator.frequency.value = freq;
    oscillator.type = 'sine';
    
    const volume = (1 - distance / this.options.range) * 0.1;
    gainNode.gain.value = volume;
    
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.05);
  }
  
  playScanSound() {
    if (!this.audioContext || !this.options.audioEnabled) return;
    
    const ctx = this.audioContext;
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    oscillator.frequency.value = 600;
    oscillator.type = 'sine';
    gainNode.gain.value = 0.03;
    
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
    if (!this.distanceCache[cpId] && this.geoMgr) {
      this.distanceCache[cpId] = this.geoMgr.distance(lat1, lon1, lat2, lon2);
    }
    return this.distanceCache[cpId] || 0;
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

if (typeof window !== 'undefined') {
  window.SonarView = SonarView;
}

if (typeof debugLog === 'function') {
  debugLog('✅ SonarView (Fixed: CP rotation issue) 読み込み完了');
} else {
  console.log('[SonarView] Fixed version with correct CP rotation loaded');
}
