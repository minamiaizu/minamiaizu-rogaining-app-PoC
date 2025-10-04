const CACHE_NAME = 'rogaining-v1';
const MAP_CACHE_NAME = 'rogaining-map-tiles-v1';
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

// メッセージハンドラー（地図キャッシュ制御用）
self.addEventListener('message', async (event) => {
  if (event.data.type === 'CACHE_MAP_TILES') {
    await downloadAndCacheTiles(event.data.tiles, event.source);
  } else if (event.data.type === 'CLEAR_MAP_CACHE') {
    await caches.delete(MAP_CACHE_NAME);
    event.source.postMessage({ type: 'CACHE_CLEARED' });
  } else if (event.data.type === 'GET_CACHE_INFO') {
    const info = await getMapCacheInfo();
    event.source.postMessage({ 
      type: 'CACHE_INFO',
      tileCount: info.tileCount,
      cacheSize: info.cacheSize
    });
  }
});

/**
 * 地図タイルのダウンロード＆キャッシュ
 */
async function downloadAndCacheTiles(tiles, client) {
  const cache = await caches.open(MAP_CACHE_NAME);
  const total = tiles.length;
  let completed = 0;
  let succeeded = 0;
  
  // 並列ダウンロード（5件ずつ）
  const BATCH_SIZE = 5;
  
  for (let i = 0; i < tiles.length; i += BATCH_SIZE) {
    const batch = tiles.slice(i, i + BATCH_SIZE);
    
    await Promise.all(batch.map(async (tile) => {
      const url = `https://a.tile.openstreetmap.org/${tile.z}/${tile.x}/${tile.y}.png`;
      
      try {
        const response = await fetch(url);
        if (response.ok) {
          await cache.put(url, response);
          succeeded++;
        }
      } catch (error) {
        console.error(`タイルDL失敗: ${url}`, error);
      }
      
      completed++;
      
      // プログレス送信（10件ごと、または完了時）
      if (completed % 10 === 0 || completed === total) {
        client.postMessage({
          type: 'CACHE_PROGRESS',
          current: completed,
          total: total
        });
      }
    }));
  }
  
  client.postMessage({
    type: 'CACHE_COMPLETE',
    total: succeeded,
    failed: total - succeeded
  });
}

/**
 * キャッシュ情報取得
 */
async function getMapCacheInfo() {
  try {
    const cache = await caches.open(MAP_CACHE_NAME);
    const keys = await cache.keys();
    
    // OpenStreetMapタイルのみカウント
    const tileKeys = keys.filter(req => 
      req.url.includes('tile.openstreetmap.org')
    );
    
    return {
      tileCount: tileKeys.length,
      cacheSize: 0 // サイズ計算は複雑なので省略
    };
  } catch (error) {
    console.error('キャッシュ情報取得エラー:', error);
    return {
      tileCount: 0,
      cacheSize: 0
    };
  }
}

// フェッチイベント - ネットワーク優先、フォールバックでキャッシュ
self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  
  // OpenStreetMapタイルの場合
  if (url.includes('tile.openstreetmap.org')) {
    event.respondWith(
      caches.match(event.request)
        .then(cachedResponse => {
          if (cachedResponse) {
            // キャッシュヒット
            return cachedResponse;
          }
          
          // キャッシュになければネットワークから取得
          return fetch(event.request)
            .then(response => {
              // 成功時はキャッシュに追加
              if (response && response.status === 200) {
                const responseToCache = response.clone();
                caches.open(MAP_CACHE_NAME)
                  .then(cache => cache.put(event.request, responseToCache));
              }
              return response;
            })
            .catch(() => {
              // オフライン時のフォールバック
              return new Response(
                '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#f0f0f0"/><text x="128" y="128" text-anchor="middle" font-size="16" fill="#999">オフライン</text></svg>',
                { headers: { 'Content-Type': 'image/svg+xml' } }
              );
            });
        })
    );
  } else {
    // 通常のfetch処理（その他のリソース）
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
              
              return new Response('オフラインのため利用できません', {
                status: 503,
                statusText: 'Service Unavailable',
                headers: { 'Content-Type': 'text/plain' }
              });
            });
        })
    );
  }
});

// アクティベート時の古いキャッシュ削除
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // 現在のキャッシュ名以外は削除
          if (cacheName !== CACHE_NAME && cacheName !== MAP_CACHE_NAME) {
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
