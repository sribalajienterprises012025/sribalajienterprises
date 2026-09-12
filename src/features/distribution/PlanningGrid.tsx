import { useMemo } from 'react'
import { addDays, format } from 'date-fns'
import { Pill } from '@/components/ui/StatusPill'
import { formatCurrencyCompact, toDateInput } from '@/lib/format'
import type { Vehicle, VehicleUtilisationRow } from '@/types'

interface TripCell {
  id: string
  vehicle_id: string | null
  trip_date: string
  pickup: string
  drop_location: string
  status: string
  freight_amount: number
}

/**
 * Vehicle × day grid for a week.
 *
 * The point of this screen is spotting the two things that cost money: a truck
 * sitting idle, and a truck promised to two loads on the same day. Both are
 * called out rather than left for the reader to notice.
 */
export function PlanningGrid({
  vehicles,
  utilisation,
  trips,
  weekStart,
  onPickDay,
}: {
  vehicles: Vehicle[]
  utilisation: VehicleUtilisationRow[]
  trips: TripCell[]
  weekStart: Date
  onPickDay: (vehicleId: string, date: string) => void
}) {
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    [weekStart],
  )

  const byVehicleDay = useMemo(() => {
    const map = new Map<string, VehicleUtilisationRow>()
    for (const row of utilisation) {
      map.set(`${row.vehicle_id}|${row.trip_date}`, row)
    }
    return map
  }, [utilisation])

  const tripsByVehicleDay = useMemo(() => {
    const map = new Map<string, TripCell[]>()
    for (const trip of trips) {
      if (!trip.vehicle_id) continue
      const key = `${trip.vehicle_id}|${trip.trip_date}`
      const list = map.get(key)
      if (list) list.push(trip)
      else map.set(key, [trip])
    }
    return map
  }, [trips])

  const today = toDateInput(new Date())

  // Vehicles that are sold have no place on a planning board; ones in
  // maintenance do, because knowing they are out is the point.
  const plannable = vehicles.filter((vehicle) => vehicle.status !== 'sold')

  if (plannable.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-slate-500">
        Add vehicles to start planning.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-separate border-spacing-1">
        <thead>
          <tr>
            <th className="w-28 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
              Vehicle
            </th>
            {days.map((day) => {
              const iso = toDateInput(day)
              return (
                <th key={iso} className="min-w-[92px] pb-1">
                  <div
                    className={[
                      'rounded-md px-1 py-1 text-center',
                      iso === today ? 'bg-brand-50' : '',
                    ].join(' ')}
                  >
                    <div className="text-[11px] uppercase tracking-wide text-slate-400">
                      {format(day, 'EEE')}
                    </div>
                    <div
                      className={[
                        'text-sm font-semibold',
                        iso === today ? 'text-brand-700' : 'text-slate-700',
                      ].join(' ')}
                    >
                      {format(day, 'd MMM')}
                    </div>
                  </div>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {plannable.map((vehicle) => (
            <tr key={vehicle.id}>
              <th className="align-top text-left">
                <div className="pt-1">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {vehicle.reg_no}
                  </p>
                  {vehicle.status === 'in_maintenance' && (
                    <Pill label="In workshop" tone="warning" />
                  )}
                </div>
              </th>

              {days.map((day) => {
                const iso = toDateInput(day)
                const key = `${vehicle.id}|${iso}`
                const row = byVehicleDay.get(key)
                const dayTrips = tripsByVehicleDay.get(key) ?? []
                const clash = (row?.trip_count ?? 0) > 1

                return (
                  <td key={iso} className="align-top">
                    <button
                      type="button"
                      onClick={() => onPickDay(vehicle.id, iso)}
                      className={[
                        'h-full min-h-[58px] w-full rounded-md border p-1.5 text-left transition-colors',
                        clash
                          ? 'border-red-300 bg-red-50 hover:bg-red-100'
                          : dayTrips.length > 0
                            ? 'border-brand-200 bg-brand-50 hover:bg-brand-100'
                            : 'border-dashed border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
                      ].join(' ')}
                    >
                      {dayTrips.length === 0 ? (
                        <span className="text-[11px] text-slate-300">idle</span>
                      ) : (
                        <>
                          {dayTrips.slice(0, 2).map((trip) => (
                            <p
                              key={trip.id}
                              className="truncate text-[11px] font-medium leading-tight text-slate-700"
                            >
                              {trip.pickup.slice(0, 7)}→{trip.drop_location.slice(0, 7)}
                            </p>
                          ))}
                          {dayTrips.length > 2 && (
                            <p className="text-[10px] text-slate-500">
                              +{dayTrips.length - 2} more
                            </p>
                          )}
                          <p
                            className={[
                              'mt-0.5 text-[10px] font-semibold',
                              clash ? 'text-red-600' : 'text-slate-500',
                            ].join(' ')}
                          >
                            {clash && '⚠ '}
                            {formatCurrencyCompact(row?.freight_total ?? 0)}
                          </p>
                        </>
                      )}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
