import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { controlClass } from '@/components/ui/control'
import { Pill } from '@/components/ui/StatusPill'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { LoadingState } from '@/components/ui/States'
import { useAuth, useBusinessId } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import { describeError } from '@/lib/supabase'
import { formatDate } from '@/lib/format'
import { roleLabel } from '@/lib/roles'
import { queryKeys } from '@/lib/queries/keys'
import {
  createInvite,
  deleteInvite,
  listInvites,
  listStaff,
  removeStaff,
  updateStaffRole,
} from '@/lib/queries/staff'
import type { AppUser, Invite, Role, InvitableRole } from '@/types'
import { CreateLoginPanel } from './CreateLoginPanel'
import { DriverLoginsPanel } from './DriverLoginsPanel'

const ROLE_NOTES: Record<Role, string> = {
  owner: 'Everything, including settings, reports and staff.',
  helper: 'Trips, expenses and invoices. No reports or settings.',
  ca: 'Reads everything and exports. Cannot change any record.',
  driver: 'Their own trips and their own salary. Nothing else in the business.',
}

/**
 * Staff management: who has access, at what role, and how to add someone.
 *
 * Two ways in, because the right one depends on the person. An **invitation**
 * is recorded against an email address and claimed by the invitee when they
 * sign up, which proves they control that address and means no password ever
 * passes through the owner. **Creating a login** sets up the account and
 * password outright, for staff who will be handed their details in person and
 * may not have a mailbox they check.
 *
 * Creating an account needs the admin API, and therefore the secret key, which
 * must never reach a browser — so that path runs in the `create-staff` Edge
 * Function. The app works fully without that function deployed; the create tab
 * then explains how to deploy it and points back at invitations.
 */
export function StaffPanel() {
  const businessId = useBusinessId()
  const { profile } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()

  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<InvitableRole>('helper')
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<AppUser | null>(null)
  const [revoking, setRevoking] = useState<Invite | null>(null)
  const [addMode, setAddMode] = useState<'invite' | 'create' | 'drivers'>('invite')

  const staffQuery = useQuery({
    queryKey: queryKeys.staff(businessId),
    queryFn: () => listStaff(businessId),
  })

  const invitesQuery = useQuery({
    queryKey: queryKeys.invites(businessId),
    queryFn: () => listInvites(businessId),
  })

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['staff'] }),
      queryClient.invalidateQueries({ queryKey: ['invites'] }),
    ])
  }

  const inviteMutation = useMutation({
    mutationFn: () =>
      createInvite(businessId, { email, name: name.trim() || null, role }),
    onSuccess: async () => {
      await refresh()
      toast.success('Invitation created')
      setEmail('')
      setName('')
    },
    onError: (err) => toast.error(describeError(err)),
  })

  const roleMutation = useMutation({
    mutationFn: ({ id, next }: { id: string; next: Role }) => updateStaffRole(id, next),
    onSuccess: async () => {
      await refresh()
      toast.success('Role updated')
    },
    onError: (err) => toast.error(describeError(err)),
  })

  const removeMutation = useMutation({
    mutationFn: (id: string) => removeStaff(id),
    onSuccess: async () => {
      await refresh()
      toast.success('Access removed')
      setRemoving(null)
    },
    onError: (err) => toast.error(describeError(err)),
  })

  const revokeMutation = useMutation({
    mutationFn: (id: string) => deleteInvite(id),
    onSuccess: async () => {
      await refresh()
      toast.success('Invitation revoked')
      setRevoking(null)
    },
    onError: (err) => toast.error(describeError(err)),
  })

  function submitInvite() {
    setError(null)
    const address = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError('Enter a valid email address.')
      return
    }
    if (staffQuery.data?.some((member) => member.name === name.trim())) {
      // Not fatal, just worth flagging before creating a duplicate-looking row.
      toast.error('Someone with that name already has access — check before inviting.')
    }
    inviteMutation.mutate()
  }

  const pending = (invitesQuery.data ?? []).filter((invite) => !invite.accepted_at)

  return (
    <>
      <Card>
        <CardHeader title="Who has access" />
        {staffQuery.isPending ? (
          <CardBody>
            <LoadingState label="Loading staff…" />
          </CardBody>
        ) : (
          <div className="divide-y divide-slate-100">
            {(staffQuery.data ?? []).map((member) => {
              const isSelf = member.id === profile?.id

              return (
                <div key={member.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900">
                        {member.name}
                        {isSelf && (
                          <span className="ml-1.5 text-xs font-normal text-slate-400">
                            (you)
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {ROLE_NOTES[member.role]}
                      </p>
                    </div>
                    <Pill
                      label={roleLabel(member.role)}
                      tone={member.role === 'owner' ? 'info' : 'neutral'}
                    />
                  </div>

                  {!isSelf && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                      {/* A driver's role is not a dropdown. The login is tied to
                          a driver record, and every office role would leave that
                          link dangling — the database refuses it outright. To
                          change what they are, remove the login and add them as
                          staff. */}
                      {member.role === 'driver' ? (
                        <p className="text-xs text-slate-500">
                          Signs in with their mobile number.
                        </p>
                      ) : (
                        <select
                          value={member.role}
                          onChange={(event) =>
                            roleMutation.mutate({
                              id: member.id,
                              next: event.target.value as Role,
                            })
                          }
                          aria-label={`Role for ${member.name}`}
                          className="min-h-[36px] rounded-lg border border-slate-300 bg-white px-2 text-sm"
                        >
                          <option value="owner">Owner</option>
                          <option value="helper">Helper</option>
                          <option value="ca">CA</option>
                        </select>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto"
                        onClick={() => setRemoving(member)}
                      >
                        Remove access
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {pending.length > 0 && (
        <Card>
          <CardHeader title="Pending invitations" />
          <div className="divide-y divide-slate-100">
            {pending.map((invite) => (
              <div
                key={invite.id}
                className="flex items-start justify-between gap-3 p-4"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">{invite.email}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Invited as {roleLabel(invite.role)} on{' '}
                    {formatDate(invite.created_at)}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setRevoking(invite)}>
                  Revoke
                </Button>
              </div>
            ))}
          </div>
          <CardBody className="pt-0">
            <p className="text-xs text-slate-400">
              They join by signing up with this exact email address and accepting the
              invitation on first sign-in.
            </p>
          </CardBody>
        </Card>
      )}

      {/* Two ways to add someone, and the right one depends on whether they have
          a mailbox they actually check. Presented as a choice rather than two
          stacked forms, so it is clear only one applies. */}
      <div className="inline-flex rounded-lg bg-slate-100 p-1">
        <button
          type="button"
          onClick={() => setAddMode('invite')}
          className={[
            'inline-flex min-h-[40px] items-center justify-center rounded-md px-4 text-sm font-medium transition-colors',
            addMode === 'invite'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500',
          ].join(' ')}
        >
          Invite by email
        </button>
        <button
          type="button"
          onClick={() => setAddMode('create')}
          className={[
            'inline-flex min-h-[40px] items-center justify-center rounded-md px-4 text-sm font-medium transition-colors',
            addMode === 'create'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500',
          ].join(' ')}
        >
          Create a login
        </button>
        <button
          type="button"
          onClick={() => setAddMode('drivers')}
          className={[
            'inline-flex min-h-[40px] items-center justify-center rounded-md px-4 text-sm font-medium transition-colors',
            addMode === 'drivers'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500',
          ].join(' ')}
        >
          Drivers
        </button>
      </div>

      {addMode === 'create' && <CreateLoginPanel />}

      {addMode === 'drivers' && <DriverLoginsPanel />}

      {addMode === 'invite' && (
        <Card>
          <CardHeader title="Invite someone" />
          <CardBody className="space-y-4">
            <Field label="Email" htmlFor="invite_email" required>
              <input
                id="invite_email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={controlClass()}
                placeholder="them@example.com"
              />
            </Field>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Name" htmlFor="invite_name">
                <input
                  id="invite_name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className={controlClass()}
                />
              </Field>

              <Field label="Role" htmlFor="invite_role" hint={ROLE_NOTES[role]}>
                <select
                  id="invite_role"
                  value={role}
                  onChange={(event) =>
                    setRole(event.target.value as InvitableRole)
                  }
                  className={controlClass()}
                >
                  <option value="helper">Helper</option>
                  <option value="ca">CA</option>
                </select>
              </Field>
            </div>

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}

            <Button loading={inviteMutation.isPending} onClick={submitInvite}>
              Create invitation
            </Button>

            <p className="text-xs text-slate-400">
              They set their own password, so it never passes through anyone else. An
              owner cannot be invited by email — promote an existing member above
              instead, so adding a second owner is always a deliberate act.
            </p>
          </CardBody>
        </Card>
      )}

      <ConfirmDialog
        open={Boolean(removing)}
        title="Remove access"
        message={
          removing
            ? `${removing.name} will no longer be able to sign in to this business. Everything they entered is kept. Their login account itself is not deleted.`
            : ''
        }
        confirmLabel="Remove access"
        loading={removeMutation.isPending}
        onConfirm={() => removing && removeMutation.mutate(removing.id)}
        onCancel={() => setRemoving(null)}
      />

      <ConfirmDialog
        open={Boolean(revoking)}
        title="Revoke invitation"
        message={
          revoking
            ? `${revoking.email} will no longer be able to join with this invitation.`
            : ''
        }
        confirmLabel="Revoke"
        loading={revokeMutation.isPending}
        onConfirm={() => revoking && revokeMutation.mutate(revoking.id)}
        onCancel={() => setRevoking(null)}
      />
    </>
  )
}
