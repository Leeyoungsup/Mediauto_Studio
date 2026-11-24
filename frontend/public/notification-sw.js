self.addEventListener('push', (event) => {
  let tag = 'mediauto-notification';
  try {
    const message = event.data?.json();
    if (typeof message?.tag === 'string' && /^[0-9a-f-]{36}$/.test(message.tag)) tag = message.tag;
  } catch {
    // The notification body remains generic even if an empty payload arrives.
  }
  event.waitUntil(self.registration.showNotification('MeDIAuto Studio', {
    body: 'You have a new notification. Sign in to view it.',
    tag,
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(new URL('/#settings/notifications', self.location.origin).href));
});
