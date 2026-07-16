self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => {
        return Promise.all(keys.map((key) => caches.delete(key)));
      })
      .then(() => {
        return self.registration.unregister();
      })
      .then(() => {
        return self.clients.matchAll();
      })
      .then((clients) => {
        clients.forEach((client) => {
          if (client.navigate && client.url) {
            client.navigate(client.url);
          }
        });
      })
  );
});
