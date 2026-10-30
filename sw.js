// 入荷チェック service worker
// 更新したら CACHE の番号を上げてください（例: v2）。次回起動時に新しいファイルへ切り替わります。
const CACHE = "nyuka-check-v7";
// ライブラリ用（アプリ更新では消さない。ライブラリを入れ替えたときだけ番号を上げる）
const VENDOR_CACHE = "nyuka-vendor-1";
const FILES = [
  "./", "./index.html", "./style.css?v=1.6.0", "./app.js?v=1.6.0", "./manifest.webmanifest",
  "./vendor/zxing-0.21.3.min.js", "./vendor/tesseract/tesseract.min.js",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png", "./icons/apple-touch-icon.png"
];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== VENDOR_CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// vendor/ 以下（ライブラリ・文字認識データ）はキャッシュ優先、それ以外はネット優先
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if(e.request.method !== "GET" || url.origin !== location.origin) return;
  if(url.pathname.includes("/vendor/")){
    e.respondWith(caches.match(e.request, {ignoreSearch:true}).then(hit => hit || fetch(e.request).then(res => {
      if(res.ok){ const copy = res.clone(); caches.open(VENDOR_CACHE).then(c => c.put(e.request, copy)); }
      return res;
    })));
    return;
  }
  e.respondWith(
    fetch(e.request, {cache: "no-cache"}).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match("./index.html")))
  );
});
