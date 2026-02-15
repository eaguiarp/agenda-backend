const CACHE_NAME = "agendacd-v1";

// Lista de arquivos que DEVEM ser salvos para o app funcionar offline
// Note que agora não tem mais "css/" nem "assets/" no caminho
const FILES_TO_CACHE = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js",
  "./manifest.json",
  "./icon-72.png",
  "./icon-96.png",
  "./icon-144.png",
  "./icon-192.png",
  "./icon-512.png"
];

// 1. Instalação: Baixa os arquivos da lista e salva no cache
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[Service Worker] Caching app shell");
      return cache.addAll(FILES_TO_CACHE);
    })
  );
  self.skipWaiting(); // Força o SW a ativar imediatamente
});

// 2. Ativação: Limpa caches antigos se você mudar a versão (v1 -> v2)
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log("[Service Worker] Removendo cache antigo", key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// 3. Interceptação (Fetch): A Mágica Acontece Aqui
self.addEventListener("fetch", (event) => {
  
  // REGRA DE OURO: Nunca fazer cache da API de dados (/agendamentos)
  // Se for uma chamada para a API, vai direto para a internet (Network Only)
  if (event.request.url.includes("/agendamentos")) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Para o resto (CSS, HTML, JS, Imagens), tenta o Cache primeiro.
  // Se não tiver no cache, busca na rede.
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});