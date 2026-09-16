import { useState, type FormEvent } from 'react'
import { supabase, describeError } from '@/lib/supabase'
import { driverEmail, normalisePhone } from '@/lib/driverLogin'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { controlClass } from '@/components/ui/control'

type Mode = 'sign_in' | 'sign_up' | 'driver'

export function LoginPage() {
  const [mode, setMode] = useState<Mode>('sign_in')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    setSubmitting(true)

    try {
      if (mode === 'driver') {
        // The driver types the number the owner entered for them; the address
        // is built from it here exactly as create-staff built it there.
        const digits = normalisePhone(phone)
        if (digits.length < 10) {
          throw new Error('Enter your 10-digit mobile number.')
        }
        const { error: driverError } = await supabase.auth.signInWithPassword({
          email: driverEmail(digits),
          password,
        })
        if (driverError) {
          throw new Error(
            'That number and password do not match. Check with the office — they set it up.',
          )
        }
      } else if (mode === 'sign_in') {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        })
        if (signInError) throw signInError
        // A successful sign-in updates the auth session; AuthProvider picks it
        // up and the router swaps this screen out.
      } else {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        })
        if (signUpError) throw signUpError

        // With email confirmation switched on, Supabase returns a user but no
        // session. Nothing more can happen until the link is clicked.
        if (!data.session) {
          setNotice('Check your email for a confirmation link, then sign in.')
          setMode('sign_in')
        }
      }
    } catch (err) {
      setError(describeError(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-900 text-lg font-bold text-white">
            BE
          </div>
          <h1 className="text-2xl font-semibold text-slate-900">Balaji Enterprises</h1>
          <p className="mt-1 text-sm text-slate-500">Transport, distribution &amp; accounts</p>
        </div>

        <form
          onSubmit={onSubmit}
          className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          {mode === 'driver' ? (
            <Field label="Mobile number" htmlFor="phone" required>
              <input
                id="phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                required
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                className={controlClass()}
                placeholder="9876543210"
              />
            </Field>
          ) : (
            <Field label="Email" htmlFor="email" required>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={controlClass()}
                placeholder="you@example.com"
              />
            </Field>
          )}

          <Field
            label="Password"
            htmlFor="password"
            required
            hint={
              mode === 'sign_up'
                ? 'At least 6 characters'
                : mode === 'driver'
                  ? 'The one the office gave you'
                  : undefined
            }
          >
            <input
              id="password"
              type="password"
              autoComplete={mode === 'sign_up' ? 'new-password' : 'current-password'}
              required
              minLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={controlClass()}
              placeholder="••••••••"
            />
          </Field>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}
          {notice && (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {notice}
            </p>
          )}

          <Button type="submit" fullWidth size="lg" loading={submitting}>
            {mode === 'sign_up' ? 'Create account' : 'Sign in'}
          </Button>

          {mode !== 'driver' && (
            <button
              type="button"
              onClick={() => {
                setMode(mode === 'sign_in' ? 'sign_up' : 'sign_in')
                setError(null)
                setNotice(null)
              }}
              className="w-full text-center text-sm text-slate-500 hover:text-slate-700"
            >
              {mode === 'sign_in'
                ? 'First time here? Create an account'
                : 'Already have an account? Sign in'}
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setMode(mode === 'driver' ? 'sign_in' : 'driver')
              setError(null)
              setNotice(null)
            }}
            className="w-full border-t border-slate-100 pt-3 text-center text-sm font-medium text-brand-700"
          >
            {mode === 'driver'
              ? 'Office staff sign in'
              : 'Driver? Sign in with your mobile number'}
          </button>
        </form>
      </div>
    </div>
  )
}
