/* SBC Admin service worker.
   Exists so the admin can be installed (Chrome wants a worker with a fetch
   handler). It caches NOTHING: admin data is sensitive and must always come
   fresh from the server. The only thing it adds is an offline page when a
   page load (navigation) fails because there is no network.
   Registered as /sw.js?v=<build> (src/pwa/serviceWorker.ts): nginx/Cloudflare
   cache .js files for a month, so a fixed URL would stay stale. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const OFFLINE_PAGE = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>SBC Admin – hors ligne</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: 24px;
         font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
         background: #F8FAFC; color: #0F172A; }
  @media (prefers-color-scheme: dark) { body { background: #101828; color: #F3F4F6; } p { color: #AEB8C8; } }
  main { max-width: 360px; text-align: center; }
  h1 { font-size: 20px; margin: 0 0 8px; }
  p { margin: 0 0 20px; color: #475569; line-height: 1.5; }
  button { height: 44px; padding: 0 20px; border: 0; border-radius: 8px; background: #115CF6; color: #fff;
           font: inherit; font-weight: 600; cursor: pointer; }
</style></head>
<body><main>
  <h1>Pas de connexion</h1>
  <p>L'administration SBC a besoin d'internet. Vérifiez votre connexion, puis réessayez.</p>
  <button onclick="location.reload()">Réessayer</button>
</main></body></html>`;

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only page loads. API calls, scripts, images: untouched, straight to the network.
  if (req.mode !== 'navigate' || req.method !== 'GET') return;
  event.respondWith(
    fetch(req).catch(() => new Response(OFFLINE_PAGE, {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    })),
  );
});
