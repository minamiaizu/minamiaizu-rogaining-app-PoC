# ロゲイニングアプリ 修正内容

## 修正日時
2025-01-09

## 修正された問題

### 問題1: 360度と0度の境界でコンパスが暴れる
**原因:**
- 角度の正規化が不完全で、previousHeadingと実際のCSS transform値が乖離していた
- 360度跨ぎ時の差分計算は正しかったが、累積値の管理が不適切だった

**修正内容:**
1. `normalizeAngle(angle)` 関数を追加 - 角度を常に0-360の範囲に正規化
2. `smoothHeading` 変数を追加 - CSS transformに適用する累積角度として管理
3. `updateCompassDisplay()` 関数を完全に書き換え
   - currentHeadingを正規化
   - 最短経路で回転する差分を計算（180度を超える場合は反対方向を選択）
   - smoothHeadingを累積更新（360度を超えても問題なし）
   - previousHeadingを更新

**技術的な改善:**
```javascript
// 修正前
let smoothHeading = previousHeading + diff;
previousHeading = targetHeading;  // 正規化なし

// 修正後
currentHeading = normalizeAngle(currentHeading);  // 0-360に正規化
let diff = currentHeading - previousHeading;
if (diff > 180) diff -= 360;
else if (diff < -180) diff += 360;
smoothHeading += diff;  // 累積（360度を超えてもOK）
previousHeading = currentHeading;
```

### 問題2: 文字盤の中心とポイントの中心がずれる
**原因:**
- Canvas座標系（固定500x500）と実際の表示サイズが不一致
- offsetWidthによる整数丸めとCSSのmin()計算結果の微妙な差
- 画面リサイズ時にCanvasが再描画されない

**修正内容:**
1. `resizeCompassCanvas()` 関数を追加
   - 実際の表示サイズを`getBoundingClientRect()`で取得
   - Canvas内部解像度を動的に設定
   - 目盛りを自動的に再描画

2. `drawCompassTicks()` を動的サイズに対応
   - Canvasサイズが0の場合は500x500で初期化
   - 中心点と半径を動的に計算

3. 画面リサイズ時の処理を追加
   - window.resizeイベントでCanvasを再サイズ
   - デバウンス処理（100ms）で過剰な再描画を防止

4. `updateCheckpointMarkers()` のサイズ取得を改善
   - `offsetWidth`から`getBoundingClientRect().width`に変更
   - より正確な実際の表示サイズを取得

5. `switchTab()` でコンパスタブ切替時にCanvasをリサイズ
   - タブ切替後10msでリサイズ（DOMの更新を待つ）

## 追加された関数

1. **normalizeAngle(angle)** - 角度を0-360度の範囲に正規化
2. **resizeCompassCanvas()** - Canvasを動的にリサイズして再描画

## 変更されたグローバル変数

- `smoothHeading` を追加（累積回転角度）

## テスト推奨項目

1. ✓ 北（0度/360度）付近での回転がスムーズか
2. ✓ 359度→0度、0度→359度の切り替わりが自然か
3. ✓ 画面リサイズ時に目盛りとマーカーがずれないか
4. ✓ コンパスタブとマップタブの切り替えが正常か
5. ✓ モバイルデバイスでの表示が適切か

## 互換性

- 既存のLocalStorageデータと完全互換
- すべての既存機能を保持
- Service WorkerとPWA機能は変更なし
