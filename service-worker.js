/* eslint-disable no-undef */
/*

  Manage fetch requests, return cached data and control offline behaviour.

  Gamma MCA: free, open-source web-MCA for gamma spectroscopy
  2022, NuclearPhoenix.- Phoenix1747
  https://nuclearphoenix.xyz

*/
const APP_VERSION = '2025-06-16';
const CACHE_NAME = 'gamma-static'; // A random name for the cache

const OFFLINE_RESOURCES = [
                          '/',
                          '/index.html',
                          '/404.html',
                          '/print.html',
                          '/assets/logo.svg',
                          '/dist/main.css',
                          '/dist/notFound.css',
                          '/dist/main.bundle.js',
                          '/dist/notFound.bundle.js',
                          '/assets/files/csv.png',
                          '/assets/files/json.png',
                          '/assets/files/txt.png',
                          '/assets/files/xml.png',
                          '/assets/favicon/favicon-32x32.png',
                          '/assets/favicon/favicon.ico',
                          '/assets/isotopes_energies_min.json',
                          '/assets/isotopes_energies_norm_min.json',
                          '/assets/isotopes_energies_artificial_min.json',
                          '/assets/notifications/badge.png',
                          '/assets/notifications/icon.png',
                          '/assets/npes-1.schema.json',
                          '/assets/npes-2.schema.json'
                          ];


self.addEventListener('install', event => { // First time install of a worker
  console.info(`Installing service worker version ${APP_VERSION}...`);

  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache =>  {
      /*
      for (const URL of OFFLINE_RESOURCES) { // Remove old cached files
        cache.delete(URL, {ignoreSearch: true, ignoreMethod: true});
      }
      */
      cache.keys().then(keys => { // Delete the whole cache
        keys.forEach(async request => {
          //console.info('Clearing cache!', request);
          await cache.delete(request);
        });
      })
      await cache.addAll(OFFLINE_RESOURCES); // Cache all important files
    })
  );

  self.skipWaiting(); // Forces the waiting service worker to become the active service worker
});


self.addEventListener('activate', () => { // New worker takes over
  console.info('Activating service worker...');
  self.clients.claim(); // Allows an active service worker to set itself as the controller for all clients within its scope
});


self.addEventListener('fetch', event => {
  //console.info('mode', event.request);

  event.respondWith(async function() {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(event.request);

    if (cachedResponse) { // Try to load from cache first, way faster
      //console.info('Cache Response!', cachedResponse);
      updateCache(event.request, cache); // Always also try to update the cache, dont wait for it though
      return cachedResponse;
    }

    try {  // Not found in cache -- request from network
      const networkResponse = await fetch(event.request);
      checkResponse(event.request, networkResponse);
      cache.put(event.request, networkResponse.clone());

      //console.info('Network Response!', networkResponse);

      return networkResponse;
    } catch (error) { // Did not find in cache or network, probably new page and offline access!
      console.error(error);
    }
  }());
});


async function updateCache(request, cache) {
  try {
    const networkResponse = await fetch(request);
    checkResponse(request, networkResponse);

    cache.put(request, networkResponse.clone());

    //console.info('Updated Cache!', response);
  } catch (error) {
    console.warn(error); // Also fires when offline...
  }
}


function checkResponse(target, response) {
  if (!response.ok) console.warn(`Fetching URL "${target.url}" failed, response code: ${response.status}.`);
  return response.ok;
}
