import { DEFAULT_ACCENT, normalizeAccent, accentTokens } from './palette.js'
import { themeStore } from './theme.js'

export const ACCENT_STORAGE_KEY = 'workspace-crm.accent'

// Keep color separate from display mode so switching to dark or following the
// device never resets a chosen palette. Neither setting touches workspace data.
export function createAccentStore(target, theme) {
  let color = DEFAULT_ACCENT
  let persisted = true
  try { color = normalizeAccent(target?.localStorage.getItem(ACCENT_STORAGE_KEY)) }
  catch { persisted = false }
  let snapshot = { color, persisted }
  const listeners = new Set()
  let started = false
  let unsubscribeTheme

  const apply = () => {
    const root = target?.document?.documentElement
    if (!root) return
    const mode = theme.getSnapshot().resolvedTheme
    const tokens = accentTokens(snapshot.color, mode)
    Object.entries(tokens).forEach(([key, value]) => root.style.setProperty(key, value))
    root.setAttribute('data-accent', snapshot.color)
    const browserColor = snapshot.color === DEFAULT_ACCENT ? mode === 'dark' ? '#101927' : DEFAULT_ACCENT : tokens['--brand']
    target.document.querySelector('meta[name="theme-color"]')?.setAttribute('content', browserColor)
  }
  const update = (nextColor, saved) => {
    if (snapshot.color === nextColor && snapshot.persisted === saved) return
    snapshot = { color: nextColor, persisted: saved }
    apply()
    listeners.forEach((listener) => listener())
  }
  const onStorage = (event) => {
    if (event.key !== ACCENT_STORAGE_KEY && event.key !== null) return
    try { if (event.storageArea && event.storageArea !== target.localStorage) return } catch { return }
    update(normalizeAccent(event.newValue), true)
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    setColor: (value) => {
      const nextColor = normalizeAccent(value)
      let saved = true
      try { target.localStorage.setItem(ACCENT_STORAGE_KEY, nextColor) } catch { saved = false }
      update(nextColor, saved)
    },
    start: () => {
      if (started || !target) return
      started = true
      let nextColor = snapshot.color
      let saved = snapshot.persisted
      if (saved) {
        try { nextColor = normalizeAccent(target.localStorage.getItem(ACCENT_STORAGE_KEY)) }
        catch { saved = false }
      }
      update(nextColor, saved)
      apply()
      unsubscribeTheme = theme.subscribe(apply)
      target.addEventListener('storage', onStorage)
    },
    stop: () => {
      if (!started) return
      started = false
      unsubscribeTheme?.()
      target.removeEventListener('storage', onStorage)
    },
  }
}

export const accentStore = createAccentStore(typeof window === 'undefined' ? undefined : window, themeStore)
