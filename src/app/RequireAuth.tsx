import type { ReactNode } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'
import { describeError } from '@/lib/supabase'
import { LoadingState } from '@/components/ui/States'
import { LoginPage } from '@/features/auth/LoginPage'
import { OnboardingPage } from '@/features/auth/OnboardingPage'

/**
 * Four gates, in order: signed in, reachable, onboarded, then the app.
 *
 * Handled here rather than with redirects so a half-set-up account cannot land
 * on a data screen and hit a wall of RLS errors.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, profile, loading, profileError, retryProfile } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingState label="Signing you in…" />
      </div>
    )
  }

  if (!session) return <LoginPage />

  // Signed in, but the server could not be asked who this is. That is not the
  // same as a new account, and must not be answered with "create a business" —
  // doing so on a phone that dropped its connection for a moment would strand
  // an entire set of records in a business nobody looks at again.
  if (!profile && profileError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <div className="w-full max-w-sm space-y-3 rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-2xl">
            📡
          </div>
          <p className="text-sm font-medium text-slate-900">Could not reach your records</p>
          <p className="text-sm text-slate-500">
            You are still signed in. This is usually the connection — your data is
            safe on the server.
          </p>
          <p className="text-xs text-slate-400">{describeError(profileError)}</p>
          <Button fullWidth variant="secondary" onClick={() => void retryProfile()}>
            Try again
          </Button>
        </div>
      </div>
    )
  }

  if (!profile) return <OnboardingPage />

  return <>{children}</>
}
