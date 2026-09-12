import { humanize } from '@/lib/format'
import type { TripStatus, VehicleStatus } from '@/types'

type Tone = 'neutral' | 'info' | 'warning' | 'success' | 'danger'

const TONES: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700',
  info: 'bg-blue-100 text-blue-800',
  warning: 'bg-amber-100 text-amber-800',
  success: 'bg-emerald-100 text-emerald-800',
  danger: 'bg-red-100 text-red-800',
}

/** Colour follows the trip's position in booked -> ... -> closed. */
const TRIP_TONES: Record<TripStatus, Tone> = {
  booked: 'neutral',
  in_transit: 'info',
  delivered: 'success',
  payment_pending: 'warning',
  closed: 'neutral',
  cancelled: 'danger',
}

const VEHICLE_TONES: Record<VehicleStatus, Tone> = {
  active: 'success',
  in_maintenance: 'warning',
  idle: 'neutral',
  sold: 'neutral',
}

export function Pill({
  label,
  tone = 'neutral',
}: {
  label: string
  tone?: Tone
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}
    >
      {label}
    </span>
  )
}

export function TripStatusPill({ status }: { status: TripStatus }) {
  return <Pill label={humanize(status)} tone={TRIP_TONES[status]} />
}

export function VehicleStatusPill({ status }: { status: VehicleStatus }) {
  return <Pill label={humanize(status)} tone={VEHICLE_TONES[status]} />
}

/**
 * Document expiry badge — insurance, permit, fitness, licence.
 * Amber inside 30 days is deliberate: that is roughly the lead time needed to
 * get a renewal done without taking the vehicle off the road.
 */
export function ExpiryPill({ days, label }: { days: number | null; label: string }) {
  if (days === null) return null

  if (days < 0) {
    return <Pill label={`${label} expired`} tone="danger" />
  }
  if (days <= 30) {
    return <Pill label={`${label} in ${days}d`} tone="warning" />
  }
  return null
}
