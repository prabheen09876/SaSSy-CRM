import assert from 'node:assert/strict'
import test from 'node:test'
import { createAccentStore, ACCENT_STORAGE_KEY } from '../src/lib/accent.js'
import { accentTokens, DEFAULT_ACCENT } from '../src/lib/palette.js'

function fixture({ stored = null, mode = 'light', blocked = false } = {}) {
  const values = new Map(stored ? [[ACCENT_STORAGE_KEY, stored]] : [])
  const properties = new Map()
  const attributes = new Map()
  const listeners = new Set()
  const themeListeners = new Set()
  const meta = { content: '', setAttribute(key, value) { this[key] = value } }
  let currentMode = mode
  let unavailable = blocked
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
  }
  const target = {
    get localStorage() { if (unavailable) throw Error('Storage blocked'); return storage },
    document: {
      documentElement: { style: { setProperty: (key, value) => properties.set(key, value) }, setAttribute: (key, value) => attributes.set(key, value) },
      querySelector: () => meta,
    },
    addEventListener: (event, fn) => { assert.equal(event, 'storage'); listeners.add(fn) },
    removeEventListener: (event, fn) => { assert.equal(event, 'storage'); listeners.delete(fn) },
  }
  const theme = {
    getSnapshot: () => ({ resolvedTheme: currentMode }),
    subscribe: (fn) => { themeListeners.add(fn); return () => themeListeners.delete(fn) },
  }
  return { target, theme, properties, attributes, values, meta, listeners, themeListeners, storage,
    block: () => { unavailable = true },
    setMode: (next) => { currentMode = next; themeListeners.forEach((fn) => fn()) },
    storageEvent: (key, value, storageArea = storage) => listeners.forEach((fn) => fn({ key, newValue: value, storageArea })),
  }
}

test('accent initializes from browser storage, applies tokens and preserves the old default chrome', () => {
  for (const mode of ['light', 'dark']) {
    const env = fixture({ mode })
    const store = createAccentStore(env.target, env.theme)
    store.start()
    assert.deepEqual(store.getSnapshot(), { color: DEFAULT_ACCENT, persisted: true })
    assert.deepEqual(Object.fromEntries(env.properties), accentTokens(DEFAULT_ACCENT, mode))
    assert.equal(env.meta.content, mode === 'dark' ? '#101927' : DEFAULT_ACCENT)
    assert.equal(env.values.size, 0, 'loading does not write a preference')
    store.stop()
  }
  const env = fixture({ stored: '#abc' })
  const store = createAccentStore(env.target, env.theme)
  store.start()
  assert.equal(store.getSnapshot().color, '#AABBCC')
  assert.equal(env.attributes.get('data-accent'), '#AABBCC')
  assert.equal(env.meta.content, '#AABBCC')
})

test('accent selection persists independently and recolors on mode changes', () => {
  const env = fixture()
  const store = createAccentStore(env.target, env.theme)
  store.start()
  let changes = 0
  store.subscribe(() => changes++)
  store.setColor('#0f766e')
  assert.equal(env.values.get(ACCENT_STORAGE_KEY), '#0F766E')
  const snapshot = store.getSnapshot()
  const foreground = env.properties.get('--brand-fg')
  env.setMode('dark')
  assert.equal(store.getSnapshot(), snapshot, 'display mode does not change the accent preference')
  assert.notEqual(env.properties.get('--brand-fg'), foreground)
  assert.equal(env.properties.get('--brand'), '#0F766E')
  assert.equal(env.values.size, 1, 'no workspace or display preference is written')
  store.setColor('#0F766E')
  assert.equal(changes, 1, 'an identical snapshot is stable')
})

test('cross-tab accent changes and storage clearing preserve unrelated settings', () => {
  const env = fixture()
  const store = createAccentStore(env.target, env.theme)
  store.start()
  const initial = store.getSnapshot()
  env.storageEvent('workspace-crm.theme', 'dark')
  env.storageEvent(ACCENT_STORAGE_KEY, '#BE185D', {})
  assert.equal(store.getSnapshot(), initial)
  env.storageEvent(ACCENT_STORAGE_KEY, '#BE185D')
  assert.equal(store.getSnapshot().color, '#BE185D')
  env.storageEvent(ACCENT_STORAGE_KEY, null)
  assert.equal(store.getSnapshot().color, DEFAULT_ACCENT)
  env.storageEvent(ACCENT_STORAGE_KEY, '#475569')
  env.storageEvent(null, null)
  assert.equal(store.getSnapshot().color, DEFAULT_ACCENT)
  assert.equal(env.values.size, 0, 'storage events do not write back')
})

test('blocked storage keeps an in-memory color and a truthful persistence status', () => {
  const env = fixture({ blocked: true })
  const store = createAccentStore(env.target, env.theme)
  store.start()
  assert.equal(store.getSnapshot().persisted, false)
  store.setColor('#BE185D')
  assert.deepEqual(store.getSnapshot(), { color: '#BE185D', persisted: false })
  assert.equal(env.properties.get('--brand'), '#BE185D')
  store.stop()
  store.start()
  assert.equal(store.getSnapshot().color, '#BE185D')
  env.setMode('dark')
  assert.equal(env.properties.get('--brand'), '#BE185D')
})

test('accent start is idempotent and restart resamples saved state without leaking listeners', () => {
  const env = fixture({ stored: '#0F766E' })
  const store = createAccentStore(env.target, env.theme)
  env.values.set(ACCENT_STORAGE_KEY, '#BE185D')
  store.start(); store.start()
  assert.equal(store.getSnapshot().color, '#BE185D')
  assert.equal(env.listeners.size, 1)
  assert.equal(env.themeListeners.size, 1)
  store.stop(); store.stop()
  assert.equal(env.listeners.size, 0)
  assert.equal(env.themeListeners.size, 0)
  env.values.set(ACCENT_STORAGE_KEY, '#7C3AED')
  env.setMode('dark')
  store.start()
  assert.equal(store.getSnapshot().color, '#7C3AED')
  assert.deepEqual(Object.fromEntries(env.properties), accentTokens('#7C3AED', 'dark'))
})

test('invalid stored colors cannot insert CSS and changing colors remains available after storage fails', () => {
  const env = fixture({ stored: 'red;display:none' })
  const store = createAccentStore(env.target, env.theme)
  store.start()
  assert.equal(store.getSnapshot().color, DEFAULT_ACCENT)
  env.block()
  store.setColor('#fff')
  assert.deepEqual(store.getSnapshot(), { color: '#FFFFFF', persisted: false })
  assert.equal(env.properties.get('--brand'), '#FFFFFF')
})
