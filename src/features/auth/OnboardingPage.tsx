import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { bootstrapBusiness } from '@/lib/queries/business'
import { claimInvite, findMyInvite } from '@/lib/queries/staff'
import { describeError } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { controlClass } from '@/components/ui/control'
import { LoadingState } from '@/components/ui/States'
import { roleLabel } from '@/lib/roles'
import type { InvitableRole } from '@/types'
import { queryKeys } from '@/lib/queries/keys'

/**
 * Shown once, to an authenticated account with no profile row yet.
 *
 * Two ways in. If somebody has invited this email address, the account joins
 * their business at the invited role. Otherwise it starts a new business.
 * The invitation is checked first, because a helper who was invited and instead
 * created their own empty business is a mess to unpick afterwards.
 */
export function OnboardingPage() {
  const { session, refreshProfile, signOut } = useAuth()

  const inviteQuery = useQuery({
    queryKey: queryKeys.myInvite,
    queryFn: findMyInvite,
    // A stale "no invitation" answer would send someone down the wrong path,
    // and this is asked exactly once per account.
    staleTime: 0,
  })

  if (inviteQuery.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingState label="Checking for an invitation…" />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-sm">
        {inviteQuery.data ? (
          <AcceptInvite
            businessRole={inviteQuery.data.role}
            email={session?.user.email ?? ''}
            onJoined={refreshProfile}
            onSignOut={signOut}
          />
        ) : (
          <CreateBusiness
            email={session?.user.email ?? ''}
            onCreated={refreshProfile}
            onSignOut={signOut}
          />
        )}
      </div>
    </div>
  )
}

function AcceptInvite({
  businessRole,
  email,
  onJoined,
  onSignOut,
}: {
  // Narrowed to what an invitation can actually carry — an owner is never
  // invited by email, only promoted from an existing member.
  businessRole: InvitableRole
  email: string
  onJoined: () => Promise<void>
  onSignOut: () => Promise<void>
}) {
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function accept() {
    setError(null)
    setSubmitting(true)
    try {
      await claimInvite()
      await onJoined()
    } catch (err) {
      setError(describeError(err))
      setSubmitting(false)
    }
  }

  return (
    <>
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-900 text-lg font-bold text-white">
          BE
        </div>
        <h1 className="text-2xl font-semibold text-slate-900">You have been invited</h1>
        <p className="mt-1 text-sm text-slate-500">Signed in as {email}</p>
      </div>

      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-600">
          You will join as <span className="font-medium text-slate-900">
            {roleLabel(businessRole)}
          </span>
          .
          <span className="mt-1.5 block text-xs text-slate-500">
            {businessRole === 'helper'
              ? 'You can enter trips, expenses and invoices. Reports and settings stay with the owner.'
              : 'You can read everything and export it, but cannot change any record.'}
          </span>
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <Button fullWidth size="lg" loading={submitting} onClick={() => void accept()}>
          Accept and continue
        </Button>

        <button
          type="button"
          onClick={() => void onSignOut()}
          className="w-full text-center text-sm text-slate-500 hover:text-slate-700"
        >
          Sign out
        </button>
      </div>
    </>
  )
}

function CreateBusiness({
  email,
  onCreated,
  onSignOut,
}: {
  email: string
  onCreated: () => Promise<void>
  onSignOut: () => Promise<void>
}) {
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
      await onCreated()
    } catch (err) {
      setError(describeError(err))
      setSubmitting(false)
    }
  }

  return (
    <>
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-semibold text-slate-900">Start a new business</h1>
        <p className="mt-1 text-sm text-slate-500">Signed in as {email}</p>
      </div>

      {/* The mistake this warns about is one nothing on screen explains
          afterwards: two people in the same firm each start their own books,
          and neither can see the other's work, for ever. */}
      <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-medium text-amber-900">
          Does someone at your company already use this app?
        </p>
        <p className="mt-1 text-sm text-amber-800">
          Then do not start a business here. Ask them to add you in{' '}
          <span className="font-medium">Settings → Staff</span>, on this exact email
          address. What you start here is a separate, empty set of books, and their
          trips and accounts will not be in it.
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

        <p className="text-center text-xs text-slate-400">
          Expecting to join an existing business? Make sure you signed up with the exact
          email address you were invited on, then sign out and back in. If you start a
          business here by mistake and enter nothing in it, a later invitation will
          still move this account across.
        </p>

        <button
          type="button"
          onClick={() => void onSignOut()}
          className="w-full text-center text-sm text-slate-500 hover:text-slate-700"
        >
          Sign out
        </button>
      </form>
    </>
  )
}
