/*

  Gamma MCA: free, open-source web-MCA for gamma spectroscopy
  2022, NuclearPhoenix.- Phoenix1747
  https://nuclearphoenix.xyz

  Service Worker for Progressive Web App!

  ===============================

  Possible Future Improvements:
    - nothing.

*/
const APP_VERSION = '2022-09-03';
const CACHE_NAME = "gamma-static"; // A random name for the cache
const OFFLINE_RESOURCES = ['/',
                          '/index.html',
                          '/site.webmanifest',
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
                          '/assets/isotopes_energies_min.json'];


self.addEventListener("install", event => { // First time install of a worker
  console.log('Installing service worker.');

  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      /*
      for (const URL of OFFLINE_RESOURCES) { // Remove old cached files
        cache.delete(URL, {ignoreSearch: true, ignoreMethod: true});
      }
      */
      cache.keys().then(keys => { // Delete the whole cache
        keys.forEach(async function(request, index, array) {
          //console.log('Clearing cache!', request);
          await cache.delete(request);
        });
      })
      return cache.addAll(OFFLINE_RESOURCES); // Cache all important files
    })
  );

  self.skipWaiting(); // Forces the waiting service worker to become the active service worker
});


self.addEventListener("activate", event => { // New worker takes over
  console.log('Activating service worker.');
  self.clients.claim(); // Allows an active service worker to set itself as the controller for all clients within its scope
});


self.addEventListener("fetch", event => {
  //console.log('mode', event.request.mode);

  event.respondWith(async function() {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(event.request);

    if (cachedResponse) { // Try to load from cache first, way faster
      //console.log('Cache Response!', cachedResponse);
      updateCache(event.request); // Always also try to update the cache, dont wait for it though
      return cachedResponse;
    };

    try {  // Not found in cache -- request from network
      const networkResponse = await fetch(event.request);

      console.log('Network Response!', networkResponse);
      cache.put(event.request, networkResponse.clone());
      return networkResponse;
    } catch (error) { // Did not find in cache or network, probably new page and offline access!
      throw error;
    }
  }());
});


async function updateCache(request) {
  try {
    const response = await fetch(request);

    //console.log('Updating Cache!', response);
    cache.put(request, response.clone());
  } catch (e) {
    ; // Ignore, not critical after all. Probably just offline
  }
}
