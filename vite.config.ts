import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

// The demo build (`npm run build:demo`) is a self-contained bundle that talks to
// an in-browser stand-in for Postgres. It is published as static files under an
// unknown path, so asset URLs must be relative and there is no service worker
// to install — a cached shell for a throwaway demo is only a way to serve stale
// code. Production is unaffected.
const isDemo = process.env.VITE_DEMO === '1'

export default defineConfig({
  base: isDemo ? './' : '/',
  plugins: [
    react(),
    VitePWA({
      disable: isDemo,
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'Balaji Enterprises',
        short_name: 'Balaji',
        description: 'Transport, distribution and accounts management',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // The export libraries are ~1.2 MB and are dynamically imported, so
        // precaching them would download the lot on install for a phone that
        // may only ever enter trips. They are fetched on the first export
        // instead, and cached by the runtime rule below.
        globIgnores: [
          '**/xlsx-*.js',
          '**/jspdf*.js',
          '**/jszip*.js',
          '**/html2canvas*.js',
          '**/purify*.js',
          '**/index.es-*.js',
        ],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/(xlsx|jspdf|jszip|html2canvas|purify|index\.es)-.*\.js$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'export-libs',
              expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 90 },
            },
          },
        ],
        // Supabase responses are never precached — for an accounts app a stale
        // balance is worse than no balance. Offline write-queueing is still to come.
        navigateFallbackDenylist: [/^\/api/],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Split the dependencies that never change from the app code, so a
        // deploy only invalidates the small chunk and phones on a weak
        // connection re-download kilobytes rather than the whole bundle.
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          query: ['@tanstack/react-query'],
          forms: ['react-hook-form', '@hookform/resolvers', 'zod'],
        },
      },
    },
  },
  server: {
    port: 5173,
  },
})
