self.addEventListener("install", event => {
    event.waitUntil(
        caches.open("agendacd-v1").then(cache => {
            return cache.addAll([
                "index.html",
                "css/style.css"
            ]);
        })
    );
});

self.addEventListener("fetch", event => {
    event.respondWith(
        caches.match(event.request).then(response => {
            return response || fetch(event.request);
        })
    );
});

const CACHE_NAME = "agendacd-v1";

const FILES_TO_CACHE = [
  "/",
  "/index.html",
  "/agendar.html",
  "/consultar.html",
  "/agenda.html",
  "/css/style.css",
  "/manifest.json",
  "/assets/icons/icon-72.png",
  "/assets/icons/icon-96.png",
  "/assets/icons/icon-144.png",
  "/assets/icons/icon-192.png",
  "/assets/icons/icon-216.png",
  "/assets/icons/icon-512.png"
];

// Instala o cache
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(FILES_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// Ativa e limpa caches antigos
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    )
  );
  self.clients.claim();
});

// Busca: cache primeiro, rede depois
self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});
