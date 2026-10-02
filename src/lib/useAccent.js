import { useSyncExternalStore } from 'react'
import { accentStore } from './accent.js'

export function useAccent() {
  const accent = useSyncExternalStore(accentStore.subscribe, accentStore.getSnapshot, accentStore.getSnapshot)
  return { ...accent, setColor: accentStore.setColor }
}
