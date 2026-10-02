// Web Push subscribe flow — lets reminders reach this device even when the app is
// closed / screen off. The public key must match the Worker's VAPID_PUBLIC.
import { supabase, hasConfig, workerUrl, tenantHeaders } from './supabase'

const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY
const WORKER_URL = workerUrl

export function pushSupported() {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator &&
    typeof window !== 'undefined' && 'PushManager' in window
}

function urlB64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

// Ensure a push subscription exists for this device and is saved to the backend.
// Returns true on success; false (quietly) if unsupported or not wired.
export async function subscribeToPush() {
  if (!hasConfig || !pushSupported() || !WORKER_URL || !VAPID_PUBLIC) return false
  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC),
    })
  }
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return false
  const res = await fetch(`${WORKER_URL}/push/subscribe`, {
    redirect: 'error',
    method: 'POST',
    headers: { 'content-type': 'application/json', ...tenantHeaders(), authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  })
  return res.ok
}
