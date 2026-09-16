import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '@/components/ui/PageHeader'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { TripStatusPill } from '@/components/ui/StatusPill'
import { useDriverId } from '@/hooks/useAuth'
import { formatDateShort, formatKm } from '@/lib/format'
import { queryKeys } from '@/lib/queries/keys'
import { listMyTrips } from '@/lib/queries/driver'
import type { MyTrip } from '@/types'
import { MyTripSheet } from './MyTripSheet'

/**
 * The driver's own app.
 *
 * Deliberately plain: this is read on a phone, in a cab, often in sunlight and
 * usually one-handed. Each trip is one tappable card, and what a driver needs
 * before they set off — where from, where to, which lorry — is on the card
 * rather than behind it.
 */
export function MyTripsPage() {
  const driverId = useDriverId() ?? 'none'
  const [open, setOpen] = useState<MyTrip | null>(null)

  const tripsQuery = useQuery({
    queryKey: queryKeys.myTrips(driverId),
    queryFn: listMyTrips,
  })

  const trips = tripsQuery.data ?? []
  const running = trips.filter((trip) => trip.status === 'in_transit')
  const rest = trips.filter((trip) => trip.status !== 'in_transit')

  return (
    <div className="pb-6">
      <PageHeader
        title="My trips"
        subtitle={
          tripsQuery.isSuccess
            ? trips.length === 0
              ? 'Nothing assigned yet'
              : `${trips.length} trip${trips.length === 1 ? '' : 's'}`
            : undefined
        }
      />

      {tripsQuery.isPending && <LoadingState label="Loading your trips…" />}
      {tripsQuery.isError && (
        <ErrorState error={tripsQuery.error} onRetry={() => void tripsQuery.refetch()} />
      )}

      {tripsQuery.isSuccess && trips.length === 0 && (
        <EmptyState
          icon="🚚"
          title="No trips yet"
          description="When the office assigns you a trip it will appear here."
        />
      )}

      {running.length > 0 && (
        <Section title="On the road">
          {running.map((trip) => (
            <TripCard key={trip.id} trip={trip} onOpen={() => setOpen(trip)} />
          ))}
        </Section>
      )}

      {rest.length > 0 && (
        <Section title={running.length > 0 ? 'Everything else' : undefined}>
          {rest.map((trip) => (
            <TripCard key={trip.id} trip={trip} onOpen={() => setOpen(trip)} />
          ))}
        </Section>
      )}

      <MyTripSheet trip={open} onClose={() => setOpen(null)} />
    </div>
  )
}

function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="px-4 lg:px-6">
      {title && (
        <h2 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {title}
        </h2>
      )}
      <div className="space-y-2">{children}</div>
    </section>
  )
}

function TripCard({ trip, onOpen }: { trip: MyTrip; onOpen: () => void }) {
  const km =
    trip.odometer_start != null && trip.odometer_end != null
      ? trip.odometer_end - trip.odometer_start
      : null

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-xl border border-slate-200 bg-white p-4 text-left active:bg-slate-50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* Wraps rather than truncates: where the lorry is going is the one
              thing on this card that must not end in an ellipsis. */}
          <p className="text-base font-medium leading-snug text-slate-900">
            {trip.pickup} → {trip.drop_location}
          </p>
          <p className="mt-0.5 text-sm text-slate-500">
            {formatDateShort(trip.trip_date)}
            {trip.vehicle_reg_no ? ` · ${trip.vehicle_reg_no}` : ''}
          </p>
        </div>
        <TripStatusPill status={trip.status} />
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500">
        {trip.party_name && <span className="truncate">For {trip.party_name}</span>}
        {trip.goods_description && <span className="truncate">{trip.goods_description}</span>}
        {km != null && <span>{formatKm(km)}</span>}
        {trip.lr_number && <span>LR {trip.lr_number}</span>}
      </div>
    </button>
  )
}
