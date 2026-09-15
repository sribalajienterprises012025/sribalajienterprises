import { useMemo, useState } from 'react'
import { addWeeks, format } from 'date-fns'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { Pill } from '@/components/ui/StatusPill'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useBusinessId, useIsOwner } from '@/hooks/useAuth'
import { useMasterData } from '@/hooks/useMasterData'
import { useToast } from '@/hooks/useToast'
import { describeError } from '@/lib/supabase'
import { formatCurrency, formatDate, humanize, toDateInput } from '@/lib/format'
import { queryKeys } from '@/lib/queries/keys'
import {
  createConsignment,
  deleteConsignment,
  listConsignments,
  listTripsInRange,
  listUtilisation,
  updateConsignment,
  type ConsignmentInput,
} from '@/lib/queries/distribution'
import type { ConsignmentProgressRow, ConsignmentStatus } from '@/types'
import { ConsignmentForm } from './ConsignmentForm'
import { PlanningGrid } from './PlanningGrid'
import { weekStartFor } from './week'

type Tab = 'grid' | 'consignments'

const CONSIGNMENT_TONES: Record<
  ConsignmentStatus,
  'neutral' | 'info' | 'warning' | 'success' | 'danger'
> = {
  planned: 'neutral',
  part_dispatched: 'warning',
  dispatched: 'info',
  completed: 'success',
  cancelled: 'danger',
}

export function DistributionPage() {
  const [tab, setTab] = useState<Tab>('grid')

  return (
    <>
      <PageHeader
        title="Distribution"
        subtitle="Who is running what, and what is still to go out"
      />

      <div className="px-4 lg:px-6">
        <div className="mb-4 inline-flex rounded-lg bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setTab('grid')}
            className={[
              'inline-flex min-h-[40px] items-center justify-center rounded-md px-4 text-sm font-medium transition-colors',
              tab === 'grid' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500',
            ].join(' ')}
          >
            Week plan
          </button>
          <button
            type="button"
            onClick={() => setTab('consignments')}
            className={[
              'inline-flex min-h-[40px] items-center justify-center rounded-md px-4 text-sm font-medium transition-colors',
              tab === 'consignments'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500',
            ].join(' ')}
          >
            Consignments
          </button>
        </div>

        {tab === 'grid' ? <WeekPlan /> : <Consignments />}
      </div>
    </>
  )
}

function WeekPlan() {
  const businessId = useBusinessId()
  const { vehicles, isLoading } = useMasterData()
  const [weekStart, setWeekStart] = useState(() => weekStartFor(new Date()))

  const from = toDateInput(weekStart)
  const to = toDateInput(addWeeks(weekStart, 1))

  const utilisationQuery = useQuery({
    queryKey: queryKeys.utilisation(businessId, from, to),
    queryFn: () => listUtilisation(businessId, from, to),
  })

  const tripsQuery = useQuery({
    queryKey: queryKeys.tripsInRange(businessId, from, to),
    queryFn: () => listTripsInRange(businessId, from, to),
  })

  const summary = useMemo(() => {
    const rows = utilisationQuery.data ?? []
    const workingVehicles = new Set(rows.map((row) => row.vehicle_id))
    const plannable = vehicles.filter((vehicle) => vehicle.status !== 'sold')

    return {
      freight: rows.reduce((sum, row) => sum + row.freight_total, 0),
      trips: rows.reduce((sum, row) => sum + row.trip_count, 0),
      idle: plannable.filter((vehicle) => !workingVehicles.has(vehicle.id)).length,
      clashes: rows.filter((row) => row.trip_count > 1).length,
    }
  }, [utilisationQuery.data, vehicles])

  if (isLoading || utilisationQuery.isPending || tripsQuery.isPending) {
    return <LoadingState label="Building the plan…" />
  }
  if (utilisationQuery.isError) {
    return (
      <ErrorState
        error={utilisationQuery.error}
        onRetry={() => void utilisationQuery.refetch()}
      />
    )
  }

  return (
    <div className="space-y-3 pb-4">
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setWeekStart(addWeeks(weekStart, -1))}
        >
          ← Previous
        </Button>
        <div className="text-center">
          <p className="text-sm font-semibold text-slate-900">
            {format(weekStart, 'd MMM')} – {format(addWeeks(weekStart, 1), 'd MMM yyyy')}
          </p>
          <button
            type="button"
            onClick={() => setWeekStart(weekStartFor(new Date()))}
            className="inline-flex min-h-[40px] items-center px-2 text-xs font-medium text-brand-600"
          >
            This week
          </button>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setWeekStart(addWeeks(weekStart, 1))}
        >
          Next →
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Freight this week" value={formatCurrency(summary.freight)} />
        <Tile label="Trips" value={String(summary.trips)} />
        <Tile
          label="Idle trucks"
          value={String(summary.idle)}
          tone={summary.idle > 0 ? 'warning' : 'neutral'}
        />
        <Tile
          label="Double-booked"
          value={String(summary.clashes)}
          tone={summary.clashes > 0 ? 'danger' : 'neutral'}
        />
      </div>

      {summary.clashes > 0 && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {summary.clashes} vehicle-day{summary.clashes === 1 ? '' : 's'} has more than one
          trip booked. Check the red cells below.
        </p>
      )}

      <Card>
        <CardBody className="px-2 py-2 lg:px-3">
          <PlanningGrid
            vehicles={vehicles}
            utilisation={utilisationQuery.data}
            trips={tripsQuery.data ?? []}
            weekStart={weekStart}
            onPickDay={() => {
              // Trips are created from the Trips screen, where the full form
              // lives; the grid is for seeing the shape of the week.
            }}
          />
        </CardBody>
      </Card>

      <p className="text-xs text-slate-400">
        Dashed cells are idle days. Red cells have more than one trip on the same truck.
      </p>
    </div>
  )
}

function Consignments() {
  const businessId = useBusinessId()
  const isOwner = useIsOwner()
  const toast = useToast()
  const queryClient = useQueryClient()
  const master = useMasterData()

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ConsignmentProgressRow | null>(null)
  const [deleting, setDeleting] = useState<ConsignmentProgressRow | null>(null)

  const consignmentsQuery = useQuery({
    queryKey: queryKeys.consignments(businessId),
    queryFn: () => listConsignments(businessId),
  })

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['consignments'] })

  const saveMutation = useMutation({
    mutationFn: (input: ConsignmentInput) =>
      editing
        ? updateConsignment(editing.id, input)
        : createConsignment(businessId, input),
    onSuccess: async () => {
      await refresh()
      toast.success(editing ? 'Consignment updated' : 'Consignment created')
      setFormOpen(false)
      setEditing(null)
    },
    onError: (error) => toast.error(describeError(error)),
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, next }: { id: string; next: ConsignmentStatus }) =>
      updateConsignment(id, { status: next }),
    onSuccess: refresh,
    onError: (error) => toast.error(describeError(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteConsignment(id),
    onSuccess: async () => {
      await refresh()
      toast.success('Consignment removed')
      setDeleting(null)
    },
    onError: (error) => toast.error(describeError(error)),
  })

  if (consignmentsQuery.isPending) return <LoadingState label="Loading consignments…" />
  if (consignmentsQuery.isError) {
    return (
      <ErrorState
        error={consignmentsQuery.error}
        onRetry={() => void consignmentsQuery.refetch()}
      />
    )
  }

  const openCreate = () => {
    setEditing(null)
    setFormOpen(true)
  }

  return (
    <>
      {isOwner && (
        <div className="mb-3">
          <Button size="sm" onClick={openCreate} disabled={master.hasNoParties}>
            New consignment
          </Button>
        </div>
      )}

      {consignmentsQuery.data.length === 0 ? (
        <EmptyState
          icon="📦"
          title="No consignments planned"
          description="Use a consignment when one order needs more than one truck — it tracks how much is still to be dispatched."
          action={
            isOwner && !master.hasNoParties ? (
              <Button onClick={openCreate}>Plan a consignment</Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-2.5 pb-4">
          {consignmentsQuery.data.map((row) => {
            const pending = row.pending_quantity
            const progress =
              row.total_quantity && row.total_quantity > 0
                ? Math.min(
                    100,
                    Math.round((row.dispatched_quantity / row.total_quantity) * 100),
                  )
                : null

            return (
              <div
                key={row.id}
                className="rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900">
                      {row.pickup} → {row.drop_location}
                    </p>
                    <p className="mt-0.5 truncate text-sm text-slate-500">
                      {formatDate(row.planned_date)}
                      {row.reference && ` · ${row.reference}`}
                      {` · ${master.partyNames.get(row.party_id) ?? 'Party'}`}
                    </p>
                  </div>
                  <Pill
                    label={humanize(row.status)}
                    tone={CONSIGNMENT_TONES[row.status]}
                  />
                </div>

                {row.goods_description && (
                  <p className="mt-2 truncate text-xs text-slate-500">
                    {row.goods_description}
                  </p>
                )}

                {progress !== null && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">
                        {row.dispatched_quantity} of {row.total_quantity} {row.unit}{' '}
                        dispatched
                      </span>
                      <span className="font-medium text-slate-700">{progress}%</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={[
                          'h-full rounded-full',
                          progress >= 100 ? 'bg-emerald-500' : 'bg-brand-500',
                        ].join(' ')}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    {pending !== null && pending > 0 && (
                      <p className="mt-1 text-xs text-amber-600">
                        {pending} {row.unit} still to go
                      </p>
                    )}
                  </div>
                )}

                <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3">
                  <Metric label="Trips" value={String(row.trip_count)} />
                  <Metric label="Delivered" value={String(row.delivered_count)} />
                  <Metric label="Freight" value={formatCurrency(row.freight_total)} />
                </div>

                {isOwner && row.status !== 'cancelled' && (
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                    {row.status !== 'completed' && (
                      <Button
                        size="sm"
                        loading={
                          statusMutation.isPending &&
                          statusMutation.variables?.id === row.id
                        }
                        onClick={() =>
                          statusMutation.mutate({ id: row.id, next: 'completed' })
                        }
                      >
                        Mark completed
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setEditing(row)
                        setFormOpen(true)
                      }}
                    >
                      Edit
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setDeleting(row)}>
                      Remove
                    </Button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {formOpen && (
        <ConsignmentForm
          key={editing?.id ?? 'new'}
          consignment={editing}
          clients={master.clients}
          brokers={master.brokers}
          saving={saveMutation.isPending}
          onClose={() => {
            setFormOpen(false)
            setEditing(null)
          }}
          onSubmit={(values) => saveMutation.mutate(values)}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Remove consignment"
        message={
          deleting
            ? `Remove the ${deleting.pickup} → ${deleting.drop_location} consignment? The ${deleting.trip_count} trip${deleting.trip_count === 1 ? '' : 's'} against it are kept and become standalone.`
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

function Tile({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'neutral' | 'warning' | 'danger'
}) {
  const valueTone = {
    neutral: 'text-slate-900',
    warning: 'text-amber-600',
    danger: 'text-red-600',
  }[tone]

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${valueTone}`}>{value}</p>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-sm font-semibold text-slate-900">{value}</p>
    </div>
  )
}
