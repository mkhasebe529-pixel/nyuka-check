// 入荷チェック service worker
// 更新したら CACHE の番号を上げてください（例: v2）。次回起動時に新しいファイルへ切り替わります。
const CACHE = "nyuka-check-v1";
const FILES = [
  "./", "./index.html", "./style.css", "./app.js", "./manifest.webmanifest",
  "./vendor/zxing-0.21.3.min.js",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png", "./icons/apple-touch-icon.png"
];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// ネット優先（最新を取得）、圏外ならキャッシュで起動
self.addEventListener("fetch", e => {
  if(e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, {ignoreSearch:true}).then(r => r || caches.match("./index.html")))
  );
});
