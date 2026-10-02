import React from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App.jsx'
import SaasRoot from './components/SaasRoot.jsx'
import { isSaas } from './lib/supabase'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { themeStore } from './lib/theme.js'
import { accentStore } from './lib/accent.js'
import './styles.css'

themeStore.start()
accentStore.start()
if (import.meta.hot) import.meta.hot.dispose(() => { accentStore.stop(); themeStore.stop() })

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() { updateSW(true) },
})

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      {isSaas ? <SaasRoot /> : <App />}
    </ErrorBoundary>
  </React.StrictMode>
)
