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
  const [profileError, setProfileError] = useState<unknown>(null)

  // Guards against a slow profile fetch resolving after the user has signed
  // out or switched accounts, which would leave a stale profile on screen.
  const requestId = useRef(0)

  /**
   * The account the profile in state was settled for — settled meaning the
   * server answered, either with a row or with a definite "no row yet".
   *
   * A failed request does not settle anything, so it never updates this.
   */
  const settledFor = useRef<string | null>(null)

  const loadProfile = useCallback(
    async (activeSession: Session | null, quiet = false) => {
      const id = ++requestId.current

      if (!activeSession) {
        settledFor.current = null
        setProfile(null)
        setProfileError(null)
        setLoading(false)
        return
      }

      try {
        const user = await getCurrentUser()
        if (id !== requestId.current) return
        settledFor.current = activeSession.user.id
        setProfile(user)
        setProfileError(null)
      } catch (err) {
        if (id !== requestId.current) return
        // A failed read is not an answer, and must never be treated as one.
        // Demoting an account that is already set up would put the
        // "create your business" screen in front of its owner, and a second
        // business created there would orphan every record in the first.
        if (settledFor.current !== activeSession.user.id) {
          setProfile(null)
          setProfileError(err)
        }
      } finally {
        if (id === requestId.current && !quiet) setLoading(false)
      }
    },
    [],
  )

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

      // Supabase re-emits SIGNED_IN every time the tab becomes visible again,
      // and on a phone that means every return from WhatsApp or the camera.
      // Showing the sign-in spinner there unmounts the entire app, so a trip
      // someone was half way through typing is gone when they come back. For
      // an account that is already settled, refresh in the background instead:
      // a role change still lands, and nothing on screen is thrown away.
      const quiet = Boolean(nextSession && settledFor.current === nextSession.user.id)
      if (!quiet) setLoading(true)
      void loadProfile(nextSession, quiet)
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

  const retryProfile = useCallback(async () => {
    setLoading(true)
    await refreshProfile()
  }, [refreshProfile])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    settledFor.current = null
    setSession(null)
    setProfile(null)
    setProfileError(null)
  }, [])

  const value = useMemo<AuthState>(
    () => ({ session, profile, loading, profileError, refreshProfile, retryProfile, signOut }),
    [session, profile, loading, profileError, refreshProfile, retryProfile, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
