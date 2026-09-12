import { createRoot } from 'react-dom/client'
import { DemoBar } from './DemoBar'

/**
 * Mounts the demo strip above the app, in a root of its own.
 *
 * Nothing in `src/app` or `src/features` knows the demo exists, so the screens
 * on show are the ones that run against Postgres, unchanged.
 */
export function mountDemoBar(): void {
  const host = document.createElement('div')
  host.id = 'demo-bar'
  document.body.insertBefore(host, document.body.firstChild)
  createRoot(host).render(<DemoBar />)
}
