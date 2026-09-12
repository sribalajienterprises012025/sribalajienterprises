import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { controlClass } from '@/components/ui/control'
import { ErrorState, LoadingState } from '@/components/ui/States'
import { useAuth, useBusinessId } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import { describeError } from '@/lib/supabase'
import { humanize } from '@/lib/format'
import { queryKeys } from '@/lib/queries/keys'
import { getBusiness, updateBusiness } from '@/lib/queries/business'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function SettingsPage() {
  const businessId = useBusinessId()
  const { profile, session, signOut } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()

  const businessQuery = useQuery({
    queryKey: queryKeys.business(businessId),
    queryFn: () => getBusiness(businessId),
  })

  const [form, setForm] = useState({
    name: '',
    gstin: '',
    pan: '',
    address: '',
    fy_start_month: 4,
  })

  // Seeded from the query rather than held as form defaults, so a refetch after
  // saving does not leave the inputs showing stale values.
  useEffect(() => {
    const business = businessQuery.data
    if (!business) return
    setForm({
      name: business.name,
      gstin: business.gstin ?? '',
      pan: business.pan ?? '',
      address: business.address ?? '',
      fy_start_month: business.fy_start_month,
    })
  }, [businessQuery.data])

  const saveMutation = useMutation({
    mutationFn: () =>
      updateBusiness(businessId, {
        name: form.name.trim(),
        gstin: form.gstin.trim().toUpperCase() || null,
        pan: form.pan.trim().toUpperCase() || null,
        address: form.address.trim() || null,
        fy_start_month: form.fy_start_month,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.business(businessId) })
      toast.success('Settings saved')
    },
    onError: (error) => toast.error(describeError(error)),
  })

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    saveMutation.mutate()
  }

  return (
    <>
      <PageHeader title="Settings" subtitle="Business details used on invoices and reports" />

      <div className="space-y-4 px-4 pb-4 lg:max-w-2xl lg:px-6">
        {businessQuery.isPending ? (
          <LoadingState />
        ) : businessQuery.isError ? (
          <ErrorState
            error={businessQuery.error}
            onRetry={() => void businessQuery.refetch()}
          />
        ) : (
          <Card>
            <CardHeader title="Business" />
            <CardBody>
              <form onSubmit={onSubmit} className="space-y-4">
                <Field label="Business name" htmlFor="name" required>
                  <input
                    id="name"
                    required
                    value={form.name}
                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                    className={controlClass()}
                  />
                </Field>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="GSTIN" htmlFor="gstin">
                    <input
                      id="gstin"
                      autoCapitalize="characters"
                      placeholder="36AAAPA1234A1Z5"
                      value={form.gstin}
                      onChange={(event) => setForm({ ...form, gstin: event.target.value })}
                      className={controlClass()}
                    />
                  </Field>

                  <Field label="PAN" htmlFor="pan">
                    <input
                      id="pan"
                      autoCapitalize="characters"
                      placeholder="AAAPA1234A"
                      value={form.pan}
                      onChange={(event) => setForm({ ...form, pan: event.target.value })}
                      className={controlClass()}
                    />
                  </Field>
                </div>

                <Field label="Address" htmlFor="address">
                  <textarea
                    id="address"
                    rows={3}
                    value={form.address}
                    onChange={(event) => setForm({ ...form, address: event.target.value })}
                    className={`${controlClass()} min-h-[88px]`}
                  />
                </Field>

                <Field
                  label="Financial year starts"
                  htmlFor="fy_start_month"
                  hint="April for the standard Indian financial year."
                >
                  <select
                    id="fy_start_month"
                    value={form.fy_start_month}
                    onChange={(event) =>
                      setForm({ ...form, fy_start_month: Number(event.target.value) })
                    }
                    className={controlClass()}
                  >
                    {MONTHS.map((month, index) => (
                      <option key={month} value={index + 1}>
                        {month}
                      </option>
                    ))}
                  </select>
                </Field>

                <Button type="submit" loading={saveMutation.isPending}>
                  Save changes
                </Button>
              </form>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader title="Your account" />
          <CardBody className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Name</span>
              <span className="font-medium text-slate-900">{profile?.name}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Email</span>
              <span className="font-medium text-slate-900">{session?.user.email}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Role</span>
              <span className="font-medium text-slate-900">{humanize(profile?.role)}</span>
            </div>
            <Button variant="secondary" onClick={() => void signOut()}>
              Sign out
            </Button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Staff access" />
          <CardBody>
            <p className="text-sm text-slate-600">
              Helpers can enter trips, expenses and invoices. A CA can read everything
              and export, but cannot change records.
            </p>
            <p className="mt-2 text-sm text-slate-500">
              Inviting staff from inside the app arrives in Phase 5. Until then, add the
              user in Supabase Auth and insert a matching row in{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">public.users</code>{' '}
              with your business id and their role.
            </p>
          </CardBody>
        </Card>
      </div>
    </>
  )
}
