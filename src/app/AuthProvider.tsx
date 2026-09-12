import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { getCurrentUser } from '@/lib/queries/business'
import { AuthContext, type AuthState } from '@/hooks/useAuth'
import type { AppUser } from '@/types'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)

  // Guards against a slow profile fetch resolving after the user has signed
  // out or switched accounts, which would leave a stale profile on screen.
  const requestId = useRef(0)

  const loadProfile = useCallback(async (activeSession: Session | null) => {
    const id = ++requestId.current

    if (!activeSession) {
      setProfile(null)
      setLoading(false)
      return
    }

    try {
      const user = await getCurrentUser()
      if (id === requestId.current) setProfile(user)
    } catch {
      // A failed profile read means "not onboarded" as far as routing is
      // concerned; the onboarding screen surfaces any real error on retry.
      if (id === requestId.current) setProfile(null)
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setSession(data.session)
      void loadProfile(data.session)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return
      setSession(nextSession)

      // TOKEN_REFRESHED fires on a timer and carries the same user; re-reading
      // the profile there would put a network request on a background interval.
      if (event === 'TOKEN_REFRESHED') return

      setLoading(true)
      void loadProfile(nextSession)
    })

    return () => {
      mounted = false
      listener.subscription.unsubscribe()
    }
  }, [loadProfile])

  const refreshProfile = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    setSession(data.session)
    await loadProfile(data.session)
  }, [loadProfile])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setSession(null)
    setProfile(null)
  }, [])

  const value = useMemo<AuthState>(
    () => ({ session, profile, loading, refreshProfile, signOut }),
    [session, profile, loading, refreshProfile, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
