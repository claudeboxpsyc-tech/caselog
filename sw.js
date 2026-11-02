/* Case Log service worker: the app works fully offline. Only the app's own files are cached;
   cases live in IndexedDB, and sync requests to the relay are never cached. */
const CACHE = "caselog-web-v3";
const SHELL = [
  "./", "index.html", "style.css", "app.js", "local.js", "sync.js", "exports.js", "xlsx.js", "syllabus.js", "syllabi.js", "gs2022.js", "gs2008.js",
  "config.js", "vendor/jsQR.js", "vendor/qrcode.mjs", "fonts/ahn-400.woff2", "fonts/ahn-700.woff2",
  "icons/icon.svg", "manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Network first (so updates arrive), the cached copy when offline or slower than 3 seconds.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  const network = fetch(event.request).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(event.request, copy));
    }
    return res;
  });
  const cached = () => caches.match(event.request, { ignoreSearch: true })
    .then((r) => r || (event.request.mode === "navigate" ? caches.match("index.html") : undefined));
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000));
  event.respondWith(Promise.race([network, timeout]).catch(() => cached().then((r) => r || network)));
});
