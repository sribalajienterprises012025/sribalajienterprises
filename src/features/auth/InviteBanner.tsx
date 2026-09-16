import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/hooks/useAuth'
import { describeError } from '@/lib/supabase'
import { roleLabel } from '@/lib/roles'
import { claimInvite, findInviteAddressedTo } from '@/lib/queries/staff'

/**
 * Offers an invitation to someone who is already signed in.
 *
 * The situation it exists for: two people in the same firm each sign up, each
 * is offered "create your business" because nobody had invited them yet, and
 * each ends up with their own separate books. Neither can see the other's
 * work, and nothing on screen explains why — the tenancy rule is doing its job
 * perfectly.
 *
 * The owner invites them properly, and this is how they find out. Accepting
 * moves the account across; if the books it is leaving are empty, they are
 * removed with it. If work has been entered in them, the database refuses and
 * says so, because joining would strand that work where nobody can reach it.
 */
export function InviteBanner() {
  const { session, profile, refreshProfile } = useAuth()
  const email = session?.user.email ?? ''
  const [error, setError] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)

  const inviteQuery = useQuery({
    queryKey: ['invite-for', email],
    queryFn: () => findInviteAddressedTo(email),
    enabled: email !== '' && profile != null,
    staleTime: 60_000,
  })

  const joinMutation = useMutation({
    mutationFn: claimInvite,
    onSuccess: async () => {
      setError(null)
      await refreshProfile()
      // Everything on screen belongs to the business just left.
      window.location.reload()
    },
    onError: (err) => setError(describeError(err)),
  })

  const invite = inviteQuery.data
  if (!invite || dismissed) return null
  // An invitation into the business they are already in is not news.
  if (invite.business_id === profile?.business_id) return null

  return (
    <div className="border-b border-amber-200 bg-amber-50">
      <div className="mx-auto max-w-5xl px-4 py-3 lg:px-6">
        <p className="text-sm text-amber-900">
          You have been invited to join another set of books as{' '}
          <span className="font-medium">{roleLabel(invite.role)}</span>. Accepting
          moves this account across, and you will see that business&rsquo;s trips and
          accounts instead of these.
        </p>

        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}

        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            size="sm"
            loading={joinMutation.isPending}
            onClick={() => joinMutation.mutate()}
          >
            Join
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>
            Not now
          </Button>
        </div>
      </div>
    </div>
  )
}
