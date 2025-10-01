# ロゲイニング PoC - PWA完全対応版

## ファイル概要

**rogaining-poc-pwa.html** - 完全なPWA対応版（2089行）

このファイルは元の rogaining-poc.html に以下のPWA機能を追加した完全版です：

## 追加された機能

### 1. PWAメタデータ
- アプリの説明、テーマカラー
- iOS対応のメタタグ
- manifest.json へのリンク
- アップルタッチアイコン

### 2. インストールバナー
- ホーム画面追加を促すバナー表示
- インストールボタン
- 閉じるボタン
- スライドアップアニメーション

### 3. Service Worker対応
- 自動登録機能
- オンライン/オフライン状態の監視
- キャッシュ管理

### 4. PWA状態表示
- インストール済み/ブラウザモードの表示
- リアルタイム状態更新

### 5. オフライン機能
- ネットワークなしでも動作
- LocalStorageによるデータ永続化
- 写真・軌跡データの保存

## 必要なファイル

このPWAを完全に動作させるには、以下のファイルが必要です：

```
your-app-folder/
├── rogaining-poc-pwa.html     ← メインファイル
├── manifest.json              ← アプリメタデータ
├── service-worker.js          ← Service Worker
├── icon-192.png              ← 192×192アイコン
└── icon-512.png              ← 512×512アイコン
```

## セットアップ手順

### ステップ1: アイコンを作成

**方法A: icon-generator.html を使用（推奨）**
1. `icon-generator.html` をブラウザで開く
2. アイコンをカスタマイズ
3. 「192×192」と「512×512」ボタンでダウンロード
4. ダウンロードしたファイルを同じフォルダに配置

**方法B: オンラインツール**
1. https://realfavicongenerator.net/ にアクセス
2. 画像をアップロードして生成

### ステップ2: ファイルを配置

すべてのファイルを同じフォルダに配置：
- rogaining-poc-pwa.html
- manifest.json
- service-worker.js
- icon-192.png
- icon-512.png

### ステップ3: ローカルサーバーで起動

```bash
# Pythonを使用
cd your-app-folder
python3 -m http.server 8000

# または Node.js
npx http-server -p 8000
```

### ステップ4: ブラウザで開く

```
http://localhost:8000/rogaining-poc-pwa.html
```

## 動作確認

### PWA機能の確認

1. **Chrome DevTools** (F12)
   - **Application** タブ → **Manifest** でマニフェストを確認
   - **Application** タブ → **Service Workers** でSWを確認

2. **Lighthouse監査**
   - DevTools → **Lighthouse** タブ
   - **Progressive Web App** を選択
   - **Generate report** をクリック

3. **インストール**
   - ブラウザのアドレスバーにインストールアイコンが表示
   - または画面下部のバナーから「インストール」をクリック

### オフライン動作の確認

1. 一度アプリを開く
2. DevTools → **Network** タブ → **Offline** にチェック
3. ページをリロード
4. オフラインでも動作することを確認

## 主な機能

### 地図表示
- OpenStreetMapベース
- チェックポイント表示
- 現在地マーカー
- 軌跡表示

### GPS機能
- 現在地取得
- 自動軌跡記録（60秒間隔）
- 位置精度表示

### チェックポイント管理
- 100m以内で確認可能
- ポイント自動加算
- クリア状態の保存

### 写真撮影
- カメラ連携
- 自動圧縮（1280px, 60%品質）
- LocalStorageに保存
- ギャラリー表示

### コンパス機能
- デバイス方位の取得
- チェックポイント方向表示
- 距離バー表示
- タップでツールチップ

### データ永続化
- LocalStorageによる自動保存
- チェックポイントクリア状態
- 写真データ
- 軌跡ポイント
- タイマー状態

### オフライン対応
- Service Workerによるキャッシュ
- ネットワークなしでも使用可能
- 自動データ同期

## デプロイ方法

### 推奨ホスティングサービス

**Netlify（推奨）**
1. https://www.netlify.com/ にアクセス
2. フォルダをドラッグ&ドロップ
3. 自動的にHTTPS対応のURLが発行される

**Vercel**
1. https://vercel.com/ にアクセス
2. GitHubと連携またはフォルダアップロード
3. 自動デプロイ

**GitHub Pages**
1. GitHubリポジトリを作成
2. ファイルをプッシュ
3. Settings → Pages で有効化

**重要:** PWAはHTTPS環境が必須です（localhostは例外）

## トラブルシューティング

### Service Workerが登録されない
- HTTPSを使用していますか？
- ファイルパスは正しいですか？
- ブラウザのコンソールでエラーを確認

### インストールボタンが表示されない
- manifest.json が正しく読み込まれていますか？
- アイコンファイルは存在しますか？
- Lighthouseで PWA要件をチェック

### キャッシュが更新されない
- Service Workerのバージョン（CACHE_NAME）を変更
- ブラウザのキャッシュをクリア
- DevTools で「Update on reload」にチェック

### GPSが取得できない
- ブラウザの位置情報許可を確認
- HTTPSまたはlocalhostで実行していますか？
- デバイスのGPS設定を確認

### 写真が保存できない
- LocalStorageの容量を確認（通常5-10MB）
- 古い写真を削除
- ブラウザの設定を確認

### コンパスが動作しない
- デバイスに磁気センサーがありますか？
- iOSの場合、初回に許可が必要
- ブラウザがDeviceOrientationEventに対応していますか？

## パフォーマンス最適化

### 写真圧縮設定
デフォルト設定（変更可能）：
- 最大幅: 1280px
- 品質: 60%

さらに圧縮する場合は、`compressImage()` 関数のパラメータを変更：
```javascript
await compressImage(file, 800, 0.5)  // 800px, 50%品質
```

### 軌跡記録間隔
デフォルト: 60秒

変更する場合は、`startTracking()` 関数の `setInterval` を変更：
```javascript
}, 30000); // 30秒に変更
```

## 技術仕様

- **地図ライブラリ**: Leaflet 1.9.4
- **ストレージ**: LocalStorage（最大5-10MB）
- **GPS精度**: 高精度モード（enableHighAccuracy: true）
- **写真圧縮**: Canvas + JPEG（品質60%）
- **軌跡記録**: 60秒間隔
- **チェックポイント範囲**: 100m
- **オフライン対応**: Service Worker + Cache API

## ブラウザ対応

### デスクトップ
- ✅ Chrome 90+
- ✅ Edge 90+
- ✅ Firefox 88+（一部機能制限あり）
- ✅ Safari 14+（iOS向けメタタグで対応強化）

### モバイル
- ✅ Chrome for Android
- ✅ Safari for iOS
- ✅ Samsung Internet

### 必要な機能
- Service Worker
- Geolocation API
- DeviceOrientation API（コンパス用）
- LocalStorage
- FileReader API（写真用）

## 今後の拡張案

### 高度なオフライン機能
- IndexedDBを使った大容量データ保存
- バックグラウンド同期
- 地図タイルの事前キャッシュ

### ソーシャル機能
- チーム対戦モード
- リアルタイム位置共有
- チャット機能
- ランキング

### データ分析
- 移動距離の計算
- 平均速度の表示
- ヒートマップ
- 統計グラフ

### エクスポート機能
- GPX形式での軌跡エクスポート
- 写真付きレポート生成
- CSV形式のデータ出力

### プッシュ通知
- チェックポイント接近通知
- 残り時間通知
- チームメッセージ

## ライセンス

このアプリは以下のオープンソースライブラリを使用しています：
- Leaflet (BSD 2-Clause License)
- OpenStreetMap (ODbL)

## サポート

問題が発生した場合：
1. ブラウザのコンソールでエラーを確認
2. DevToolsのApplicationタブでPWA状態を確認
3. Lighthouse監査を実行
