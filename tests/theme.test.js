import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

import {
  createThemeStore,
  normalizeTheme,
  resolveTheme,
  THEME_MEDIA_QUERY,
  THEME_STORAGE_KEY,
} from '../src/lib/theme.js'

const LIGHT_COLOR = '#244878'
const DARK_COLOR = '#101927'

function createDocument() {
  const attributes = new Map()
  const metaAttributes = new Map([['content', LIGHT_COLOR]])
  const documentElement = {
    style: {},
    setAttribute(name, value) { attributes.set(name, String(value)) },
    getAttribute(name) { return attributes.get(name) ?? null },
  }
  const meta = {
    setAttribute(name, value) { metaAttributes.set(name, String(value)) },
    getAttribute(name) { return metaAttributes.get(name) ?? null },
  }
  return {
    documentElement,
    querySelector(selector) { return selector === 'meta[name="theme-color"]' ? meta : null },
    read() {
      return {
        theme: documentElement.getAttribute('data-theme'),
        colorScheme: documentElement.style.colorScheme,
        themeColor: meta.getAttribute('content'),
      }
    },
  }
}

function createStorage({ value = null, getError = false, setError = false } = {}) {
  const values = new Map()
  if (value !== null && value !== undefined) values.set(THEME_STORAGE_KEY, String(value))
  const calls = { get: 0, set: 0, remove: 0, clear: 0 }
  return {
    calls,
    getItem(key) {
      calls.get += 1
      if (getError) throw new Error('Storage get blocked')
      return values.get(key) ?? null
    },
    setItem(key, next) {
      calls.set += 1
      if (setError) throw new Error('Storage set blocked')
      values.set(key, String(next))
    },
    removeItem(key) { calls.remove += 1; values.delete(key) },
    clear() { calls.clear += 1; values.clear() },
    peek(key = THEME_STORAGE_KEY) { return values.get(key) ?? null },
  }
}

function createMedia({ matches = false, legacy = false } = {}) {
  const listeners = new Set()
  const calls = { add: 0, remove: 0 }
  const media = {
    matches,
    media: THEME_MEDIA_QUERY,
    calls,
    emit(next) {
      media.matches = next
      for (const listener of [...listeners]) listener({ matches: next, media: THEME_MEDIA_QUERY })
    },
    listenerCount: () => listeners.size,
  }
  if (legacy) {
    media.addListener = (listener) => { calls.add += 1; listeners.add(listener) }
    media.removeListener = (listener) => { calls.remove += 1; listeners.delete(listener) }
  } else {
    media.addEventListener = (type, listener) => {
      assert.equal(type, 'change')
      calls.add += 1
      listeners.add(listener)
    }
    media.removeEventListener = (type, listener) => {
      assert.equal(type, 'change')
      calls.remove += 1
      listeners.delete(listener)
    }
  }
  return media
}

function createTarget({
  stored = null,
  systemDark = false,
  storage = createStorage({ value: stored }),
  media = createMedia({ matches: systemDark }),
  storageGetterError = false,
} = {}) {
  const document = createDocument()
  const eventListeners = new Map()
  const eventCalls = { add: 0, remove: 0 }
  const target = {
    document,
    matchMedia(query) { assert.equal(query, THEME_MEDIA_QUERY); return media },
    addEventListener(type, listener) {
      eventCalls.add += 1
      if (!eventListeners.has(type)) eventListeners.set(type, new Set())
      eventListeners.get(type).add(listener)
    },
    removeEventListener(type, listener) {
      eventCalls.remove += 1
      eventListeners.get(type)?.delete(listener)
    },
  }
  if (storageGetterError) {
    Object.defineProperty(target, 'localStorage', {
      configurable: true,
      get() { throw new Error('Storage property blocked') },
    })
  } else {
    target.localStorage = storage
  }
  return {
    target,
    storage,
    media,
    document,
    eventCalls,
    dispatch(type, event) {
      for (const listener of [...(eventListeners.get(type) || [])]) listener(event)
    },
    listenerCount(type) { return eventListeners.get(type)?.size || 0 },
  }
}

function expectedAppearance(theme) {
  return {
    theme,
    colorScheme: theme,
    themeColor: theme === 'dark' ? DARK_COLOR : LIGHT_COLOR,
  }
}

test('normalization and resolution treat missing or invalid values as system', () => {
  for (const value of [undefined, null, '', 'system', 'auto', 'DARK', 1, {}]) {
    assert.equal(normalizeTheme(value), 'system')
  }
  assert.equal(normalizeTheme('light'), 'light')
  assert.equal(normalizeTheme('dark'), 'dark')
  assert.equal(resolveTheme('system', false), 'light')
  assert.equal(resolveTheme('system', true), 'dark')
  assert.equal(resolveTheme('invalid', true), 'dark')
  assert.equal(resolveTheme('light', true), 'light')
  assert.equal(resolveTheme('dark', false), 'dark')
})

test('legacy saved light and dark preferences override the operating system', () => {
  for (const { stored, systemDark } of [
    { stored: 'dark', systemDark: false },
    { stored: 'light', systemDark: true },
  ]) {
    const fake = createTarget({ stored, systemDark })
    const store = createThemeStore(fake.target)
    assert.deepEqual(store.getSnapshot(), { preference: stored, resolvedTheme: stored, persisted: true })
    store.start()
    assert.deepEqual(fake.document.read(), expectedAppearance(stored))
    assert.equal(fake.storage.calls.set, 0, 'loading a saved preference must not rewrite storage')
    store.stop()
  }
})

test('operating-system changes update only a system preference', () => {
  const fake = createTarget({ systemDark: false })
  const store = createThemeStore(fake.target)
  let notifications = 0
  store.subscribe(() => { notifications += 1 })
  store.start()

  fake.media.emit(true)
  assert.deepEqual(store.getSnapshot(), { preference: 'system', resolvedTheme: 'dark', persisted: true })
  assert.deepEqual(fake.document.read(), expectedAppearance('dark'))
  assert.equal(notifications, 1)

  store.setPreference('dark')
  assert.equal(notifications, 2, 'changing system to an explicit preference is observable')
  const explicitSnapshot = store.getSnapshot()
  fake.media.emit(false)
  assert.strictEqual(store.getSnapshot(), explicitSnapshot)
  assert.deepEqual(fake.document.read(), expectedAppearance('dark'))
  assert.equal(notifications, 2, 'OS changes must be silent while an explicit preference is active')

  store.setPreference('system')
  assert.deepEqual(store.getSnapshot(), { preference: 'system', resolvedTheme: 'light', persisted: true })
  fake.media.emit(true)
  assert.equal(store.getSnapshot().resolvedTheme, 'dark')
  assert.equal(notifications, 4)
  store.stop()
})

test('snapshots remain referentially stable across no-op updates and notifications expose the new snapshot', () => {
  const fake = createTarget({ stored: 'light', systemDark: true })
  const store = createThemeStore(fake.target)
  const initial = store.getSnapshot()
  const seen = []
  const unsubscribe = store.subscribe(() => seen.push(store.getSnapshot()))

  store.setPreference('light')
  assert.strictEqual(store.getSnapshot(), initial)
  assert.deepEqual(seen, [])

  store.setPreference('dark')
  const changed = store.getSnapshot()
  assert.notStrictEqual(changed, initial)
  assert.deepEqual(changed, { preference: 'dark', resolvedTheme: 'dark', persisted: true })
  assert.deepEqual(seen, [changed])

  store.setPreference('dark')
  assert.strictEqual(store.getSnapshot(), changed)
  assert.deepEqual(seen, [changed])
  unsubscribe()
  store.setPreference('system')
  assert.deepEqual(seen, [changed], 'unsubscribed listeners must not be notified')
})

test('storage events filter keys and storage areas, while removal and clear restore system mode', () => {
  const fake = createTarget({ stored: 'light', systemDark: true })
  const store = createThemeStore(fake.target)
  const foreignStorage = createStorage({ value: 'dark' })
  let notifications = 0
  store.subscribe(() => { notifications += 1 })
  store.start()

  fake.dispatch('storage', { key: 'unrelated', newValue: 'dark', storageArea: fake.storage })
  fake.dispatch('storage', { key: THEME_STORAGE_KEY, newValue: 'dark', storageArea: foreignStorage })
  fake.dispatch('storage', {
    key: THEME_STORAGE_KEY,
    newValue: 'dark',
    get storageArea() { throw new Error('Hostile storage area') },
  })
  assert.equal(store.getSnapshot().preference, 'light')
  assert.equal(notifications, 0)

  fake.dispatch('storage', { key: THEME_STORAGE_KEY, newValue: 'dark', storageArea: fake.storage })
  assert.deepEqual(store.getSnapshot(), { preference: 'dark', resolvedTheme: 'dark', persisted: true })
  assert.equal(notifications, 1)

  fake.dispatch('storage', { key: THEME_STORAGE_KEY, newValue: null, storageArea: fake.storage })
  assert.deepEqual(store.getSnapshot(), { preference: 'system', resolvedTheme: 'dark', persisted: true })
  fake.media.emit(false)
  assert.equal(store.getSnapshot().resolvedTheme, 'light')

  store.setPreference('light')
  const writesBeforeClear = fake.storage.calls.set
  fake.dispatch('storage', { key: null, newValue: null, storageArea: fake.storage })
  assert.deepEqual(store.getSnapshot(), { preference: 'system', resolvedTheme: 'light', persisted: true })
  assert.equal(fake.storage.calls.set, writesBeforeClear, 'a clear event must not reinsert a preference')
  store.stop()
})

test('storage read and write failures still apply a theme and report non-persistence', () => {
  const blockedRead = createStorage({ getError: true })
  const initial = createTarget({ systemDark: true, storage: blockedRead })
  const initialStore = createThemeStore(initial.target)
  assert.deepEqual(initialStore.getSnapshot(), { preference: 'system', resolvedTheme: 'dark', persisted: false })
  initialStore.start()
  assert.deepEqual(initial.document.read(), expectedAppearance('dark'))
  initialStore.stop()

  const blockedWrite = createStorage({ value: 'light', setError: true })
  const changed = createTarget({ systemDark: false, storage: blockedWrite })
  const changedStore = createThemeStore(changed.target)
  changedStore.start()
  assert.doesNotThrow(() => changedStore.setPreference('dark'))
  assert.deepEqual(changedStore.getSnapshot(), { preference: 'dark', resolvedTheme: 'dark', persisted: false })
  assert.deepEqual(changed.document.read(), expectedAppearance('dark'))
  changedStore.stop()

  const blockedProperty = createTarget({ systemDark: false, storageGetterError: true })
  const blockedPropertyStore = createThemeStore(blockedProperty.target)
  blockedPropertyStore.start()
  assert.doesNotThrow(() => blockedPropertyStore.setPreference('dark'))
  assert.deepEqual(blockedPropertyStore.getSnapshot(), { preference: 'dark', resolvedTheme: 'dark', persisted: false })
  assert.deepEqual(blockedProperty.document.read(), expectedAppearance('dark'))
  blockedPropertyStore.stop()
})

test('start refreshes persisted storage and current media state on first start and restart', () => {
  const beforeFirstStart = createTarget({ stored: 'system', systemDark: false })
  const firstStore = createThemeStore(beforeFirstStart.target)
  assert.deepEqual(firstStore.getSnapshot(), { preference: 'system', resolvedTheme: 'light', persisted: true })
  beforeFirstStart.storage.setItem(THEME_STORAGE_KEY, 'dark')
  beforeFirstStart.media.matches = true
  firstStore.start()
  assert.deepEqual(firstStore.getSnapshot(), { preference: 'dark', resolvedTheme: 'dark', persisted: true })
  assert.deepEqual(beforeFirstStart.document.read(), expectedAppearance('dark'))
  firstStore.stop()

  const beforeRestart = createTarget({ stored: 'light', systemDark: false })
  const restartedStore = createThemeStore(beforeRestart.target)
  restartedStore.start()
  assert.deepEqual(restartedStore.getSnapshot(), { preference: 'light', resolvedTheme: 'light', persisted: true })
  restartedStore.stop()
  beforeRestart.storage.setItem(THEME_STORAGE_KEY, 'system')
  beforeRestart.media.matches = true
  restartedStore.start()
  assert.deepEqual(restartedStore.getSnapshot(), { preference: 'system', resolvedTheme: 'dark', persisted: true })
  assert.deepEqual(beforeRestart.document.read(), expectedAppearance('dark'))
  restartedStore.stop()
})

test('start preserves an unsaved in-memory choice instead of rereading stale storage', () => {
  const storage = createStorage({ value: 'light', setError: true })
  const fake = createTarget({ storage, systemDark: false })
  const store = createThemeStore(fake.target)
  assert.equal(storage.calls.get, 1)

  store.setPreference('dark')
  assert.equal(storage.peek(), 'light', 'the failed write leaves the old persisted preference behind')
  assert.deepEqual(store.getSnapshot(), { preference: 'dark', resolvedTheme: 'dark', persisted: false })

  store.start()
  assert.deepEqual(store.getSnapshot(), { preference: 'dark', resolvedTheme: 'dark', persisted: false })
  assert.equal(storage.calls.get, 1, 'first start must not reread stale storage after a failed write')
  store.stop()

  fake.media.matches = true
  store.start()
  assert.deepEqual(store.getSnapshot(), { preference: 'dark', resolvedTheme: 'dark', persisted: false })
  assert.equal(storage.calls.get, 1, 'restart must continue to preserve the in-memory choice')
  assert.deepEqual(fake.document.read(), expectedAppearance('dark'))
  store.stop()
})

for (const legacy of [false, true]) {
  test(`start is idempotent and stop removes ${legacy ? 'legacy' : 'modern'} media and storage listeners`, () => {
    const media = createMedia({ matches: false, legacy })
    const fake = createTarget({ media })
    const store = createThemeStore(fake.target)

    store.start()
    store.start()
    assert.equal(media.calls.add, 1)
    assert.equal(media.listenerCount(), 1)
    assert.equal(fake.eventCalls.add, 1)
    assert.equal(fake.listenerCount('storage'), 1)
    assert.equal(fake.storage.calls.get, 2, 'construction and the first start each sample storage once')

    media.emit(true)
    assert.equal(store.getSnapshot().resolvedTheme, 'dark')
    store.stop()
    store.stop()
    assert.equal(media.calls.remove, 1)
    assert.equal(media.listenerCount(), 0)
    assert.equal(fake.eventCalls.remove, 1)
    assert.equal(fake.listenerCount('storage'), 0)

    media.emit(false)
    fake.dispatch('storage', { key: THEME_STORAGE_KEY, newValue: 'light', storageArea: fake.storage })
    assert.equal(store.getSnapshot().resolvedTheme, 'dark', 'events after stop must not change the store')

    store.start()
    assert.equal(media.calls.add, 2)
    assert.equal(fake.eventCalls.add, 2)
    assert.equal(fake.storage.calls.get, 3, 'restart resamples storage exactly once')
    assert.equal(store.getSnapshot().resolvedTheme, 'light')
    store.stop()
  })
}

const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8')
const prepaintSource = indexHtml.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1]
assert.ok(prepaintSource, 'index.html must contain an inline prepaint script')

function runPrepaint({
  stored = null,
  systemDark = false,
  blockedStorage = false,
  withoutMatchMedia = false,
  throwingMatchMedia = false,
} = {}) {
  const document = createDocument()
  const localStorage = createStorage({ value: stored, getError: blockedStorage })
  const sandbox = { document, localStorage }
  if (!withoutMatchMedia) sandbox.matchMedia = (query) => {
    assert.equal(query, THEME_MEDIA_QUERY)
    if (throwingMatchMedia) throw new Error('matchMedia blocked')
    return { matches: systemDark }
  }
  vm.runInNewContext(prepaintSource, sandbox)
  return { appearance: document.read(), localStorage }
}

test('the prepaint bootstrap resolves saved, system, invalid and blocked-storage states like the controller', () => {
  const cases = [
    { name: 'saved dark', stored: 'dark', systemDark: false },
    { name: 'saved light', stored: 'light', systemDark: true },
    { name: 'saved system', stored: 'system', systemDark: true },
    { name: 'invalid saved value', stored: 'sepia', systemDark: false },
    { name: 'missing value', stored: null, systemDark: true },
    { name: 'blocked storage', stored: 'light', systemDark: true, blockedStorage: true },
    { name: 'missing matchMedia', stored: null, systemDark: true, withoutMatchMedia: true },
    { name: 'throwing matchMedia', stored: null, systemDark: true, throwingMatchMedia: true },
  ]

  for (const scenario of cases) {
    const prepaint = runPrepaint(scenario)
    const storage = createStorage({ value: scenario.stored, getError: scenario.blockedStorage })
    const fake = createTarget({
      systemDark: scenario.withoutMatchMedia ? false : scenario.systemDark,
      storage,
      media: scenario.withoutMatchMedia ? undefined : createMedia({ matches: scenario.systemDark }),
    })
    if (scenario.withoutMatchMedia) delete fake.target.matchMedia
    if (scenario.throwingMatchMedia) fake.target.matchMedia = () => { throw new Error('matchMedia blocked') }
    const store = createThemeStore(fake.target)
    store.start()
    assert.deepEqual(prepaint.appearance, fake.document.read(), scenario.name)
    assert.deepEqual(prepaint.appearance, expectedAppearance(store.getSnapshot().resolvedTheme), scenario.name)
    assert.equal(prepaint.localStorage.calls.set, 0, `${scenario.name} must not write during prepaint`)
    store.stop()
  }
})
