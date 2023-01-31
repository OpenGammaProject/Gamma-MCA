/*

  Gamma MCA: free, open-source web-MCA for gamma spectroscopy
  2022, NuclearPhoenix.- Phoenix1747
  https://nuclearphoenix.xyz

  Service Worker for Progressive Web App!

  ===============================

  Possible Future Improvements:
    - Somehow fetching and caching the hits tracker does not work:
      URL = https://hits.seeyoufarm.com/api/count/incr/badge.svg?url=https%3A%2F%2Fspectrum.nuclearphoenix.xyz&count_bg=%2379C83D&title_bg=%23555555&icon=&icon_color=%23E7E7E7&title=hits&edge_flat=true

*/
const APP_VERSION = '2023-01-28';

const CACHE_NAME = `gamma-static-${APP_VERSION}`; // A random name for the cache
const OFFLINE_RESOURCES = ['/',
                          '/index.html',
                          '/404.html',
                          '/assets/css/bootstrap.min.css',
                          '/assets/css/all.min.css',
                          '/assets/css/main.css',
                          '/assets/logo.svg',
                          '/assets/webfonts/fa-solid-900.woff2',
                          '/assets/webfonts/fa-brands-400.woff2',
                          '/assets/webfonts/fa-solid-900.ttf',
                          '/assets/webfonts/fa-brands-400.ttf',
                          '/assets/js/external/plotly-basic.min.js',
                          '/assets/js/external/bootstrap.min.js',
                          '/assets/js/external/ZSchema-browser-min.js',
                          '/assets/js/raw-data.js',
                          '/assets/js/plot.js',
                          '/assets/js/serial.js',
                          '/assets/js/main.js',
                          '/assets/files/csv.png',
                          '/assets/files/json.png',
                          '/assets/files/txt.png',
                          '/assets/files/xml.png',
                          '/assets/favicon/favicon-32x32.png',
                          '/assets/favicon/favicon.ico',
                          '/assets/isotopes_energies_min.json',
                          '/assets/npes-1.schema.json'];


self.addEventListener("install", event => { // First time install of a worker
  console.info('Installing service worker...');

  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => async function() {
      /*
      for (const URL of OFFLINE_RESOURCES) { // Remove old cached files
        cache.delete(URL, {ignoreSearch: true, ignoreMethod: true});
      }
      */
      cache.keys().then(keys => { // Delete the whole cache
        keys.forEach(async function(request, index, array) {
          //console.info('Clearing cache!', request);
          await cache.delete(request);
        });
      })
      await cache.addAll(OFFLINE_RESOURCES); // Cache all important files
    })
  );

  self.skipWaiting(); // Forces the waiting service worker to become the active service worker
});


self.addEventListener("activate", event => { // New worker takes over
  console.info('Activating service worker...');
  self.clients.claim(); // Allows an active service worker to set itself as the controller for all clients within its scope
});


self.addEventListener("fetch", event => {
  //console.info('mode', event.request);

  event.respondWith(async function() {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(event.request);

    if (cachedResponse) { // Try to load from cache first, way faster
      //console.info('Cache Response!', cachedResponse);
      updateCache(event.request); // Always also try to update the cache, dont wait for it though
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


async function updateCache(request) {
  try {
    const networkResponse = await fetch(request);
    checkResponse(request, networkResponse);

    const cache = await caches.open(CACHE_NAME);
    cache.put(request, networkResponse.clone());

    //console.info('Updated Cache!', response);
  } catch (error) {
    console.warn(error); // Also fires when offline...
  }
}


function checkResponse(target, response) {
  if (!response.ok) {
    console.warn(`Fetching URL "${target.url}" failed, response code: ${response.status}.`);
    return true;
  }
  return false;
}
