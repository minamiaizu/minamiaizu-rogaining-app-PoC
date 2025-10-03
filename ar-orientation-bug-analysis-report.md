# ARビュー方位反転問題 - 詳細分析レポート

**プロジェクト**: ロゲイニング PoC - PWA対応版  
**日付**: 2025年1月  
**ステータス**: 暫定修正完了、根本解決推奨

---

## 📋 エグゼクティブサマリー

ARビューにおいて、南北軸は正常だが東西軸が180°反転する問題が発生。調査の結果、`OrientationManager`が返す角度値が**数学的慣例（反時計回り）**であったのに対し、ARビューでは**コンパス慣例（時計回り）**を前提とした実装になっていたことが原因と判明。暫定的にARビュー側で変換処理を追加し正常動作を確認。今後は`OrientationManager`でコンパス方位を返すよう修正し、全ビューで統一的な実装にすることを推奨。

---

## 🔍 問題の症状

### 初期報告

**現象**: ARビューにおける方位表示の異常

| デバイスの実際の向き | 期待される表示 | 実際の表示 | 判定 |
|-----------------|------------|----------|------|
| 北（0°） | N | N | ✅ 正常 |
| 東（90°） | E | **W** | ❌ 異常 |
| 南（180°） | S | S | ✅ 正常 |
| 西（270°） | W | **E** | ❌ 異常 |

### 重要な観察

- **南北軸は正常**: 北と南は正しく表示される
- **東西軸が反転**: 東西が入れ替わる
- **他のビューは正常**: コンパスビュー、ソナービューでは方位が正しい

---

## 🕵️ 調査プロセス

### Phase 1: 初期仮説（誤り）

**仮説1-1**: view-ar.jsのスクリーン座標計算の符号が逆

```javascript
// 試した修正（効果なし）
const x = w/2 - normalizedOffset * w;  // 符号を反転
const x = w/2 - (relRad / this.options.fovH) * w;  // 符号を反転
```

**結果**: 修正しても問題は解決せず

---

**仮説1-2**: orientation-manager.jsのquaternionToEulerの座標系が逆

```javascript
// 試した修正（誤り）
return {
  yaw: (360 - yaw) % 360,  // コンパス方位への変換を試みた
  pitch: beta,
  roll: gamma
};
```

**結果**: この修正により、逆に全方位が反転してしまう

---

**仮説1-3**: atan2の引数の符号が間違っている

```javascript
// 試した修正（誤り）
const yaw = Math.atan2(
  -2.0 * (w * z + x * y),  // y成分の符号を反転
  1.0 - 2.0 * (y * y + z * z)
) * 180 / Math.PI;
```

**矛盾の発見**: この修正ではコンパスビューとソナービューも壊れてしまう

---

### Phase 2: 決定的な発見

**重要な質問**: 「orientation-manager.jsが正しいとわかったのは収穫です」

この指摘により、**orientation-manager.jsは正しく、view-ar.jsに問題がある**という方向に調査を転換。

---

**決定的な実測**:

```
デバイスを東に向ける → heading = 270°
```

**期待値**: heading = 90°（コンパス方位）  
**実測値**: heading = 270°（反時計回り角度）

### 真の原因の特定

**発見事実**:
1. `orientationManager.getHeading()`は**反時計回り角度**を返す（数学的慣例）
2. コンパス方位は**時計回り**で定義される（北=0°, 東=90°, 南=180°, 西=270°）
3. 変換式: `コンパス方位 = (360 - 反時計回り角度) % 360`

| 反時計回り角度 | コンパス方位 | 方位名 |
|-------------|-----------|-------|
| 0° | 0° | 北 |
| 270° | 90° | 東 |
| 180° | 180° | 南 |
| 90° | 270° | 西 |

---

### Phase 3: なぜ他のビューは正常なのか？

**コンパスビューの実装**:
```javascript
this.compassCircle.style.transform = `rotate(${heading}deg)`;
```

- heading = 270° → DOM要素を**時計回りに**270°回転
- これは**反時計回りに90°回転**と等価
- 結果として、デバイスが東を向くと北が左側に来る → **正しい表示！**

**ソナービューの実装**:
```javascript
ctx.rotate(heading * Math.PI / 180);
```

- Canvas全体を270°回転
- 同様に**偶然正しく動作**

**ARビューの実装**:
```javascript
// Canvas回転を使わず、直接スクリーン座標を計算
const angle = (heading + offset) % 360;
const x = w/2 + normalizedOffset * w;
```

- Canvas回転がないため、**直接的な座標変換が必要**
- heading値の意味（反時計回り vs コンパス）が重要になる

---

## 💡 根本原因

### アーキテクチャ上の矛盾

```
OrientationManager
  ↓ 反時計回り角度（数学的慣例）を返す
  
コンパス/ソナー
  → Canvas全体を回転
  → 270°時計回り回転 = 90°反時計回り回転
  → 「偶然」正しく動作 ⚠️

ARビュー
  → Canvas回転なし、直接座標計算
  → heading値をそのまま使用
  → 東西が反転 ❌
```

### 問題の本質

**データの意味が不明確**:
- `getHeading()`が返す値が何を表すのか明示されていない
- ビューごとに異なる前提で実装されている
- Canvas回転の「副作用」に暗黙的に依存している

---

## ✅ 暫定修正（実装済み）

### 修正内容

**ファイル**: `view-ar.js`

#### 1. _drawCompassTape メソッド

```javascript
_drawCompassTape(ctx, w, h) {
  // ...
  
  const rawHeading = this.orientationMgr?.getHeading() || 0;
  const heading = (360 - rawHeading) % 360;  // ✅ コンパス方位に変換
  
  // 5度刻みで目盛りを描画
  for (let offset = -displayRange; offset <= displayRange; offset += 5) {
    const angle = (heading + offset + 360) % 360;
    const normalizedOffset = offset / fovHDeg;
    const x = w/2 + normalizedOffset * w;
    // ...
  }
}
```

#### 2. _drawCheckpoints メソッド

```javascript
_drawCheckpoints(ctx, w, h, currentPosition) {
  // ...
  
  checkpoints.forEach(cp => {
    const d = this._getCachedDistance(/* ... */);
    if (d > this.options.range) return;
    
    const b = this.geoMgr?.bearing(/* ... */) || 0;
    const rawHeading = this.orientationMgr?.getHeading() || 0;
    const actualHeading = (360 - rawHeading) % 360;  // ✅ コンパス方位に変換
    let rel = ((b - actualHeading + 540) % 360) - 180;
    
    // スクリーン座標計算
    const relRad = rel * Math.PI / 180;
    const x = w/2 + (relRad / this.options.fovH) * w;
    // ...
  });
}
```

### 検証結果

修正後の動作:

| 実際の向き | rawHeading | heading変換後 | 画面中央の表示 | 判定 |
|-----------|-----------|-------------|-------------|------|
| 北 | 0° | 0° | N | ✅ |
| 東 | 270° | 90° | E | ✅ |
| 南 | 180° | 180° | S | ✅ |
| 西 | 90° | 270° | W | ✅ |

**ステータス**: ✅ 暫定的に正常動作

---

## 🏗️ 根本的な解決策（推奨）

### 設計原則

> **OrientationManagerは常にコンパス方位（時計回り、北=0°, 東=90°）を返すべき**

### 修正方針

**一か所で変換を完結させる**: データソース（OrientationManager）で正しい形式に変換し、各ビューではシンプルに使用する。

---

### 詳細な修正内容

#### ファイル1: orientation-manager.js

##### 修正1: quaternionToEuler メソッド（AbsoluteOrientationSensor用）

```javascript
quaternionToEuler(q) {
  const [x, y, z, w] = q;
  
  // Yaw (方位角) - Z軸周りの回転
  const yaw = Math.atan2(
    2.0 * (w * z + x * y),
    1.0 - 2.0 * (y * y + z * z)
  ) * 180 / Math.PI;
  
  // Beta (前後傾斜)
  const beta = Math.atan2(
    2.0 * (w * x + y * z),
    1.0 - 2.0 * (x * x + y * y)
  ) * 180 / Math.PI;
  
  // Gamma (左右傾斜)
  const sinGamma = 2.0 * (w * y - z * x);
  const gamma = Math.asin(
    Math.max(-1, Math.min(1, sinGamma))
  ) * 180 / Math.PI;
  
  return {
    yaw: (360 - yaw + 360) % 360,  // ✅ コンパス方位に変換
    pitch: beta,
    roll: gamma
  };
}
```

##### 修正2: startIOSOrientation メソッド

```javascript
this.deviceOrientationListener = (e) => {
  if (e.webkitCompassHeading !== undefined) {
    this.currentHeading = e.webkitCompassHeading;  // ✅ 既にコンパス方位
    this.devicePitch = e.beta || 0;
    this.deviceRoll = e.gamma || 0;
    this.confidence = 1.0;
    this.mode = 'ios';
    // ...
  }
};
```

##### 修正3: startAbsoluteSensor メソッド

```javascript
this.absoluteSensor.addEventListener('reading', () => {
  const q = this.absoluteSensor.quaternion;
  const angles = this.quaternionToEuler(q);  // ✅ 既にコンパス方位
  
  this.currentHeading = angles.yaw;
  this.devicePitch = angles.pitch;
  this.deviceRoll = angles.roll;
  this.confidence = 1.0;
  this.mode = 'absolute-sensor';
  // ...
});
```

##### 修正4: startDeviceOrientation メソッド

```javascript
this.deviceOrientationListener = (e) => {
  if (e.alpha === null) return;
  
  const rawHeading = e.alpha;
  
  if (e.absolute === true) {
    // 絶対モード（磁北基準）
    this.currentHeading = (360 - rawHeading) % 360;  // ✅ コンパス方位に変換
    this.devicePitch = e.beta || 0;
    this.deviceRoll = e.gamma || 0;
    this.confidence = 0.8;
    this.mode = 'absolute-event';
  } else {
    // 相対モード
    this.currentHeading = (360 - rawHeading - this.calibrationOffset + 720) % 360;  // ✅ 変換
    this.devicePitch = e.beta || 0;
    this.deviceRoll = e.gamma || 0;
    this.confidence = this.isCalibrated ? 0.6 : 0.3;
    this.mode = this.isCalibrated ? 'relative-calibrated' : 'relative';
  }
  // ...
};
```

---

#### ファイル2: view-compass.js

```javascript
updateHeading(heading) {
  this.currentHeading = heading;
  
  // コンパス円を回転（ジャイロコンパス風：方位盤が回転）
  if (this.compassCircle) {
    const normalizedHeading = ((heading % 360) + 360) % 360;
    this.compassCircle.style.transform = `rotate(${normalizedHeading}deg)`;
  }
  
  // 方位表示を更新
  if (this.headingDisplay) {
    this.headingDisplay.textContent = `方位: ${Math.round(heading)}°`;
  }
}
```

**変更点**: なし（既にコンパス方位を想定した実装）

---

#### ファイル3: view-sonar.js

```javascript
drawSonarDisplay() {
  // ...
  
  ctx.save();
  ctx.translate(cx, cy);
  const heading = this.orientationMgr?.getHeading() || 0;
  ctx.rotate(heading * Math.PI / 180);  // コンパス方位をそのまま使用
  ctx.translate(-cx, -cy);
  
  // 背景
  const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  // ...
}
```

**変更点**: なし（既にコンパス方位を想定した実装）

---

#### ファイル4: view-ar.js

```javascript
_drawCompassTape(ctx, w, h) {
  // ...
  
  const heading = this.orientationMgr?.getHeading() || 0;  // ✅ 既にコンパス方位
  
  // 5度刻みで目盛りを描画
  for (let offset = -displayRange; offset <= displayRange; offset += 5) {
    const angle = (heading + offset + 360) % 360;
    const normalizedOffset = offset / fovHDeg;
    const x = w/2 + normalizedOffset * w;
    // ...
  }
}

_drawCheckpoints(ctx, w, h, currentPosition) {
  // ...
  
  checkpoints.forEach(cp => {
    const d = this._getCachedDistance(/* ... */);
    if (d > this.options.range) return;
    
    const b = this.geoMgr?.bearing(/* ... */) || 0;
    const actualHeading = this.orientationMgr?.getHeading() || 0;  // ✅ 既にコンパス方位
    let rel = ((b - actualHeading + 540) % 360) - 180;
    
    // スクリーン座標計算
    const relRad = rel * Math.PI / 180;
    const x = w/2 + (relRad / this.options.fovH) * w;
    // ...
  });
}
```

**変更点**: `(360 - rawHeading) % 360`の変換を削除

---

## 📊 修正前後の比較

| 項目 | 暫定修正 | 根本解決 |
|-----|---------|---------|
| **OrientationManager** | 反時計回り角度を返す | ✅ コンパス方位を返す |
| **コンパスビュー** | Canvas回転で偶然動作 | ✅ 明確にコンパス方位を使用 |
| **ソナービュー** | Canvas回転で偶然動作 | ✅ 明確にコンパス方位を使用 |
| **ARビュー** | 個別に変換処理を追加 | ✅ 変換不要、そのまま使用 |
| **データの意味** | 不明確 | ✅ 明確（コンパス方位） |
| **保守性** | 低い | ✅ 高い |
| **拡張性** | 低い | ✅ 高い（新ビュー追加が容易） |
| **テスト容易性** | 低い | ✅ 高い（データの意味が明確） |

---

## 🎯 推奨アクション

### Phase 1: 暫定対応（完了✅）

- [x] ARビューで個別に変換処理を追加
- [x] 動作確認
- [x] 問題分析レポート作成

### Phase 2: 根本解決（推奨）

- [ ] `orientation-manager.js`を修正してコンパス方位を返す
- [ ] 各ビューから個別変換を削除
- [ ] 全ビューで動作確認
- [ ] ユニットテスト追加

### Phase 3: 長期改善

- [ ] データ契約の明文化（JSDoc追加）
- [ ] 型定義の追加（TypeScriptへの移行検討）
- [ ] 統合テストの追加

---

## 📝 学んだ教訓

### 1. データの意味を明確にする

**問題**: `getHeading()`が何を返すのか明示されていなかった

**教訓**: APIが返すデータの意味（単位、座標系、慣例）を明確にドキュメント化する

```javascript
/**
 * 現在のデバイスの方位角を取得
 * @returns {number} コンパス方位（時計回り、0°=北、90°=東、180°=南、270°=西）
 */
getHeading() {
  return this.smoothedHeading;
}
```

### 2. 「偶然動く」コードは技術的負債

**問題**: コンパスとソナーが「Canvas回転の副作用」で偶然動作していた

**教訓**: 
- 動作原理を理解せずに実装しない
- 「なぜ動くのか」を説明できない実装は危険信号
- コードレビューで意図を明確にする

### 3. 実測データの重要性

**問題**: 仮説に基づいた修正を繰り返し、時間を浪費した

**教訓**:
- 早期に実測データを取得する
- デバッグモードを実装し、内部状態を可視化する
- 「東を向くとheading=270°」という決定的な発見

### 4. 矛盾に気づく重要性

**問題**: 「orientation-manager.jsの修正」と「他のビューが正常」が矛盾

**教訓**:
- 矛盾する事実は重要な手がかり
- 一つの修正が全体に影響しない場合、前提を疑う
- 「orientation-manager.jsが正しいとわかったのは収穫」という指摘が転機

---

## 🔧 実装チェックリスト

### 根本解決の実装時

#### orientation-manager.js

- [ ] `quaternionToEuler`で`(360 - yaw + 360) % 360`変換を追加
- [ ] `startDeviceOrientation`で`(360 - rawHeading) % 360`変換を追加
- [ ] 相対モードのキャリブレーションオフセット計算も修正
- [ ] 全センサーモード（ios, absolute-sensor, absolute-event, relative）で動作確認

#### view-compass.js

- [ ] `updateHeading`が既にコンパス方位を想定していることを確認
- [ ] コメントでコンパス方位を使用していることを明記
- [ ] 動作確認

#### view-sonar.js

- [ ] `drawSonarDisplay`が既にコンパス方位を想定していることを確認
- [ ] コメントでコンパス方位を使用していることを明記
- [ ] 動作確認

#### view-ar.js

- [ ] `_drawCompassTape`から`(360 - rawHeading) % 360`変換を削除
- [ ] `_drawCheckpoints`から`(360 - rawHeading) % 360`変換を削除
- [ ] コメントでコンパス方位を使用していることを明記
- [ ] 動作確認（北・東・南・西すべて）

#### app.js

- [ ] `handleOrientationUpdate`でheading値が正しく渡されることを確認
- [ ] デバッグログで各ビューでのheading値を確認

---

## 🧪 テストシナリオ

### 手動テスト

#### テスト1: 基本方位確認（全ビュー）

| ビュー | デバイスの向き | 期待される表示 | 結果 |
|--------|-------------|-------------|------|
| コンパス | 北 | 方位: 0°, 円盤上部にN | □ |
| コンパス | 東 | 方位: 90°, 円盤右にE | □ |
| コンパス | 南 | 方位: 180°, 円盤下部にS | □ |
| コンパス | 西 | 方位: 270°, 円盤左にW | □ |
| ソナー | 北 | 上部にN | □ |
| ソナー | 東 | 右にE | □ |
| ソナー | 南 | 下部にS | □ |
| ソナー | 西 | 左にW | □ |
| AR | 北 | 画面中央にN | □ |
| AR | 東 | 画面中央にE | □ |
| AR | 南 | 画面中央にS | □ |
| AR | 西 | 画面中央にW | □ |

#### テスト2: CPの配置確認（ARビュー）

前提: 東に「会津田島駅」がある状況

| デバイスの向き | 期待される動作 | 結果 |
|-------------|-------------|------|
| 北 | 会津田島駅が画面右側に表示 | □ |
| 東 | 会津田島駅が画面中央に表示 | □ |
| 南 | 会津田島駅が画面左側に表示 | □ |
| 西 | 会津田島駅が画面外（範囲外なら非表示） | □ |

#### テスト3: センサーモードの確認

| モード | デバイス | 動作確認 | 結果 |
|--------|---------|---------|------|
| ios | iPhone/iPad | 全ビューで方位正常 | □ |
| absolute-sensor | Android (新) | 全ビューで方位正常 | □ |
| absolute-event | Android (旧) | 全ビューで方位正常 | □ |
| relative-calibrated | PC/その他 | キャリブレーション後、方位正常 | □ |

---

## 📚 参考資料

### Web標準仕様

1. **W3C Device Orientation Event Specification**
   - https://www.w3.org/TR/orientation-event/
   - alpha, beta, gammaの定義

2. **W3C Generic Sensor API**
   - https://www.w3.org/TR/generic-sensor/
   - AbsoluteOrientationSensorの仕様

3. **MDN Web Docs - DeviceOrientationEvent**
   - https://developer.mozilla.org/en-US/docs/Web/API/DeviceOrientationEvent

### 数学的背景

1. **Quaternion to Euler Angles Conversion**
   - https://en.wikipedia.org/wiki/Conversion_between_quaternions_and_Euler_angles

2. **Haversine Formula**
   - 地球上の2点間の距離・方位計算
   - https://en.wikipedia.org/wiki/Haversine_formula

### プロジェクト内ドキュメント

- `orientation-manager.js` - センサー管理
- `geo-manager.js` - 地理情報・距離・方位計算
- `view-compass.js` - コンパスビュー
- `view-sonar.js` - ソナービュー
- `view-ar.js` - ARビュー

---

## 🤝 貢献者

- **問題発見**: ユーザー
- **調査・分析**: Claude (Anthropic)
- **実装**: プロジェクトチーム

---

## 📅 変更履歴

| 日付 | バージョン | 変更内容 |
|------|----------|---------|
| 2025-01 | 1.0 | 初版作成 - 暫定修正完了時点 |

---

## 📧 お問い合わせ

本レポートに関するご質問は、プロジェクトのIssueトラッカーまたはメンテナにお問い合わせください。

---

**END OF REPORT**
