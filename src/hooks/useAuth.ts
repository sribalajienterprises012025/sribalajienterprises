import { createContext, useContext } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { AppUser, Role } from '@/types'

export interface AuthState {
  /** Supabase Auth session. null when signed out. */
  session: Session | null
  /** public.users row. null when signed in but not yet onboarded. */
  profile: AppUser | null
  /** True until the initial session + profile lookup settles. */
  loading: boolean
  /** Re-reads the profile, e.g. straight after onboarding. */
  refreshProfile: () => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthState | undefined>(undefined)

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used inside <AuthProvider>')
  }
  return context
}

/**
 * The signed-in user's business id.
 *
 * Throws when called outside an onboarded session. Screens behind <RequireAuth>
 * always have one, so this saves every caller a null check on a value that is
 * needed in almost every query.
 */
export function useBusinessId(): string {
  const { profile } = useAuth()
  if (!profile) {
    throw new Error('useBusinessId called before onboarding completed')
  }
  return profile.business_id
}

export function useRole(): Role | null {
  const { profile } = useAuth()
  return profile?.role ?? null
}

/** Write access to trips, expenses and invoices. Owners and helpers. */
export function useCanEdit(): boolean {
  const role = useRole()
  return role === 'owner' || role === 'helper'
}

/** Write access to master data, settings and reports. Owners only. */
export function useIsOwner(): boolean {
  return useRole() === 'owner'
}
