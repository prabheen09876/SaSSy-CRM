import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['apple-touch-icon.png', 'favicon.png', 'brand-symbol.svg'],
      devOptions: { enabled: true },          // lets you test install/notifications on localhost
      workbox: {
        // The CRM needs live Supabase data and is not useful as a stale offline shell.
        // Keep static assets precached, but always fetch the current HTML from Pages.
        globPatterns: ['**/*.{js,css,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: null,
        // pull our Web Push handlers into the generated SW so reminders show when the app is closed
        importScripts: ['push-sw.js'],
      },
      manifest: {
        name: 'Workspace CRM',
        short_name: 'Workspace CRM',
        description: 'A flexible CRM for contacts, opportunities, and follow-ups.',
        lang: 'en',
        theme_color: '#244878',
        background_color: '#F4F6FA',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: { port: 5174, host: true },         // host:true lets you open it from a phone on the same Wi-Fi
})
