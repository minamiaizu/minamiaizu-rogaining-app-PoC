/**
 * Service Worker - オフライン対応
 * 
 * 改修: オフライン時の地図タイルフォールバック改善
 * 改修日: 2025-10-04
 * バージョン: 1.1.0
 */

const CACHE_NAME = 'rogaining-v1';
const urlsToCache = [
  './index.html',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

// インストール時のキャッシュ処理
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('キャッシュを開きました');
        return cache.addAll(urlsToCache);
      })
  );
});

// フェッチイベント - ネットワーク優先、フォールバックでキャッシュ
self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // レスポンスが有効な場合、キャッシュを更新
        if (response && response.status === 200) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME)
            .then((cache) => {
              cache.put(event.request, responseToCache);
            });
        }
        return response;
      })
      .catch(() => {
        // ネットワークエラー時はキャッシュから返す
        return caches.match(event.request)
          .then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            
            // ========== 🔧 改善: OpenStreetMapタイルのフォールバック ==========
            if (event.request.url.includes('tile.openstreetmap.org')) {
              // より視認性の高いSVGプレースホルダーを返す
              const svg = `
                <svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
                  <!-- グレー背景 -->
                  <rect width="256" height="256" fill="#e2e8f0"/>
                  
                  <!-- グリッド線（薄いグレー） -->
                  <line x1="0" y1="128" x2="256" y2="128" stroke="#cbd5e0" stroke-width="1"/>
                  <line x1="128" y1="0" x2="128" y2="256" stroke="#cbd5e0" stroke-width="1"/>
                  
                  <!-- 中央アイコン（地図アイコン） -->
                  <g transform="translate(128, 128)">
                    <circle cx="0" cy="0" r="40" fill="#94a3b8" opacity="0.3"/>
                    <path d="M -20,-10 L -20,10 L 0,20 L 20,10 L 20,-10 L 0,-20 Z" 
                          fill="none" stroke="#64748b" stroke-width="3" stroke-linejoin="round"/>
                    <line x1="-20" y1="-10" x2="20" y2="-10" stroke="#64748b" stroke-width="2"/>
                    <line x1="0" y1="-20" x2="0" y2="20" stroke="#64748b" stroke-width="2"/>
                  </g>
                  
                  <!-- オフラインテキスト -->
                  <text x="128" y="195" 
                        text-anchor="middle" 
                        font-family="system-ui, -apple-system, sans-serif" 
                        font-size="14" 
                        font-weight="600"
                        fill="#64748b">
                    オフライン
                  </text>
                </svg>
              `;
              
              return new Response(svg, {
                headers: { 
                  'Content-Type': 'image/svg+xml',
                  'Cache-Control': 'no-cache'
                }
              });
            }
            
            return new Response('オフラインのため利用できません', {
              status: 503,
              statusText: 'Service Unavailable',
              headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            });
          });
      })
  );
});

// アクティベート時の古いキャッシュ削除
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('古いキャッシュを削除:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// バックグラウンド同期（将来の拡張用）
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-checkpoints') {
    event.waitUntil(syncCheckpoints());
  }
});

async function syncCheckpoints() {
  // チェックポイントデータの同期処理（必要に応じて実装）
  console.log('バックグラウンド同期を実行');
}
