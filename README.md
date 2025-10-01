# ロゲイニングアプリ PWA化ガイド

## 概要
このガイドでは、ロゲイニングアプリをPWA(Progressive Web App)に変換する手順を説明します。

## 必要なファイル

### 1. manifest.json
アプリのメタデータを定義します。
- アプリ名、アイコン、テーマカラーなど
- インストール可能なアプリとして認識されるために必要

### 2. service-worker.js
オフライン機能を提供します。
- キャッシュ管理
- ネットワークリクエストのインターセプト
- オフライン時のフォールバック

### 3. アイコン画像
以下のサイズのアイコンが必要です:
- **icon-192.png** (192x192px)
- **icon-512.png** (512x512px)

## HTMLに追加する要素

### headセクションに追加

```html
<!-- PWA メタタグ -->
<meta name="description" content="オフライン対応のロゲイニング競技支援アプリ">
<meta name="theme-color" content="#667eea">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="ロゲイニング">

<!-- マニフェスト -->
<link rel="manifest" href="manifest.json">

<!-- iOS用アイコン -->
<link rel="apple-touch-icon" href="icon-192.png">
```

### scriptセクションに追加

```javascript
// Service Worker登録
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js')
            .then((registration) => {
                console.log('SW registered: ', registration);
            })
            .catch((error) => {
                console.log('SW registration failed: ', error);
            });
    });
}

// PWAインストールプロンプト
let deferredPrompt;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    // インストールボタンを表示
    showInstallButton();
});

// インストールボタンクリック時
async function installPWA() {
    if (!deferredPrompt) return;
    
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    
    console.log(`User response: ${outcome}`);
    deferredPrompt = null;
}
```

## アイコン生成方法

### オンラインツールを使用
1. **Favicon Generator** (https://realfavicongenerator.net/)
   - 元画像をアップロード
   - PWA用の設定を選択
   - 必要なサイズのアイコンを自動生成

2. **PWA Asset Generator**
   ```bash
   npm install -g pwa-asset-generator
   pwa-asset-generator source-image.png ./icons
   ```

### 画像編集ソフトで手動作成
- GIMP、Photoshop、Figmaなどで以下のサイズを作成:
  - 192x192px (icon-192.png)
  - 512x512px (icon-512.png)
- 透過PNG形式で保存

## デプロイ要件

### HTTPS必須
PWAはHTTPS環境でのみ動作します:
- ローカル開発: `localhost` は例外的にHTTPでも動作
- 本番環境: 必ずHTTPSを使用

### 推奨ホスティングサービス
- **Netlify** (無料、自動HTTPS)
- **Vercel** (無料、自動HTTPS)
- **GitHub Pages** (無料、HTTPS対応)
- **Firebase Hosting** (無料プランあり)

## テスト方法

### 1. ローカルサーバーで起動
```bash
# Pythonを使用
python3 -m http.server 8000

# Node.jsのhttp-serverを使用
npx http-server -p 8000
```

### 2. ブラウザでアクセス
```
http://localhost:8000/rogaining-pwa.html
```

### 3. DevToolsで確認
Chrome DevTools:
1. F12キーでDevToolsを開く
2. **Application** タブを選択
3. 左側メニューの **Manifest** でマニフェストを確認
4. 左側メニューの **Service Workers** でSWを確認

### 4. Lighthouse監査
1. DevToolsの **Lighthouse** タブを選択
2. **Progressive Web App** を選択
3. **Generate report** をクリック
4. PWA要件のチェックリストを確認

## オフライン機能の確認

### 方法1: DevToolsでオフライン化
1. DevToolsの **Network** タブを開く
2. **Offline** にチェックを入れる
3. ページを再読み込み

### 方法2: 実際にネットワークを切断
1. 機内モードをオン
2. アプリがキャッシュから読み込まれることを確認

## トラブルシューティング

### Service Workerが登録されない
- HTTPSを使用しているか確認
- ファイルパスが正しいか確認
- ブラウザのコンソールでエラーをチェック

### インストールボタンが表示されない
- manifest.jsonが正しく読み込まれているか確認
- アイコンファイルが存在するか確認
- PWA要件を満たしているかLighthouseで確認

### キャッシュが更新されない
- Service Workerのバージョン(CACHE_NAME)を変更
- ブラウザのキャッシュをクリア
- DevToolsで **Update on reload** にチェック

## 追加機能の提案

### 1. バックグラウンド同期
競技データを自動的にサーバーに同期

### 2. プッシュ通知
チェックポイント接近時に通知

### 3. オフラインマップ
事前にタイルをキャッシュして完全オフライン対応

### 4. データエクスポート
GPXファイルとして軌跡をエクスポート

## 参考リンク

- [MDN: Progressive Web Apps](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps)
- [Google: PWA Checklist](https://web.dev/pwa-checklist/)
- [Service Worker Cookbook](https://serviceworke.rs/)
- [Workbox](https://developers.google.com/web/tools/workbox) - Google製のSWライブラリ
