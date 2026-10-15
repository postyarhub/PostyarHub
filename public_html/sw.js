/* Postyar PWA worker: cache only public static assets, never account/API data. */
'use strict';
const POSTYAR_CACHE_PREFIX = 'postyar-pwa-';
const POSTYAR_STATIC_CACHE = 'postyar-pwa-static-v1';
const POSTYAR_SHELL_CACHE = 'postyar-pwa-shell-v1';
const POSTYAR_OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(POSTYAR_SHELL_CACHE);
    const response = await fetch(POSTYAR_OFFLINE_URL, { cache: 'reload' });
    if (!response.ok) throw new Error('Postyar offline page unavailable during worker installation');
    await cache.put(POSTYAR_OFFLINE_URL, response);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([POSTYAR_STATIC_CACHE, POSTYAR_SHELL_CACHE]);
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(POSTYAR_CACHE_PREFIX) && !keep.has(key)).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never intercept or cache private/runtime endpoints.
  if (url.pathname.startsWith('/api/') || url.pathname === '/api' || url.pathname === '/health' || url.pathname.startsWith('/health/') || url.pathname.startsWith('/auth/')) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch (_) {
        return (await caches.match(POSTYAR_OFFLINE_URL)) || Response.error();
      }
    })());
    return;
  }

  const path = url.pathname;
  const isHashedBundle = /^\/assets\/[^/]+-[A-Za-z0-9_-]{6,}\.(?:js|css|woff2|png|webp|svg)$/.test(path);
  const isPublicStatic = /^\/(?:icons|fonts|images)\/[^/]+(?:\/[^/]+)*\.(?:png|jpe?g|webp|svg|woff2|ico)$/.test(path);
  const isVersionedPublicCss = path === '/seo-pages.css' && url.searchParams.has('v');
  const isManifest = path === '/manifest.webmanifest';
  if (!isHashedBundle && !isPublicStatic && !isVersionedPublicCss && !isManifest) return;

  event.respondWith((async () => {
    const cache = await caches.open(POSTYAR_STATIC_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') await cache.put(request, response.clone());
    return response;
  })());
});
