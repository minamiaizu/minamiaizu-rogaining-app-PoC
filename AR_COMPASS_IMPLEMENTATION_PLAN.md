# ARコンパス実装計画書

## 1. 概要

### 1.1 プロジェクト背景
既存のロゲイニングPoCアプリに、カメラ映像を活用したARコンパス機能を追加する。これにより、ユーザーはデバイスをかざすだけで直感的にチェックポイントの位置を確認できる。

### 1.2 主要目標
- リアルタイムカメラ映像上にチェックポイント情報をオーバーレイ表示
- 標高差を考慮した3次元的な位置表示
- バッテリー消費を抑えた実用的な実装

## 2. 機能要件

### 2.1 コア機能

#### 必須機能（MVP）
1. **カメラビュー表示**
   - WebRTC getUserMedia APIによるリアルタイム映像取得
   - 背面カメラ（environment）の使用
   - 解像度: 1280x720（理想値）

2. **チェックポイントのAR表示**
   - 視野内のチェックポイントをマーカーとして表示
   - ポイント数、名称、距離、標高差の表示
   - クリア済み/未クリアの視覚的区別

3. **距離レンジ切替**
   - 5段階切替: 250m / 500m / 1km / 2.5km / 5km
   - ワンタップで切替可能なボタンUI

4. **自動タイムアウト機能**
   - 5分間のタイマー設定
   - 残り時間の視覚的表示
   - タイムアウト時は通常コンパスモードへ自動切替

5. **標高差表示**
   - チェックポイントの標高データ（事前設定）
   - 現在地との標高差計算
   - 上向き/下向き矢印での方向表示

### 2.2 削除・簡素化する機能
- リアルタイム3D地形マッピング
- 複雑な画像認識処理
- 過度なアニメーション効果
- リアルタイム標高データ取得

## 3. 技術設計

### 3.1 アーキテクチャ

```
┌─────────────────────────────────┐
│      ユーザーインターフェース      │
├─────────────────────────────────┤
│  ARレンダリング層（Canvas）       │
├─────────────────────────────────┤
│  位置計算・座標変換層            │
├─────────────────────────────────┤
│  センサーデータ統合層            │
│  - カメラ（WebRTC）             │
│  - GPS（Geolocation）           │
│  - コンパス（DeviceOrientation） │
│  - 傾き（DeviceMotion）         │
└─────────────────────────────────┘
```

### 3.2 使用API・技術

#### Webブラウザ API
- **MediaDevices.getUserMedia()**: カメラアクセス
- **DeviceOrientationEvent**: 方位データ取得
- **DeviceMotionEvent**: デバイス傾き検出
- **Geolocation API**: 現在位置取得
- **Canvas API**: AR描画処理
- **requestAnimationFrame()**: 描画最適化

#### 座標系と計算
```javascript
// 方位計算
bearing = atan2(sin(Δλ) * cos(φ2), 
               cos(φ1) * sin(φ2) - sin(φ1) * cos(φ2) * cos(Δλ))

// 仰角計算（標高差考慮）
elevationAngle = atan2(elevationDiff, horizontalDistance)

// 画面座標変換
screenX = centerX + (relativeBearing / FOV_H) * canvasWidth
screenY = centerY - (elevationAngle / FOV_V) * canvasHeight
```

### 3.3 データ構造

#### チェックポイントデータ
```javascript
const checkpoint = {
    id: 1,
    name: "会津田島駅",
    lat: 37.20329853,
    lng: 139.77424063,
    elevation: 650,  // 標高（メートル）
    points: 10       // 獲得ポイント
}
```

#### ARマーカー状態
```javascript
const markerState = {
    visible: boolean,      // 視野内判定
    screenX: number,       // 画面X座標
    screenY: number,       // 画面Y座標
    distance: number,      // 距離（メートル）
    bearing: number,       // 方位（度）
    elevationAngle: number // 仰角（度）
}
```

## 4. UI/UX設計

### 4.1 画面レイアウト

```
┌─────────────────────────────────┐
│ ← W  270° 280° 290° N →        │ ← ヘディングテープ
├─────────────────────────────────┤
│                                 │
│       [カメラビュー]             │
│            ●                    │ ← ARマーカー
│         駅前広場                 │
│        ↑250m +30m               │ ← 距離と標高差
│                                 │
├─────────────────────────────────┤
│ [250m][500m][1km][2.5km][5km]  │ ← レンジ切替
│        残り: 4:32               │ ← タイマー
└─────────────────────────────────┘
```

### 4.2 視覚デザイン仕様

#### カラーパレット
- チェックポイント（未クリア）: `#667eea` (紫)
- チェックポイント（クリア済）: `#48bb78` (緑)
- 警告・エラー: `#e53e3e` (赤)
- 情報テキスト: `#ffffff` (白)
- 背景オーバーレイ: `rgba(0,0,0,0.3)`

#### マーカーサイズ
| レンジ | マーカー直径 | フォントサイズ |
|--------|------------|---------------|
| 250m   | 50px       | 16px          |
| 500m   | 50px       | 16px          |
| 1km    | 40px       | 14px          |
| 2.5km  | 30px       | 12px          |
| 5km    | 30px       | 12px          |

### 4.3 インタラクション

#### タップ操作
- ARマーカータップ: 詳細情報を一時表示
- レンジボタンタップ: 表示範囲切替
- 画面長押し: カメラフォーカスリセット

#### 自動動作
- デバイス向き変更: リアルタイム追従
- 5分経過: 自動的に通常コンパスモードへ

## 5. パフォーマンス最適化

### 5.1 描画最適化
```javascript
// フレームレート制限
const FPS_LIMIT = 30;
let lastFrameTime = 0;

function updateARDisplay(currentTime) {
    if (currentTime - lastFrameTime < 1000 / FPS_LIMIT) {
        requestAnimationFrame(updateARDisplay);
        return;
    }
    // 描画処理
    drawARMarkers();
    lastFrameTime = currentTime;
    requestAnimationFrame(updateARDisplay);
}
```

### 5.2 計算量削減
- レンジ外のチェックポイントは計算スキップ
- 視野外判定の早期リターン
- 距離計算結果のキャッシュ（1秒間）

### 5.3 バッテリー節約戦略

#### 段階的機能制限
| 経過時間 | カメラ解像度 | FPS | 機能制限 |
|---------|------------|-----|---------|
| 0-3分   | 1280x720   | 30  | なし     |
| 3-4分   | 640x480    | 15  | 簡易表示 |
| 4-5分   | 640x480    | 15  | 警告表示 |
| 5分以降 | 停止        | -   | 自動終了 |

## 6. エラー処理とフォールバック

### 6.1 権限エラー処理

#### カメラ権限拒否
```javascript
if (!cameraPermission) {
    alert('カメラの使用許可が必要です');
    switchToCompassMode();
}
```

#### センサー権限拒否
```javascript
if (!orientationPermission) {
    showWarning('方位情報が取得できません');
    showStaticMarkers(); // 静的表示にフォールバック
}
```

### 6.2 デバイス非対応

#### 必須機能チェック
```javascript
const isARSupported = () => {
    return 'mediaDevices' in navigator &&
           'getUserMedia' in navigator.mediaDevices &&
           'DeviceOrientationEvent' in window;
};
```

## 7. 実装優先順位

### フェーズ1（必須 - 1週間）
- [x] 基本的なカメラビュー実装
- [x] シンプルな方向表示
- [x] レンジ切替機能
- [x] タブ切替UI

### フェーズ2（推奨 - 1週間）
- [x] 標高差表示
- [x] 5分タイマー実装
- [x] マーカータップで詳細表示
- [ ] パフォーマンス最適化

### フェーズ3（オプション - 追加1週間）
- [ ] 滑らかなアニメーション
- [ ] 視野外インジケーター改善
- [ ] カスタマイズ設定
- [ ] 音声フィードバック

## 8. テスト計画

### 8.1 機能テスト
- [ ] カメラ起動・停止
- [ ] 各レンジでの表示確認
- [ ] タイマー動作確認
- [ ] タブ切替動作

### 8.2 互換性テスト
- [ ] iOS Safari 14.5+
- [ ] Android Chrome 90+
- [ ] PWAモード動作確認

### 8.3 パフォーマンステスト
- [ ] バッテリー消費測定（5分間）
- [ ] メモリ使用量確認
- [ ] フレームレート計測

## 9. 既知の制限事項

### 技術的制限
- GPS高度の精度が低い（±10-50m）
- 磁気センサーの精度がデバイス依存
- iOS Safariでの初回許可要求が必要

### 実装上の制限
- 完全な3D地形認識は不可
- 建物・障害物の考慮なし
- オフライン時の地図タイル非表示

## 10. 将来の拡張可能性

### 短期的改善案
- WebXR API対応（より高度なAR体験）
- 機械学習による画像認識統合
- 複数ユーザー間での位置共有

### 長期的展望
- ネイティブアプリ化（React Native）
- 3D地形データ統合
- リアルタイムマルチプレイヤー機能

## 付録A: 参考実装コード

### A.1 視野内判定
```javascript
function isInView(relativeBearing, elevationAngle) {
    const FOV_H = 60;  // 水平視野角
    const FOV_V = 45;  // 垂直視野角
    
    return Math.abs(relativeBearing) < FOV_H / 2 &&
           Math.abs(elevationAngle) < FOV_V / 2;
}
```

### A.2 距離による色分け
```javascript
function getDistanceColor(distance, min, max) {
    const normalized = (distance - min) / (max - min);
    const hue = normalized <= 0.5 
        ? 240 - (120 * normalized * 2)  // 青→緑
        : 120 - (120 * (normalized - 0.5) * 2); // 緑→赤
    return `hsl(${hue}, 80%, 50%)`;
}
```

## 付録B: トラブルシューティング

| 問題 | 原因 | 解決方法 |
|------|------|---------|
| ARタブが表示されない | センサー非対応 | デバイスの互換性確認 |
| カメラが起動しない | HTTPS必須 | HTTPS接続で再試行 |
| 方位がずれる | 磁気干渉 | 8の字キャリブレーション |
| マーカーが表示されない | GPS未取得 | 現在地取得を先に実行 |

---

*最終更新: 2024年10月*
*バージョン: 1.0.0*
