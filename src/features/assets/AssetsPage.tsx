import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Pill } from '@/components/ui/StatusPill'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useBusinessId, useCanEdit, useIsOwner } from '@/hooks/useAuth'
import { useMasterData } from '@/hooks/useMasterData'
import { useToast } from '@/hooks/useToast'
import { describeError } from '@/lib/supabase'
import { formatCurrency, formatDate, formatKm, formatNumber, humanize } from '@/lib/format'
import { queryKeys } from '@/lib/queries/keys'
import {
  deleteSchedule,
  listClaims,
  listMaintenance,
  listServiceDue,
} from '@/lib/queries/assetCare'
import type { ServiceDueRow, ServiceStatus } from '@/types'
import { serviceLabel } from './serviceTypes'
import { ScheduleForm } from './ScheduleForm'
import { CompleteServiceSheet } from './CompleteServiceSheet'
import { ClaimForm } from './ClaimForm'

type Tab = 'due' | 'history' | 'claims'

const STATUS_TONES: Record<ServiceStatus, 'neutral' | 'warning' | 'danger' | 'success'> = {
  ok: 'success',
  due_soon: 'warning',
  overdue: 'danger',
  not_started: 'neutral',
}

const STATUS_LABELS: Record<ServiceStatus, string> = {
  ok: 'OK',
  due_soon: 'Due soon',
  overdue: 'Overdue',
  not_started: 'Not started',
}

export function AssetsPage() {
  const [tab, setTab] = useState<Tab>('due')

  return (
    <>
      <PageHeader
        title="Asset care"
        subtitle="Service by kilometres, workshop history and insurance claims"
      />

      <div className="px-4 lg:px-6">
        <div className="mb-4 inline-flex rounded-lg bg-slate-100 p-1">
          {(
            [
              ['due', 'Due'],
              ['history', 'History'],
              ['claims', 'Claims'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={[
                'rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
                tab === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'due' && <ServiceDue />}
        {tab === 'history' && <MaintenanceHistory />}
        {tab === 'claims' && <Claims />}
      </div>
    </>
  )
}

function ServiceDue() {
  const businessId = useBusinessId()
  const isOwner = useIsOwner()
  const canEdit = useCanEdit()
  const toast = useToast()
  const queryClient = useQueryClient()
  const { vehicles } = useMasterData()

  const [formOpen, setFormOpen] = useState(false)
  const [completing, setCompleting] = useState<ServiceDueRow | null>(null)
  const [deleting, setDeleting] = useState<ServiceDueRow | null>(null)

  const dueQuery = useQuery({
    queryKey: queryKeys.serviceDue(businessId),
    queryFn: () => listServiceDue(businessId),
  })

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['service-due'] }),
      queryClient.invalidateQueries({ queryKey: ['maintenance'] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.vehicles(businessId) }),
    ])
  }

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSchedule(id),
    onSuccess: async () => {
      await refresh()
      toast.success('Schedule removed')
      setDeleting(null)
    },
    onError: (error) => toast.error(describeError(error)),
  })

  // Overdue first, then due soon — the order the workshop needs them in.
  const sorted = useMemo(() => {
    const weight: Record<ServiceStatus, number> = {
      overdue: 0,
      due_soon: 1,
      not_started: 2,
      ok: 3,
    }
    return [...(dueQuery.data ?? [])].sort((a, b) => {
      const byStatus = weight[a.status] - weight[b.status]
      if (byStatus !== 0) return byStatus
      return (a.km_remaining ?? Infinity) - (b.km_remaining ?? Infinity)
    })
  }, [dueQuery.data])

  const counts = useMemo(() => {
    const rows = dueQuery.data ?? []
    return {
      overdue: rows.filter((row) => row.status === 'overdue').length,
      dueSoon: rows.filter((row) => row.status === 'due_soon').length,
    }
  }, [dueQuery.data])

  if (dueQuery.isPending) return <LoadingState label="Checking schedules…" />
  if (dueQuery.isError) {
    return <ErrorState error={dueQuery.error} onRetry={() => void dueQuery.refetch()} />
  }

  return (
    <>
      {(counts.overdue > 0 || counts.dueSoon > 0) && (
        <div className="mb-3 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">Overdue</p>
            <p className="mt-1 text-xl font-semibold text-red-600">{counts.overdue}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">Due soon</p>
            <p className="mt-1 text-xl font-semibold text-amber-600">{counts.dueSoon}</p>
          </div>
        </div>
      )}

      {isOwner && vehicles.length > 0 && (
        <div className="mb-3">
          <Button size="sm" onClick={() => setFormOpen(true)}>
            Add schedule
          </Button>
        </div>
      )}

      {sorted.length === 0 ? (
        <EmptyState
          icon="🔧"
          title="No service schedules yet"
          description="Set an interval per truck — engine oil every 15,000 km, greasing every 30 days — and the app works out what is due from the odometer your trips already keep current."
          action={
            isOwner && vehicles.length > 0 ? (
              <Button onClick={() => setFormOpen(true)}>Add your first schedule</Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-2.5 pb-4">
          {sorted.map((row) => (
            <div key={row.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">
                    {serviceLabel(row.service_type)}
                  </p>
                  <p className="mt-0.5 text-sm text-slate-500">
                    {row.reg_no} · now at {formatNumber(row.current_odometer)} km
                  </p>
                </div>
                <Pill label={STATUS_LABELS[row.status]} tone={STATUS_TONES[row.status]} />
              </div>

              <div className="mt-3 border-t border-slate-100 pt-3">
                {row.status === 'not_started' ? (
                  <p className="text-sm text-slate-500">
                    Never marked done, so there is no baseline to measure from. Complete it
                    once to start the clock.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {row.due_at_odometer != null && (
                      <p className="text-sm text-slate-600">
                        Due at {formatNumber(row.due_at_odometer)} km
                        {row.km_remaining != null && (
                          <span
                            className={[
                              'ml-1.5 font-medium',
                              row.km_remaining < 0
                                ? 'text-red-600'
                                : row.km_remaining <= 1000
                                  ? 'text-amber-600'
                                  : 'text-slate-500',
                            ].join(' ')}
                          >
                            (
                            {row.km_remaining < 0
                              ? `${formatKm(Math.abs(row.km_remaining))} over`
                              : `${formatKm(row.km_remaining)} to go`}
                            )
                          </span>
                        )}
                      </p>
                    )}
                    {row.due_on_date != null && (
                      <p className="text-sm text-slate-600">
                        Due on {formatDate(row.due_on_date)}
                        {row.days_remaining != null && (
                          <span
                            className={[
                              'ml-1.5 font-medium',
                              row.days_remaining < 0
                                ? 'text-red-600'
                                : row.days_remaining <= 15
                                  ? 'text-amber-600'
                                  : 'text-slate-500',
                            ].join(' ')}
                          >
                            (
                            {row.days_remaining < 0
                              ? `${Math.abs(row.days_remaining)} days over`
                              : `${row.days_remaining} days`}
                            )
                          </span>
                        )}
                      </p>
                    )}
                    {row.last_done_date && (
                      <p className="text-xs text-slate-400">
                        Last done {formatDate(row.last_done_date)}
                        {row.last_done_odometer != null &&
                          ` at ${formatNumber(row.last_done_odometer)} km`}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {canEdit && (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                  <Button size="sm" onClick={() => setCompleting(row)}>
                    Mark done
                  </Button>
                  {isOwner && (
                    <Button variant="ghost" size="sm" onClick={() => setDeleting(row)}>
                      Remove
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {formOpen && (
        <ScheduleForm
          vehicles={vehicles}
          onClose={() => setFormOpen(false)}
          onSaved={async () => {
            await refresh()
            setFormOpen(false)
          }}
        />
      )}

      {completing && (
        <CompleteServiceSheet
          schedule={completing}
          onClose={() => setCompleting(null)}
          onSaved={async () => {
            await refresh()
            setCompleting(null)
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Remove schedule"
        message={
          deleting
            ? `Stop tracking ${serviceLabel(deleting.service_type)} on ${deleting.reg_no}? The workshop entries already logged are kept.`
            : ''
        }
        confirmLabel="Remove"
        loading={deleteMutation.isPending}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        onCancel={() => setDeleting(null)}
      />
    </>
  )
}

function MaintenanceHistory() {
  const businessId = useBusinessId()
  const { vehicles } = useMasterData()
  const [vehicleId, setVehicleId] = useState('')

  const historyQuery = useQuery({
    queryKey: queryKeys.maintenance(businessId, vehicleId || undefined),
    queryFn: () => listMaintenance(businessId, vehicleId || undefined),
  })

  const vehiclesById = useMemo(
    () => new Map(vehicles.map((vehicle) => [vehicle.id, vehicle.reg_no])),
    [vehicles],
  )

  const total = useMemo(
    () => (historyQuery.data ?? []).reduce((sum, entry) => sum + entry.cost, 0),
    [historyQuery.data],
  )

  if (historyQuery.isPending) return <LoadingState label="Loading history…" />
  if (historyQuery.isError) {
    return (
      <ErrorState error={historyQuery.error} onRetry={() => void historyQuery.refetch()} />
    )
  }

  return (
    <div className="space-y-3 pb-4">
      <select
        value={vehicleId}
        onChange={(event) => setVehicleId(event.target.value)}
        aria-label="Filter by vehicle"
        className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-brand-500"
      >
        <option value="">All vehicles</option>
        {vehicles.map((vehicle) => (
          <option key={vehicle.id} value={vehicle.id}>
            {vehicle.reg_no}
          </option>
        ))}
      </select>

      <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3">
        <span className="text-sm text-slate-500">Spent on upkeep</span>
        <span className="text-lg font-semibold text-slate-900">{formatCurrency(total)}</span>
      </div>

      {historyQuery.data.length === 0 ? (
        <EmptyState
          icon="🧰"
          title="No workshop entries yet"
          description="Marking a service done from the Due tab logs it here with its cost."
        />
      ) : (
        <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {historyQuery.data.map((entry) => (
            <div key={entry.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">{humanize(entry.type)}</p>
                  <p className="mt-0.5 truncate text-sm text-slate-500">
                    {formatDate(entry.date)} · {vehiclesById.get(entry.vehicle_id) ?? 'Vehicle'}
                    {entry.odometer_reading != null &&
                      ` · ${formatNumber(entry.odometer_reading)} km`}
                  </p>
                  {(entry.vendor || entry.note) && (
                    <p className="mt-1 truncate text-xs text-slate-400">
                      {[entry.vendor, entry.note].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
                <p className="shrink-0 font-semibold text-slate-900">
                  {formatCurrency(entry.cost)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Claims() {
  const businessId = useBusinessId()
  const isOwner = useIsOwner()
  const queryClient = useQueryClient()
  const { vehicles } = useMasterData()
  const [formOpen, setFormOpen] = useState(false)

  const claimsQuery = useQuery({
    queryKey: queryKeys.claims(businessId),
    queryFn: () => listClaims(businessId),
  })

  const vehiclesById = useMemo(
    () => new Map(vehicles.map((vehicle) => [vehicle.id, vehicle.reg_no])),
    [vehicles],
  )

  if (claimsQuery.isPending) return <LoadingState label="Loading claims…" />
  if (claimsQuery.isError) {
    return <ErrorState error={claimsQuery.error} onRetry={() => void claimsQuery.refetch()} />
  }

  return (
    <>
      {isOwner && vehicles.length > 0 && (
        <div className="mb-3">
          <Button size="sm" onClick={() => setFormOpen(true)}>
            File a claim
          </Button>
        </div>
      )}

      {claimsQuery.data.length === 0 ? (
        <EmptyState
          icon="📄"
          title="No insurance claims"
          description="File one here to track it from filed through to settled, and to see the shortfall against what you claimed."
          action={
            isOwner && vehicles.length > 0 ? (
              <Button onClick={() => setFormOpen(true)}>File a claim</Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-2.5 pb-4">
          {claimsQuery.data.map((claim) => {
            const shortfall =
              claim.settlement_amount != null
                ? claim.claim_amount - claim.settlement_amount
                : null

            return (
              <div key={claim.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">
                      {vehiclesById.get(claim.vehicle_id) ?? 'Vehicle'}
                    </p>
                    <p className="mt-0.5 text-sm text-slate-500">
                      {formatDate(claim.claim_date)}
                    </p>
                  </div>
                  <Pill
                    label={humanize(claim.status)}
                    tone={
                      claim.status === 'settled'
                        ? 'success'
                        : claim.status === 'rejected'
                          ? 'danger'
                          : claim.status === 'under_review'
                            ? 'info'
                            : 'neutral'
                    }
                  />
                </div>

                {claim.incident_note && (
                  <p className="mt-2 text-sm text-slate-600">{claim.incident_note}</p>
                )}

                <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">
                      Claimed
                    </p>
                    <p className="text-sm font-semibold text-slate-900">
                      {formatCurrency(claim.claim_amount)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">
                      Settled
                    </p>
                    <p className="text-sm font-semibold text-slate-900">
                      {formatCurrency(claim.settlement_amount)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">
                      Shortfall
                    </p>
                    <p
                      className={[
                        'text-sm font-semibold',
                        shortfall != null && shortfall > 0 ? 'text-amber-600' : 'text-slate-900',
                      ].join(' ')}
                    >
                      {shortfall != null ? formatCurrency(shortfall) : '—'}
                    </p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {formOpen && (
        <ClaimForm
          vehicles={vehicles}
          onClose={() => setFormOpen(false)}
          onSaved={async () => {
            await queryClient.invalidateQueries({ queryKey: ['claims'] })
            setFormOpen(false)
          }}
        />
      )}
    </>
  )
}
