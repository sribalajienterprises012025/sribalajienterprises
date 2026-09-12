import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { ExpiryPill, Pill } from '@/components/ui/StatusPill'
import { useBusinessId, useIsOwner } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import { describeError } from '@/lib/supabase'
import { daysUntil, formatCurrency, formatPhone } from '@/lib/format'
import { queryKeys } from '@/lib/queries/keys'
import {
  createDriver,
  deleteDriver,
  listDrivers,
  updateDriver,
  type DriverInput,
} from '@/lib/queries/drivers'
import { listVehicles } from '@/lib/queries/vehicles'
import type { Driver } from '@/types'
import { DriverForm } from './DriverForm'
import { DriverMoneySheet } from './DriverMoneySheet'
import { DocumentsSheet } from '@/components/DocumentsSheet'
import { OpeningBalanceSheet } from '@/features/parties/OpeningBalanceSheet'

export function DriversPage() {
  const businessId = useBusinessId()
  const isOwner = useIsOwner()
  const toast = useToast()
  const queryClient = useQueryClient()

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Driver | null>(null)
  const [deleting, setDeleting] = useState<Driver | null>(null)
  const [moneyFor, setMoneyFor] = useState<Driver | null>(null)
  const [docsFor, setDocsFor] = useState<Driver | null>(null)
  const [openingFor, setOpeningFor] = useState<Driver | null>(null)

  const driversQuery = useQuery({
    queryKey: queryKeys.drivers(businessId),
    queryFn: () => listDrivers(businessId),
  })

  const vehiclesQuery = useQuery({
    queryKey: queryKeys.vehicles(businessId),
    queryFn: () => listVehicles(businessId),
  })

  const vehiclesById = useMemo(
    () => new Map((vehiclesQuery.data ?? []).map((vehicle) => [vehicle.id, vehicle])),
    [vehiclesQuery.data],
  )

  const saveMutation = useMutation({
    mutationFn: (input: DriverInput) =>
      editing ? updateDriver(editing.id, input) : createDriver(businessId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.drivers(businessId) })
      toast.success(editing ? 'Driver updated' : 'Driver added')
      closeForm()
    },
    onError: (error) => toast.error(describeError(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDriver(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.drivers(businessId) })
      toast.success('Driver removed')
      setDeleting(null)
    },
    onError: (error) => toast.error(describeError(error)),
  })

  function closeForm() {
    setFormOpen(false)
    setEditing(null)
  }

  return (
    <>
      <PageHeader
        title="Drivers"
        subtitle={driversQuery.data ? `${driversQuery.data.length} on record` : undefined}
        action={
          isOwner ? (
            <Button
              size="sm"
              onClick={() => {
                setEditing(null)
                setFormOpen(true)
              }}
            >
              Add
            </Button>
          ) : undefined
        }
      />

      <div className="px-4 lg:px-6">
        {driversQuery.isPending ? (
          <LoadingState label="Loading drivers…" />
        ) : driversQuery.isError ? (
          <ErrorState error={driversQuery.error} onRetry={() => void driversQuery.refetch()} />
        ) : driversQuery.data.length === 0 ? (
          <EmptyState
            icon="👤"
            title="No drivers yet"
            description="Add drivers to assign them to trips and track advances against their salary."
            action={
              isOwner ? (
                <Button
                  onClick={() => {
                    setEditing(null)
                    setFormOpen(true)
                  }}
                >
                  Add your first driver
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="space-y-2.5">
            {driversQuery.data.map((driver) => (
              <div
                key={driver.id}
                className="rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">{driver.name}</p>
                    <p className="mt-0.5 text-sm text-slate-500">
                      {formatPhone(driver.phone)}
                      {driver.assigned_vehicle_id && (
                        <>
                          {' · '}
                          {vehiclesById.get(driver.assigned_vehicle_id)?.reg_no ?? 'Vehicle'}
                        </>
                      )}
                    </p>
                  </div>
                  {driver.status === 'inactive' && <Pill label="Inactive" tone="neutral" />}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {driver.salary_type === 'fixed' && driver.fixed_salary_amount != null && (
                    <span className="text-xs text-slate-500">
                      {formatCurrency(driver.fixed_salary_amount)}/month
                    </span>
                  )}
                  {driver.salary_type === 'percentage' && driver.fixed_salary_amount != null && (
                    <span className="text-xs text-slate-500">
                      {driver.fixed_salary_amount}% of freight
                    </span>
                  )}
                  {driver.salary_type === 'per_trip' && driver.fixed_salary_amount != null && (
                    <span className="text-xs text-slate-500">
                      {formatCurrency(driver.fixed_salary_amount)}/trip
                    </span>
                  )}
                  <ExpiryPill days={daysUntil(driver.license_expiry)} label="Licence" />
                </div>

                <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                  <Button variant="secondary" size="sm" onClick={() => setMoneyFor(driver)}>
                    Advances &amp; salary
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setDocsFor(driver)}>
                    Papers
                  </Button>
                  {isOwner && (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setEditing(driver)
                          setFormOpen(true)
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setOpeningFor(driver)}
                      >
                        Opening balance
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setDeleting(driver)}>
                        Remove
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {formOpen && (
        <DriverForm
          key={editing?.id ?? 'new'}
          open={formOpen}
          driver={editing}
          vehicles={vehiclesQuery.data ?? []}
          saving={saveMutation.isPending}
          onClose={closeForm}
          onSubmit={(values) => saveMutation.mutate(values)}
        />
      )}

      {moneyFor && (
        <DriverMoneySheet driver={moneyFor} onClose={() => setMoneyFor(null)} />
      )}

      {docsFor && (
        <DocumentsSheet
          ownerType="driver"
          ownerId={docsFor.id}
          title={`Papers \u2014 ${docsFor.name}`}
          onClose={() => setDocsFor(null)}
        />
      )}

      {openingFor && (
        <OpeningBalanceSheet
          partyType="driver"
          partyId={openingFor.id}
          partyName={openingFor.name}
          onClose={() => setOpeningFor(null)}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Remove driver"
        message={`Remove ${deleting?.name}? Trips already logged against them are kept.`}
        confirmLabel="Remove"
        loading={deleteMutation.isPending}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        onCancel={() => setDeleting(null)}
      />
    </>
  )
}
