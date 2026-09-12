import type { ReactNode } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { LoadingState } from '@/components/ui/States'
import { LoginPage } from '@/features/auth/LoginPage'
import { OnboardingPage } from '@/features/auth/OnboardingPage'

/**
 * Three gates, in order: signed in, onboarded, then the app.
 *
 * Handled here rather than with redirects so a half-set-up account cannot land
 * on a data screen and hit a wall of RLS errors.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, profile, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingState label="Signing you in…" />
      </div>
    )
  }

  if (!session) return <LoginPage />
  if (!profile) return <OnboardingPage />

  return <>{children}</>
}
