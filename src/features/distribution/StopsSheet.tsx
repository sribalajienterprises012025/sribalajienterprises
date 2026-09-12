import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { controlClass } from '@/components/ui/control'
import { Sheet } from '@/components/ui/Sheet'
import { Pill } from '@/components/ui/StatusPill'
import { LoadingState } from '@/components/ui/States'
import { useBusinessId, useCanEdit } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import { describeError } from '@/lib/supabase'
import { queryKeys } from '@/lib/queries/keys'
import {
  createStop,
  deleteStop,
  listStops,
  swapStops,
  updateStop,
} from '@/lib/queries/distribution'
import type { StopStatus, StopType, TripStop } from '@/types'

const STATUS_TONES: Record<StopStatus, 'neutral' | 'info' | 'success' | 'warning'> = {
  pending: 'neutral',
  reached: 'info',
  completed: 'success',
  skipped: 'warning',
}

/**
 * Ordered stops for a multi-stop trip.
 *
 * The trip's own pickup and drop stay as the headline route, so every existing
 * list, invoice and report keeps reading the same as before; these carry the
 * detail of what was loaded and dropped where.
 */
export function StopsSheet({
  tripId,
  tripRoute,
  onClose,
}: {
  tripId: string
  tripRoute: string
  onClose: () => void
}) {
  const businessId = useBusinessId()
  const canEdit = useCanEdit()
  const toast = useToast()
  const queryClient = useQueryClient()

  const [stopType, setStopType] = useState<StopType>('drop')
  const [location, setLocation] = useState('')
  const [quantity, setQuantity] = useState('')
  const [contact, setContact] = useState('')

  const stopsQuery = useQuery({
    queryKey: queryKeys.stops(tripId),
    queryFn: () => listStops(tripId),
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.stops(tripId) })

  const addMutation = useMutation({
    mutationFn: () => {
      const stops = stopsQuery.data ?? []
      // Append to the end of the running order.
      const nextSequence =
        stops.reduce((max, stop) => Math.max(max, stop.sequence), 0) + 1

      return createStop(businessId, {
        trip_id: tripId,
        sequence: nextSequence,
        stop_type: stopType,
        location: location.trim(),
        contact: contact.trim() || null,
        goods_description: null,
        quantity: quantity ? Number(quantity) : null,
        unit: null,
        expected_at: null,
        reached_at: null,
        status: 'pending',
        note: null,
      })
    },
    onSuccess: async () => {
      await refresh()
      setLocation('')
      setQuantity('')
      setContact('')
    },
    onError: (error) => toast.error(describeError(error)),
  })

  const statusMutation = useMutation({
    mutationFn: ({ stop, next }: { stop: TripStop; next: StopStatus }) =>
      updateStop(stop.id, {
        status: next,
        reached_at:
          next === 'reached' || next === 'completed'
            ? (stop.reached_at ?? new Date().toISOString())
            : null,
      }),
    onSuccess: refresh,
    onError: (error) => toast.error(describeError(error)),
  })

  const moveMutation = useMutation({
    mutationFn: ({ a, b }: { a: TripStop; b: TripStop }) => swapStops(a, b),
    onSuccess: refresh,
    onError: (error) => toast.error(describeError(error)),
  })

  const removeMutation = useMutation({
    mutationFn: (id: string) => deleteStop(id),
    onSuccess: async () => {
      await refresh()
      toast.success('Stop removed')
    },
    onError: (error) => toast.error(describeError(error)),
  })

  const stops = stopsQuery.data ?? []

  return (
    <Sheet open onClose={onClose} title={`Stops — ${tripRoute}`}>
      <div className="space-y-4">
        {stopsQuery.isPending ? (
          <LoadingState label="Loading stops…" />
        ) : stops.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
            No intermediate stops. The trip runs {tripRoute} direct.
          </p>
        ) : (
          <ol className="space-y-2">
            {stops.map((stop, index) => (
              <li
                key={stop.id}
                className="rounded-lg border border-slate-200 bg-white p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 gap-2.5">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                      {stop.sequence}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {stop.location}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {stop.stop_type === 'pickup' ? 'Load' : 'Unload'}
                        {stop.quantity != null && ` · ${stop.quantity}`}
                        {stop.contact && ` · ${stop.contact}`}
                      </p>
                    </div>
                  </div>
                  <Pill
                    label={stop.status === 'pending' ? 'Pending' : stop.status}
                    tone={STATUS_TONES[stop.status]}
                  />
                </div>

                {canEdit && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2.5">
                    {stop.status !== 'completed' && (
                      <Button
                        size="sm"
                        onClick={() =>
                          statusMutation.mutate({ stop, next: 'completed' })
                        }
                      >
                        Done
                      </Button>
                    )}
                    {stop.status === 'pending' && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => statusMutation.mutate({ stop, next: 'reached' })}
                      >
                        Reached
                      </Button>
                    )}
                    <button
                      type="button"
                      disabled={index === 0 || moveMutation.isPending}
                      onClick={() => {
                        const previous = stops[index - 1]
                        if (previous) moveMutation.mutate({ a: stop, b: previous })
                      }}
                      aria-label="Move up"
                      className="rounded px-2 py-1 text-sm text-slate-400 disabled:opacity-30 hover:bg-slate-100"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={index === stops.length - 1 || moveMutation.isPending}
                      onClick={() => {
                        const next = stops[index + 1]
                        if (next) moveMutation.mutate({ a: stop, b: next })
                      }}
                      aria-label="Move down"
                      className="rounded px-2 py-1 text-sm text-slate-400 disabled:opacity-30 hover:bg-slate-100"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => removeMutation.mutate(stop.id)}
                      className="ml-auto text-xs font-medium text-slate-400 hover:text-red-600"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}

        {canEdit && (
          <div className="space-y-3 rounded-lg border border-slate-200 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Add a stop
            </p>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Type" htmlFor="stop_type">
                <select
                  id="stop_type"
                  value={stopType}
                  onChange={(event) => setStopType(event.target.value as StopType)}
                  className={controlClass()}
                >
                  <option value="pickup">Load</option>
                  <option value="drop">Unload</option>
                </select>
              </Field>

              <Field label="Quantity" htmlFor="stop_qty">
                <input
                  id="stop_qty"
                  inputMode="decimal"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  className={controlClass()}
                />
              </Field>
            </div>

            <Field label="Location" htmlFor="stop_location" required>
              <input
                id="stop_location"
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                className={controlClass()}
                placeholder="e.g. Shop 3, Ramdaspeth"
              />
            </Field>

            <Field label="Contact" htmlFor="stop_contact">
              <input
                id="stop_contact"
                value={contact}
                onChange={(event) => setContact(event.target.value)}
                className={controlClass()}
                placeholder="Name or phone at the stop"
              />
            </Field>

            <Button
              fullWidth
              loading={addMutation.isPending}
              disabled={!location.trim()}
              onClick={() => addMutation.mutate()}
            >
              Add stop
            </Button>
          </div>
        )}
      </div>
    </Sheet>
  )
}
