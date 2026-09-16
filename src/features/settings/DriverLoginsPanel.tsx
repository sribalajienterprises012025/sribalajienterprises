import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { controlClass } from '@/components/ui/control'
import { LoadingState } from '@/components/ui/States'
import { useBusinessId } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import { formatPhone } from '@/lib/format'
import { normalisePhone } from '@/lib/driverLogin'
import { queryKeys } from '@/lib/queries/keys'
import { listDrivers } from '@/lib/queries/drivers'
import { createDriverLogin, listStaff } from '@/lib/queries/staff'
import type { Driver } from '@/types'

/**
 * Gives a driver a way into the app.
 *
 * A driver signs in with the mobile number already on their record and a
 * password set here, because a driver with an email address is the exception.
 * Nothing is emailed and nothing is texted — the owner reads the number and
 * password out, or writes them on the back of a card.
 *
 * What the login can reach is decided in the database, not here: their own
 * trips, their own salary and advances, and nothing else in the business. See
 * the driver migration.
 */
export function DriverLoginsPanel() {
  const businessId = useBusinessId()
  const toast = useToast()
  const queryClient = useQueryClient()

  const [openFor, setOpenFor] = useState<Driver | null>(null)
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ name: string; phone: string; password: string } | null>(
    null,
  )

  const driversQuery = useQuery({
    queryKey: queryKeys.drivers(businessId),
    queryFn: () => listDrivers(businessId),
  })

  const staffQuery = useQuery({
    queryKey: queryKeys.staff(businessId),
    queryFn: () => listStaff(businessId),
  })

  // Which driver records already have someone signing in as them.
  const linked = useMemo(
    () => new Set((staffQuery.data ?? []).map((member) => member.driver_id).filter(Boolean)),
    [staffQuery.data],
  )

  const createMutation = useMutation({
    mutationFn: () =>
      createDriverLogin({
        driverId: openFor!.id,
        phone: normalisePhone(phone),
        password,
        name: openFor!.name,
      }),
    onSuccess: async (staff) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.staff(businessId) })
      setCreated({ name: staff.name, phone: normalisePhone(phone), password })
      toast.success(`${staff.name} can sign in now`)
      setOpenFor(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  function start(driver: Driver) {
    setOpenFor(driver)
    setPhone(driver.phone ?? '')
    setPassword('')
    setError(null)
    setCreated(null)
  }

  function submit() {
    setError(null)

    if (normalisePhone(phone).length < 10) {
      setError('Enter the 10-digit mobile number they will sign in with.')
      return
    }
    if (password.length < 8) {
      setError('The password needs at least 8 characters.')
      return
    }
    createMutation.mutate()
  }

  const drivers = driversQuery.data ?? []

  return (
    <Card>
      <CardHeader title="Driver logins" />
      <CardBody className="space-y-4">
        <p className="text-sm text-slate-600">
          A driver signs in with their mobile number and a password you set. They see
          the trips assigned to them, enter meter readings, diesel and toll, and their
          own salary and advances — nothing else in the business, and no rates.
        </p>

        {driversQuery.isPending && <LoadingState label="Loading drivers…" />}

        {driversQuery.isSuccess && drivers.length === 0 && (
          <p className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-500">
            Add a driver on the Drivers screen first, then give them a login here.
          </p>
        )}

        {drivers.length > 0 && (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
            {drivers.map((driver) => {
              const hasLogin = linked.has(driver.id)
              return (
                <li key={driver.id} className="px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">{driver.name}</p>
                      <p className="text-xs text-slate-500">
                        {driver.phone ? formatPhone(driver.phone) : 'No number on record'}
                      </p>
                    </div>
                    {hasLogin ? (
                      <span className="shrink-0 text-xs font-medium text-emerald-700">
                        Has a login
                      </span>
                    ) : (
                      <Button variant="secondary" size="sm" onClick={() => start(driver)}>
                        Give a login
                      </Button>
                    )}
                  </div>

                  {openFor?.id === driver.id && (
                    <div className="mt-3 space-y-3 rounded-lg bg-slate-50 p-3">
                      <Field
                        label="Mobile number"
                        htmlFor="driver_phone"
                        required
                        hint="This is their username."
                      >
                        <input
                          id="driver_phone"
                          type="tel"
                          inputMode="numeric"
                          value={phone}
                          onChange={(event) => setPhone(event.target.value)}
                          className={controlClass()}
                          placeholder="9876543210"
                        />
                      </Field>

                      <Field
                        label="Password"
                        htmlFor="driver_password"
                        required
                        hint="At least 8 characters. Read it out to them."
                      >
                        <input
                          id="driver_password"
                          type="text"
                          autoComplete="off"
                          spellCheck={false}
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                          className={`${controlClass()} font-mono`}
                        />
                      </Field>

                      {error && (
                        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                          {error}
                        </p>
                      )}

                      <div className="flex gap-2">
                        <Button loading={createMutation.isPending} onClick={submit}>
                          Create login
                        </Button>
                        <Button variant="ghost" onClick={() => setOpenFor(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {created && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-sm font-medium text-emerald-900">
              {created.name} can sign in now
            </p>
            <dl className="mt-2 space-y-1 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-emerald-800">Mobile number</dt>
                <dd className="font-mono text-emerald-900">{created.phone}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-emerald-800">Password</dt>
                <dd className="font-mono text-emerald-900">{created.password}</dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-emerald-800">
              Tell them to open the app, tap “Driver? Sign in with your mobile number”,
              and enter these. Write them down now — the password cannot be read back.
            </p>
          </div>
        )}

        <p className="text-xs text-slate-400">
          To stop a driver signing in, remove their access from the list above. The
          driver record, their trips and their salary history all stay.
        </p>
      </CardBody>
    </Card>
  )
}
