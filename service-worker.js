const APP_VERSION = '2023-01-28';
const CACHE_NAME = "gamma-static";
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
self.addEventListener("install", event => {
    console.info('Installing service worker...');
    event.waitUntil(caches.open(CACHE_NAME).then(cache => {
        cache.keys().then(keys => {
            keys.forEach(async function (request, index, array) {
                await cache.delete(request);
            });
        });
        return cache.addAll(OFFLINE_RESOURCES);
    }));
    self.skipWaiting();
});
self.addEventListener("activate", event => {
    console.info('Activating service worker...');
    self.clients.claim();
});
self.addEventListener("fetch", event => {
    event.respondWith(async function () {
        const cache = await caches.open(CACHE_NAME);
        const cachedResponse = await cache.match(event.request);
        if (cachedResponse) {
            updateCache(event.request);
            return cachedResponse;
        }
        ;
        try {
            const networkResponse = await fetch(event.request);
            checkResponse(event.request, networkResponse);
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
        }
        catch (error) {
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
    }
    catch (error) {
        console.warn(error);
    }
}
function checkResponse(target, response) {
    if (!response.ok) {
        console.warn(`Fetching URL "${target.url}" failed, response code: ${response.status}.`);
    }
}
export {};
//# sourceMappingURL=service-worker.js.map