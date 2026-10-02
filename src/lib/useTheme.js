import { useSyncExternalStore } from 'react'
import { themeStore } from './theme.js'

export function useTheme() {
  const theme = useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot, themeStore.getSnapshot)
  return { ...theme, setPreference: themeStore.setPreference }
}
