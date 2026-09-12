import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { TripStatusPill } from '@/components/ui/StatusPill'
import { useBusinessId, useCanEdit } from '@/hooks/useAuth'
import { useMasterData } from '@/hooks/useMasterData'
import { useToast } from '@/hooks/useToast'
import { describeError } from '@/lib/supabase'
import { formatCurrency, formatDateShort, formatKm } from '@/lib/format'
import { queryKeys } from '@/lib/queries/keys'
import {
  createTrip,
  deleteTrip,
  listTrips,
  syncVehicleOdometer,
  updateTrip,
  type TripFilters,
  type TripInput,
} from '@/lib/queries/trips'
import type { Trip, TripStatus, TripWithRelations } from '@/types'
import { TripForm } from './TripForm'
import { balanceDue, tripDistance } from './tripSchema'
import { StopsSheet } from '@/features/distribution/StopsSheet'

const STATUS_FILTERS: Array<{ value: TripStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'booked', label: 'Booked' },
  { value: 'in_transit', label: 'In transit' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'payment_pending', label: 'Payment due' },
  { value: 'closed', label: 'Closed' },
]

/** The one-tap forward move for each status. null means nothing to advance to. */
const NEXT_STATUS: Record<TripStatus, TripStatus | null> = {
  booked: 'in_transit',
  in_transit: 'delivered',
  delivered: 'payment_pending',
  payment_pending: 'closed',
  closed: null,
  cancelled: null,
}

export function TripsPage() {
  const businessId = useBusinessId()
  const canEdit = useCanEdit()
  const toast = useToast()
  const queryClient = useQueryClient()
  const master = useMasterData()

  const [status, setStatus] = useState<TripStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Trip | null>(null)
  const [deleting, setDeleting] = useState<TripWithRelations | null>(null)
  const [stopsFor, setStopsFor] = useState<TripWithRelations | null>(null)

  const filters = useMemo<TripFilters>(
    () => ({ status, search: search.trim() || undefined }),
    [status, search],
  )

  const tripsQuery = useQuery({
    queryKey: queryKeys.trips(businessId, filters),
    queryFn: () => listTrips(businessId, filters),
  })

  /** Trips change vehicle odometers and dashboard totals, so both are refreshed. */
  const invalidateTripData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['trips'] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.vehicles(businessId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(businessId) }),
    ])
  }

  const saveMutation = useMutation({
    mutationFn: async (input: TripInput) => {
      const trip = editing
        ? await updateTrip(editing.id, input)
        : await createTrip(businessId, input)

      // Keeping the vehicle's odometer current is what makes service-by-km
      // scheduling possible in Phase 5, so it is maintained from the start.
      if (trip.vehicle_id && trip.odometer_end != null) {
        await syncVehicleOdometer(trip.vehicle_id, trip.odometer_end)
      }
      return trip
    },
    onSuccess: async () => {
      await invalidateTripData()
      toast.success(editing ? 'Trip updated' : 'Trip saved')
      setFormOpen(false)
      setEditing(null)
    },
    onError: (error) => toast.error(describeError(error)),
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, next }: { id: string; next: TripStatus }) =>
      updateTrip(id, { status: next }),
    onSuccess: async () => {
      await invalidateTripData()
    },
    onError: (error) => toast.error(describeError(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTrip(id),
    onSuccess: async () => {
      await invalidateTripData()
      toast.success('Trip deleted')
      setDeleting(null)
    },
    onError: (error) => toast.error(describeError(error)),
  })

  const openCreate = () => {
    setEditing(null)
    setFormOpen(true)
  }

  return (
    <>
      <PageHeader
        title="Trips"
        subtitle={tripsQuery.data ? `${tripsQuery.data.length} shown` : undefined}
        action={
          canEdit ? (
            <Button size="sm" onClick={openCreate} disabled={master.hasNoParties}>
              New trip
            </Button>
          ) : undefined
        }
      />

      <div className="space-y-3 px-4 lg:px-6">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search route, LR number or goods"
          className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm placeholder:text-slate-400 focus:border-brand-500"
        />

        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:px-0">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => setStatus(filter.value)}
              className={[
                'shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors',
                status === filter.value
                  ? 'bg-brand-600 text-white'
                  : 'bg-white text-slate-600 ring-1 ring-slate-200',
              ].join(' ')}
            >
              {filter.label}
            </button>
          ))}
        </div>

        {master.hasNoParties ? (
          <EmptyState
            icon="🤝"
            title="Add a client or broker first"
            description="Every trip is booked against a party, so there needs to be at least one on record."
            action={
              <Link to="/parties">
                <Button>Go to Parties</Button>
              </Link>
            }
          />
        ) : tripsQuery.isPending ? (
          <LoadingState label="Loading trips…" />
        ) : tripsQuery.isError ? (
          <ErrorState error={tripsQuery.error} onRetry={() => void tripsQuery.refetch()} />
        ) : tripsQuery.data.length === 0 ? (
          <EmptyState
            icon="🚚"
            title={search || status !== 'all' ? 'No trips match' : 'No trips yet'}
            description={
              search || status !== 'all'
                ? 'Try clearing the search or picking a different status.'
                : 'Log a trip to start tracking freight, advances and balances.'
            }
            action={
              canEdit && !search && status === 'all' ? (
                <Button onClick={openCreate}>Log your first trip</Button>
              ) : undefined
            }
          />
        ) : (
          <div className="space-y-2.5 pb-4">
            {tripsQuery.data.map((trip) => (
              <TripCard
                key={trip.id}
                trip={trip}
                partyName={master.partyNames.get(trip.party_id)}
                canEdit={canEdit}
                advancing={
                  statusMutation.isPending && statusMutation.variables?.id === trip.id
                }
                onEdit={() => {
                  setEditing(trip)
                  setFormOpen(true)
                }}
                onDelete={() => setDeleting(trip)}
                onStops={() => setStopsFor(trip)}
                onAdvance={(next) => statusMutation.mutate({ id: trip.id, next })}
              />
            ))}
          </div>
        )}
      </div>

      {formOpen && (
        <TripForm
          key={editing?.id ?? 'new'}
          open={formOpen}
          trip={editing}
          vehicles={master.vehicles}
          drivers={master.drivers}
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

      {stopsFor && (
        <StopsSheet
          tripId={stopsFor.id}
          tripRoute={`${stopsFor.pickup} → ${stopsFor.drop_location}`}
          onClose={() => setStopsFor(null)}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete trip"
        message={
          deleting
            ? `Delete the ${deleting.pickup} → ${deleting.drop_location} trip? This cannot be undone.`
            : ''
        }
        loading={deleteMutation.isPending}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        onCancel={() => setDeleting(null)}
      />
    </>
  )
}

function TripCard({
  trip,
  partyName,
  canEdit,
  advancing,
  onEdit,
  onDelete,
  onStops,
  onAdvance,
}: {
  trip: TripWithRelations
  partyName?: string
  canEdit: boolean
  advancing: boolean
  onEdit: () => void
  onDelete: () => void
  onStops: () => void
  onAdvance: (next: TripStatus) => void
}) {
  const next = NEXT_STATUS[trip.status]
  const due = balanceDue(trip)
  const distance = tripDistance(trip)

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-900">
            {trip.pickup} → {trip.drop_location}
          </p>
          <p className="mt-0.5 truncate text-sm text-slate-500">
            {formatDateShort(trip.trip_date)}
            {partyName && ` · ${partyName}`}
            {trip.vehicle && ` · ${trip.vehicle.reg_no}`}
          </p>
        </div>
        <TripStatusPill status={trip.status} />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3">
        <Metric label="Freight" value={formatCurrency(trip.freight_amount)} />
        <Metric label="Advance" value={formatCurrency(trip.advance_received)} />
        <Metric
          label="Due"
          value={formatCurrency(due)}
          emphasis={due > 0 && trip.status !== 'closed'}
        />
      </div>

      {(trip.driver || distance !== null || trip.lr_number) && (
        <p className="mt-2 truncate text-xs text-slate-400">
          {[
            trip.driver?.name,
            distance !== null ? formatKm(distance) : null,
            trip.lr_number ? `LR ${trip.lr_number}` : null,
            trip.bill_type === 'non_gst' ? 'Non-GST' : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}

      {canEdit && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
          {next && (
            <Button size="sm" loading={advancing} onClick={() => onAdvance(next)}>
              Mark {next.replace(/_/g, ' ')}
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="secondary" size="sm" onClick={onStops}>
            Stops
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete}>
            Delete
          </Button>
        </div>
      )}
    </div>
  )
}

function Metric({
  label,
  value,
  emphasis = false,
}: {
  label: string
  value: string
  emphasis?: boolean
}) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p
        className={[
          'text-sm font-semibold',
          emphasis ? 'text-amber-600' : 'text-slate-900',
        ].join(' ')}
      >
        {value}
      </p>
    </div>
  )
}
