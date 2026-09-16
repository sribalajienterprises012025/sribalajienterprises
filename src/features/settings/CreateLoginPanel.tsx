import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { controlClass } from '@/components/ui/control'
import { useToast } from '@/hooks/useToast'
import { createStaffLogin, type CreatedStaff } from '@/lib/queries/staff'
import type { InvitableRole } from '@/types'

const ROLE_NOTES: Record<InvitableRole, string> = {
  helper: 'Trips, expenses and invoices. No reports or settings.',
  ca: 'Reads everything and exports. Cannot change any record.',
}

/**
 * Words chosen to be unambiguous when read aloud over a phone: no l/1/I/O/0,
 * and no characters that need a shifted key on a phone keyboard.
 */
const WORDS = [
  'truck', 'route', 'cargo', 'diesel', 'ledger', 'permit', 'bridge', 'convoy',
  'tanker', 'wheel', 'axle', 'depot', 'trailer', 'freight', 'journey', 'engine',
]

function suggestPassword(): string {
  const pick = () => WORDS[Math.floor(Math.random() * WORDS.length)]
  const digits = String(Math.floor(Math.random() * 90) + 10)
  return `${pick()}-${pick()}-${digits}`
}

/**
 * Creates a login outright, for staff who will be handed their credentials
 * rather than setting their own password from an email.
 *
 * The common case in a transport office: the person is standing next to you and
 * may not have a mailbox they check. An invitation is the better path when they
 * do — it never puts a password in anyone else's hands.
 */
export function CreateLoginPanel() {
  const toast = useToast()
  const queryClient = useQueryClient()

  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<InvitableRole>('helper')
  const [password, setPassword] = useState(suggestPassword)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreatedStaff | null>(null)

  const createMutation = useMutation({
    mutationFn: () => createStaffLogin({ email, password, name, role }),
    onSuccess: async (staff) => {
      await queryClient.invalidateQueries({ queryKey: ['staff'] })
      setCreated(staff)
      toast.success(`Login created for ${staff.name}`)
      setEmail('')
      setName('')
    },
    onError: (err: Error) => setError(err.message),
  })

  function submit() {
    setError(null)
    setCreated(null)

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address. It is their username, so it has to be unique.')
      return
    }
    if (password.length < 8) {
      setError('The password needs at least 8 characters.')
      return
    }
    createMutation.mutate()
  }

  return (
    <Card>
      <CardHeader title="Create a login" />
      <CardBody className="space-y-4">
        <p className="text-sm text-slate-600">
          Sets up the account and the password yourself, so you can hand the details
          over directly. There is no confirmation email to click.
        </p>

        <Field label="Email" htmlFor="create_email" required hint="This is their username.">
          <input
            id="create_email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={controlClass()}
            placeholder="office@balajienterprises.in"
          />
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="create_name">
            <input
              id="create_name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={controlClass()}
              placeholder="e.g. Ramesh"
            />
          </Field>

          <Field label="Role" htmlFor="create_role" hint={ROLE_NOTES[role]}>
            <select
              id="create_role"
              value={role}
              onChange={(event) => setRole(event.target.value as InvitableRole)}
              className={controlClass()}
            >
              <option value="helper">Helper</option>
              <option value="ca">CA</option>
            </select>
          </Field>
        </div>

        <Field
          label="Password"
          htmlFor="create_password"
          required
          hint="At least 8 characters. They can change it later from the sign-in screen."
        >
          <div className="flex gap-2">
            <input
              id="create_password"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={`${controlClass()} font-mono`}
            />
            <Button
              variant="secondary"
              onClick={() => setPassword(suggestPassword())}
              aria-label="Suggest a different password"
            >
              New
            </Button>
          </div>
        </Field>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        {created && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-sm font-medium text-emerald-900">
              {created.name} can sign in now
            </p>
            <dl className="mt-2 space-y-1 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-emerald-800">Email</dt>
                <dd className="font-mono text-emerald-900">{created.email}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-emerald-800">Password</dt>
                <dd className="font-mono text-emerald-900">{password}</dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-emerald-800">
              Write this down or send it now — the password is not stored anywhere you
              can read it back, and this box clears when you leave the page.
            </p>
          </div>
        )}

        <Button loading={createMutation.isPending} onClick={submit}>
          Create login
        </Button>

        <p className="text-xs text-slate-400">
          Prefer inviting when they have their own mailbox — they set their own password
          and it never passes through anyone else. An owner cannot be created here;
          promote an existing member instead.
        </p>
      </CardBody>
    </Card>
  )
}
