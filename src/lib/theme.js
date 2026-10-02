export const THEME_STORAGE_KEY = 'workspace-crm.theme'
export const THEME_MEDIA_QUERY = '(prefers-color-scheme: dark)'

export const normalizeTheme = (value) => value === 'light' || value === 'dark' ? value : 'system'
export const resolveTheme = (preference, systemDark) => normalizeTheme(preference) === 'system'
  ? systemDark ? 'dark' : 'light'
  : preference

// A browser-local preference, independent of workspace roles and business data.
// One store keeps Settings, the header, OS changes and other tabs in sync.
export function createThemeStore(target) {
  let media
  try { media = target?.matchMedia(THEME_MEDIA_QUERY) } catch {}
  let preference = 'system'
  let persisted = true
  try { preference = normalizeTheme(target?.localStorage.getItem(THEME_STORAGE_KEY)) }
  catch { persisted = false }
  let snapshot = { preference, resolvedTheme: resolveTheme(preference, media?.matches), persisted }
  const listeners = new Set()
  let started = false

  const apply = () => {
    const root = target?.document?.documentElement
    if (!root) return
    root.setAttribute('data-theme', snapshot.resolvedTheme)
    root.style.colorScheme = snapshot.resolvedTheme
    target.document.querySelector('meta[name="theme-color"]')?.setAttribute('content', snapshot.resolvedTheme === 'dark' ? '#101927' : '#244878')
  }
  const update = (nextPreference = snapshot.preference, saved = snapshot.persisted) => {
    const next = { preference: nextPreference, resolvedTheme: resolveTheme(nextPreference, media?.matches), persisted: saved }
    if (Object.keys(next).every((key) => next[key] === snapshot[key])) return
    snapshot = next
    apply()
    listeners.forEach((listener) => listener())
  }
  const onSystemChange = () => update()
  const onStorage = (event) => {
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return
    try { if (event.storageArea && event.storageArea !== target.localStorage) return } catch { return }
    update(normalizeTheme(event.newValue), true)
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    setPreference: (value) => {
      const next = normalizeTheme(value)
      let saved = true
      try { target.localStorage.setItem(THEME_STORAGE_KEY, next) } catch { saved = false }
      update(next, saved)
    },
    start: () => {
      if (started || !target) return
      started = true
      let currentPreference = snapshot.preference
      let saved = snapshot.persisted
      // Catch changes while listeners were detached, without discarding a
      // working in-memory choice when browser storage is unavailable.
      if (saved) {
        try { currentPreference = normalizeTheme(target.localStorage.getItem(THEME_STORAGE_KEY)) }
        catch { saved = false }
      }
      update(currentPreference, saved)
      apply()
      if (media?.addEventListener) media.addEventListener('change', onSystemChange)
      else media?.addListener?.(onSystemChange)
      target.addEventListener('storage', onStorage)
    },
    stop: () => {
      if (!started) return
      started = false
      if (media?.removeEventListener) media.removeEventListener('change', onSystemChange)
      else media?.removeListener?.(onSystemChange)
      target.removeEventListener('storage', onStorage)
    },
  }
}

export const themeStore = createThemeStore(typeof window === 'undefined' ? undefined : window)
