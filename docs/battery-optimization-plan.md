# ロゲイニングアプリ バッテリー最適化 作業計画

**作成日**: 2025-10-04  
**バージョン**: 1.0  
**目的**: 数時間の競技に耐えうるバッテリー消費の最適化

---

## 📋 作業概要

### 目標
- タブ切り替え時の完全停止処理（カメラ・音・センサー）
- GPS精度とキャッシュの最適化
- センサー更新頻度の動的調整
- AR描画FPSの削減
- 省電力モードUIの追加

### 期待効果
- **バッテリー消費削減: 約30-40%**
- **2時間の競技で安定動作**

---

## 🎯 作業対象ファイルと影響範囲

### 変更ファイル一覧

| ファイル名 | 変更内容 | 影響範囲 |
|-----------|---------|---------|
| **config.json** | GPS設定変更 | 軽微 |
| **app.js** | switchView改善、省電力モード追加 | **中** |
| **orientation-manager.js** | センサー頻度動的調整 | **中** |
| **view-ar.js** | FPS削減、Visibility API対応 | 軽微 |
| **view-sonar.js** | 音響最適化、スキャン速度調整 | 軽微 |
| **index.html** | 省電力モードUI追加 | 軽微 |

### 変更しないファイル
- state-manager.js
- geo-manager.js
- view-compass.js
- debug-manager.js
- styles.css
- service-worker.js
- manifest.json

---

## 📝 作業ステップ

### Phase 1: 設定ファイルの最適化
**ファイル**: `config.json`

```json
{
  "tracking": {
    "intervalSeconds": 30,
    "highAccuracy": false,
    "timeout": 10000,
    "maximumAge": 30000  // 新規追加
  }
}
```

**変更点**:
- `maximumAge`: 30秒キャッシュを追加（GPS消費削減）

---

### Phase 2: タブ切り替え処理の改善
**ファイル**: `app.js`

#### 変更1: switchView関数の全面改修

**Before**:
```javascript
// else節でまとめて停止（不完全）
else {
  compassView?.hide();
  sonarView.hide();
  if (arView) arView.stop();
}
```

**After**:
```javascript
// 全ビューを明示的に停止してから新しいビューを開始
if (compassView) compassView.hide();
if (sonarView) sonarView.hide();
if (arView) arView.stop();

// その後、選択されたビューのみ開始
if (view === 'compass') {
  compassView.show();
} else if (view === 'sonar') {
  sonarView.show();
  sonarView.startAnimation();
} else if (view === 'ar') {
  arView.start();
}
```

#### 変更2: 省電力モード実装

**新規追加機能**:
- GPS精度の動的変更
- センサー頻度の削減
- AR FPS制限の強化
- LocalStorageへの設定保存

---

### Phase 3: センサー頻度の動的調整
**ファイル**: `orientation-manager.js`

#### 変更1: 頻度設定の追加

```javascript
this.sensorFrequency = {
  compass: 10,  // 10Hz
  sonar: 15,    // 15Hz
  ar: 20        // 20Hz
};
this.currentFrequency = 10;
```

#### 変更2: setMode()の改善

センサー再起動による頻度変更を実装

---

### Phase 4: AR描画の最適化
**ファイル**: `view-ar.js`

#### 変更1: FPS削減

```javascript
this.fpsLimit = 15;  // 30fps → 15fps
```

#### 変更2: Visibility API対応

```javascript
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    this.isVisible = false;
  } else {
    this.isVisible = true;
  }
});
```

#### 変更3: 非表示時の描画スキップ

```javascript
if (!this.isVisible) {
  // 描画をスキップ
  return;
}
```

---

### Phase 5: Sonar音響の最適化
**ファイル**: `view-sonar.js`

#### 変更1: スキャン速度の削減

```javascript
scanSpeed: 36  // 72 → 36
```

#### 変更2: 音の再生頻度制限

```javascript
// 360度回転ごとに1回のみ
if (currentRotation > lastRotation) {
  this.playScanSound();
}
```

#### 変更3: 停止時の音響無効化

```javascript
stopAnimation() {
  this._tempAudioDisabled = true;
}
```

---

### Phase 6: UI追加
**ファイル**: `index.html`

#### 省電力モードチェックボックス

```html
<div class="battery-saver-toggle">
  <label>
    <input type="checkbox" id="battery-saver-mode">
    <span>🔋 省電力モード</span>
  </label>
  <p>GPS精度↓、センサー頻度↓、画面輝度↓</p>
</div>
```

---

## ✅ テスト項目

### 機能テスト
- [ ] Map → Compass: 正常動作
- [ ] Map → Sonar: 正常動作、音が開始
- [ ] Map → AR: 正常動作、カメラが開始
- [ ] Sonar → Map: 音が停止
- [ ] Sonar → Compass: 音が停止
- [ ] Sonar → AR: 音が停止、カメラが開始
- [ ] AR → Map: カメラが停止
- [ ] AR → Compass: カメラが停止
- [ ] AR → Sonar: カメラが停止、音が開始

### 省電力モードテスト
- [ ] チェックON: GPS精度が下がる
- [ ] チェックON: センサー頻度が下がる
- [ ] チェックON: AR FPSが下がる
- [ ] チェックOFF: 通常モードに戻る
- [ ] LocalStorage保存: リロード後も設定維持

### バッテリー消費テスト
- [ ] 各ビューで10分間動作させてバッテリー消費を計測
- [ ] 省電力モードON/OFFで比較

---

## 🚨 リスクと対策

### リスク1: センサー頻度変更で動作不安定
**対策**: フォールバック処理を実装、エラーハンドリングを強化

### リスク2: GPS精度低下で位置取得失敗
**対策**: maximumAgeを適切に設定（30秒）、ユーザーに通知

### リスク3: AR FPS低下で体験が悪化
**対策**: 15fpsで十分滑らか、必要に応じて調整可能

---

## 📊 期待される成果

| 項目 | 改善前 | 改善後 | 削減率 |
|------|--------|--------|--------|
| GPS更新 | 高精度・常時 | 通常精度・30秒キャッシュ | -40% |
| センサー | 30Hz固定 | 10-20Hz可変 | -35% |
| AR描画 | 30fps | 15fps | -50% |
| Sonar音 | 頻繁 | 削減 | -60% |
| **合計** | - | - | **-30〜40%** |

---

## 📅 作業スケジュール

1. **Phase 1-2**: 30分（設定ファイル、app.js）
2. **Phase 3**: 20分（orientation-manager.js）
3. **Phase 4**: 20分（view-ar.js）
4. **Phase 5**: 15分（view-sonar.js）
5. **Phase 6**: 10分（index.html）
6. **テスト**: 30分

**合計**: 約2時間

---

## 🔧 作業後の確認事項

- [ ] 全ファイルがUTF-8で保存されている
- [ ] 文字化けがない
- [ ] 既存機能が正常動作
- [ ] 新機能が正常動作
- [ ] LocalStorageの読み書きが正常
- [ ] エラーハンドリングが適切

---

**END OF PLAN**
