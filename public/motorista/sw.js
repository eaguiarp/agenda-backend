const CACHE_NAME = 'agenda-motorista-v2';

// Lista todos os arquivos que o PWA precisa para funcionar offline
const ARQUIVOS_PARA_CACHE = [
  '/motorista/',
  '/motorista/consulta.html',
  '/motorista/manifest.json',
  '/motorista/icon-192.png'
];

// INSTALL: cacheia os arquivos essenciais
self.addEventListener('install', event => {
  console.log('[SW] Instalando e cacheando arquivos...');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ARQUIVOS_PARA_CACHE);
    }).then(() => {
      // Força o novo SW a assumir imediatamente, sem esperar reload
      return self.skipWaiting();
    })
  );
});

// ACTIVATE: limpa caches antigos e assume o controle
self.addEventListener('activate', event => {
  console.log('[SW] Ativando e limpando caches antigos...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      );
    }).then(() => self.clients.claim()) // Assume controle imediato de todas as abas
  );
});

// FETCH: estratégia "Network First, fallback para Cache"
// Tenta buscar da rede primeiro (dados sempre frescos), cai no cache se offline
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Para a API de agendamentos, sempre vai à rede (nunca cacheia dados dinâmicos)
  if (url.hostname === 'agenda-backend-production-5b72.up.railway.app') {
    event.respondWith(fetch(event.request));
    return;
  }

  // Para arquivos do próprio app: Network First com fallback para cache
  event.respondWith(
    fetch(event.request)
      .then(networkResponse => {
        // Atualiza o cache com a versão mais nova
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Rede falhou, usa o cache
        return caches.match(event.request).then(cachedResponse => {
          if (cachedResponse) return cachedResponse;
          // Fallback final: retorna o index.html para qualquer rota não encontrada
          return caches.match('/motorista/') || caches.match('/motorista/consulta.html');
        });
      })
  );
});
