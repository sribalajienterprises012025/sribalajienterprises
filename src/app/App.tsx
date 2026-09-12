import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { isSupabaseConfigured } from '@/lib/supabase'
import { SetupRequiredPage } from '@/features/auth/SetupRequiredPage'
import { AuthProvider } from './AuthProvider'
import { ToastProvider } from './ToastProvider'
import { AppRoutes } from './routes'

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
  if (!isSupabaseConfigured) {
    return <SetupRequiredPage />
  }

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <AppRoutes />
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
