// Mobile-safe notifications.
// On Android Chrome, `new Notification()` throws — notifications MUST go through the
// service worker registration. On iOS, web notifications only work once the PWA is
// installed to the home screen (16.4+). This helper handles all of that.

export async function requestNotifyPermission() {
  if (typeof Notification === 'undefined') return 'unsupported'
  try { return await Notification.requestPermission() } catch { return 'denied' }
}

export function notifyPermission() {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
}

export async function showReminder(title, body) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  const opts = { body, icon: '/icon-192.png', badge: '/icon-192.png', tag: 'crm-reminder', renotify: true, vibrate: [200, 100, 200], requireInteraction: true }
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration()
      if (reg) { await reg.showNotification(title, opts); return }
    }
    // desktop fallback when no service worker is controlling the page
    new Notification(title, opts)
  } catch {
    /* ignore — e.g. constructor not allowed on mobile without a controlling SW */
  }
}
