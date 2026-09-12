import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import './index.css'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element #root is missing from index.html')
}

/**
 * Both branches are dynamic so the one that does not apply is removed at build
 * time: `VITE_DEMO` is inlined as a literal, which leaves dead code Rollup
 * drops along with the module it imports. A production bundle therefore carries
 * no demo backend, and a demo bundle registers no service worker.
 */
async function bootstrap() {
  if (import.meta.env.VITE_DEMO === '1') {
    // Must be installed before React mounts: the first thing AuthProvider does
    // is read the session, and in the demo that session is one this creates.
    const { installDemoBackend } = await import('./demo/backend')
    installDemoBackend()
    const { mountDemoBar } = await import('./demo/mount')
    mountDemoBar()
  } else {
    // Installs the service worker and swaps in a new build as soon as one is
    // available, so a phone left on the home screen does not sit on stale code.
    const { registerSW } = await import('virtual:pwa-register')
    registerSW({ immediate: true })
  }

  createRoot(rootElement!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void bootstrap()
