/**
 * The admin's service worker (public/sw.js) makes it installable and shows an
 * offline page; it caches nothing.
 *
 * It is registered under a URL that changes with every build: nginx marks
 * every .js file cacheable for a month and Cloudflare honours it, so a fixed
 * /sw.js stays stale at the edge for weeks (server/CLAUDE.md, "Web push").
 * A new URL is always a fresh fetch, and the browser treats it as an update of
 * the same registration.
 */
export const APP_SW_URL = `/sw.js?v=${__APP_BUILD__}`;

export async function registerAppServiceWorker(): Promise<void> {
  // Production builds only: in dev it would get in the way of HMR.
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;
  // Browsers refuse a worker over http:// except on localhost.
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
  try {
    await navigator.serviceWorker.register(APP_SW_URL, { scope: '/' });
  } catch {
    // The admin works without it; it just cannot be installed.
  }
}
