import { useState, type FormEvent } from 'react'
import { bootstrapBusiness } from '@/lib/queries/business'
import { describeError } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { controlClass } from '@/components/ui/control'

/**
 * Shown once, to an authenticated account that has no public.users row yet.
 * Creating the business and the owner record is a single server-side call so
 * the two can never end up half-created.
 */
export function OnboardingPage() {
  const { session, refreshProfile, signOut } = useAuth()
  const [businessName, setBusinessName] = useState('Balaji Enterprises')
  const [ownerName, setOwnerName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)

    try {
      await bootstrapBusiness(businessName, ownerName)
      await refreshProfile()
    } catch (err) {
      setError(describeError(err))
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-slate-900">One-time setup</h1>
          <p className="mt-1 text-sm text-slate-500">
            Signed in as {session?.user.email}
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <Field
            label="Business name"
            htmlFor="business-name"
            required
            hint="Appears on invoices and reports. You can change it later in Settings."
          >
            <input
              id="business-name"
              required
              value={businessName}
              onChange={(event) => setBusinessName(event.target.value)}
              className={controlClass()}
            />
          </Field>

          <Field label="Your name" htmlFor="owner-name" required>
            <input
              id="owner-name"
              required
              value={ownerName}
              onChange={(event) => setOwnerName(event.target.value)}
              className={controlClass()}
              placeholder="e.g. Jashwanth Goud Alvala"
            />
          </Field>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}

          <Button type="submit" fullWidth size="lg" loading={submitting}>
            Get started
          </Button>

          <button
            type="button"
            onClick={() => void signOut()}
            className="w-full text-center text-sm text-slate-500 hover:text-slate-700"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  )
}
