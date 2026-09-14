import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import { isSecretKeyMistake, isSupabaseConfigured } from '@/lib/supabase'
import { SetupRequiredPage } from '@/features/auth/SetupRequiredPage'
import { AuthProvider } from './AuthProvider'
import { ErrorBoundary } from './ErrorBoundary'
import { ToastProvider } from './ToastProvider'
import { AppRoutes } from './routes'

const IS_DEMO = import.meta.env.VITE_DEMO === '1'

/**
 * The demo is published as a static bundle with no server to rewrite unknown
 * paths, so its deep links live in the hash. Production is served by Cloudflare
 * Pages with a catch-all rewrite, and keeps real URLs.
 */
const Router = IS_DEMO ? HashRouter : BrowserRouter

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data is entered by a handful of people, so aggressive refetching buys
      // nothing on a patchy mobile connection.
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

export function App() {
  // A secret key in a browser bundle is worse than no key at all: it bypasses
  // every RLS policy, so the app refuses to start rather than run with it.
  if (isSecretKeyMistake) {
    return <SetupRequiredPage reason="secret-key" />
  }

  if (!isSupabaseConfigured) {
    return <SetupRequiredPage />
  }

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <Router>
          <AuthProvider>
            <ToastProvider>
              <AppRoutes />
            </ToastProvider>
          </AuthProvider>
        </Router>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
