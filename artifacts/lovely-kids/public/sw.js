self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});

self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || "Lovely Kids", {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: data.url || "/" }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.postMessage({
            type: "LOVELY_KIDS_NOTIFICATION_NAVIGATE",
            url,
          });
          return client.focus();
        }
      }

      return self.clients.openWindow(url);
    }),
  );
});
