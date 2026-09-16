import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Sheet } from '@/components/ui/Sheet'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { controlClass } from '@/components/ui/control'
import { TripStatusPill } from '@/components/ui/StatusPill'
import { useBusinessId, useDriverId } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import { describeError } from '@/lib/supabase'
import { formatCurrency, formatDate, formatDateShort, humanize, todayInput } from '@/lib/format'
import { queryKeys } from '@/lib/queries/keys'
import {
  attachPod,
  listMyTripExpenses,
  logMyExpense,
  logOdometer,
  setMyTripStatus,
} from '@/lib/queries/driver'
import {
  ACCEPTED_UPLOAD_TYPES,
  MAX_UPLOAD_BYTES,
  signedUrl,
  uploadTripPhoto,
} from '@/lib/storage'
import type { MyTrip } from '@/types'

type Category = 'fuel' | 'toll' | 'other'

const CATEGORY_LABELS: Record<Category, string> = {
  fuel: 'Diesel',
  toll: 'Toll',
  other: 'Other',
}

/**
 * Everything a driver does with a trip, in one sheet.
 *
 * The four things that actually happen on the road, in the order they happen:
 * start, meter readings, money spent, photo of the delivery. Anything the
 * office does with a trip — rates, invoices, closing it — is not here and is
 * not reachable from here.
 */
export function MyTripSheet({ trip, onClose }: { trip: MyTrip | null; onClose: () => void }) {
  const businessId = useBusinessId()
  const driverId = useDriverId() ?? 'none'
  const toast = useToast()
  const queryClient = useQueryClient()

  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [category, setCategory] = useState<Category>('fuel')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [date, setDate] = useState(todayInput())
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    setStart(trip?.odometer_start != null ? String(trip.odometer_start) : '')
    setEnd(trip?.odometer_end != null ? String(trip.odometer_end) : '')
    setCategory('fuel')
    setAmount('')
    setNote('')
    setDate(todayInput())
  }, [trip])

  const expensesQuery = useQuery({
    queryKey: queryKeys.myTripExpenses(driverId, trip?.id ?? 'none'),
    queryFn: () => listMyTripExpenses(trip!.id),
    enabled: trip != null,
  })

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.myTrips(driverId) }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.myTripExpenses(driverId, trip?.id ?? 'none'),
      }),
    ])
  }

  const odometerMutation = useMutation({
    mutationFn: () =>
      logOdometer({
        tripId: trip!.id,
        start: start.trim() === '' ? null : Number(start),
        end: end.trim() === '' ? null : Number(end),
      }),
    onSuccess: async () => {
      await refresh()
      toast.success('Meter reading saved')
    },
    onError: (error) => toast.error(describeError(error)),
  })

  const statusMutation = useMutation({
    mutationFn: (next: 'in_transit' | 'delivered') => setMyTripStatus(trip!.id, next),
    onSuccess: async () => {
      await refresh()
      toast.success('Updated')
    },
    onError: (error) => toast.error(describeError(error)),
  })

  const expenseMutation = useMutation({
    mutationFn: () =>
      logMyExpense({
        tripId: trip!.id,
        category,
        amount: Number(amount),
        paymentMode: 'cash',
        note: note.trim() === '' ? null : note.trim(),
        date,
      }),
    onSuccess: async () => {
      await refresh()
      setAmount('')
      setNote('')
      toast.success('Expense added')
    },
    onError: (error) => toast.error(describeError(error)),
  })

  async function onPhotoPicked(file: File) {
    if (!trip) return

    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error('That photo is over 10 MB. Take it again at a lower size.')
      return
    }
    if (file.type && !ACCEPTED_UPLOAD_TYPES.includes(file.type)) {
      toast.error('Photos and PDFs only.')
      return
    }

    setUploading(true)
    try {
      const path = await uploadTripPhoto({ businessId, tripId: trip.id, file })
      await attachPod(trip.id, path)
      await refresh()
      toast.success('Delivery photo saved')
    } catch (error) {
      toast.error(describeError(error))
    } finally {
      setUploading(false)
    }
  }

  async function viewPhoto() {
    if (!trip?.pod_file_url) return
    try {
      window.open(await signedUrl(trip.pod_file_url), '_blank', 'noopener')
    } catch (error) {
      toast.error(describeError(error))
    }
  }

  if (!trip) return null

  const closed = trip.status === 'closed' || trip.status === 'cancelled'
  const expenses = expensesQuery.data ?? []
  const spent = expenses.reduce((total, expense) => total + Number(expense.amount), 0)

  return (
    <Sheet open onClose={onClose} title={`${trip.pickup} → ${trip.drop_location}`}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
          <TripStatusPill status={trip.status} />
          <span>{formatDate(trip.trip_date)}</span>
          {trip.vehicle_reg_no && <span>{trip.vehicle_reg_no}</span>}
          {trip.lr_number && <span>LR {trip.lr_number}</span>}
        </div>

        {(trip.party_name || trip.goods_description) && (
          <div className="rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
            {trip.party_name && (
              <p>
                For <span className="font-medium text-slate-900">{trip.party_name}</span>
              </p>
            )}
            {trip.goods_description && <p className="mt-0.5">{trip.goods_description}</p>}
            {trip.notes && <p className="mt-1 text-slate-500">{trip.notes}</p>}
          </div>
        )}

        {!closed && (
          <div className="flex gap-2">
            {trip.status === 'booked' && (
              <Button
                fullWidth
                loading={statusMutation.isPending}
                onClick={() => statusMutation.mutate('in_transit')}
              >
                Start trip
              </Button>
            )}
            {(trip.status === 'in_transit' || trip.status === 'booked') && (
              <Button
                fullWidth
                variant={trip.status === 'in_transit' ? 'primary' : 'secondary'}
                loading={statusMutation.isPending}
                onClick={() => statusMutation.mutate('delivered')}
              >
                Mark delivered
              </Button>
            )}
          </div>
        )}

        {/* Meter readings */}
        <section>
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Meter reading</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start" htmlFor="odo-start">
              <input
                id="odo-start"
                inputMode="numeric"
                value={start}
                onChange={(event) => setStart(event.target.value.replace(/\D/g, ''))}
                className={controlClass()}
                placeholder="km"
                disabled={closed}
              />
            </Field>
            <Field label="End" htmlFor="odo-end">
              <input
                id="odo-end"
                inputMode="numeric"
                value={end}
                onChange={(event) => setEnd(event.target.value.replace(/\D/g, ''))}
                className={controlClass()}
                placeholder="km"
                disabled={closed}
              />
            </Field>
          </div>
          {!closed && (
            <Button
              variant="secondary"
              fullWidth
              className="mt-2"
              loading={odometerMutation.isPending}
              onClick={() => odometerMutation.mutate()}
            >
              Save reading
            </Button>
          )}
        </section>

        {/* Money spent on the road */}
        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Spent on this trip</h3>
            <span className="text-sm text-slate-500">{formatCurrency(spent)}</span>
          </div>

          {expenses.length > 0 && (
            <ul className="mb-3 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
              {expenses.map((expense) => (
                <li key={expense.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="text-slate-700">
                    {humanize(expense.category)}
                    {expense.note ? ` · ${expense.note}` : ''}
                    <span className="ml-1 text-slate-400">{formatDateShort(expense.date)}</span>
                  </span>
                  <span className="font-medium text-slate-900">
                    {formatCurrency(Number(expense.amount))}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {!closed && (
            <div className="space-y-3 rounded-xl border border-slate-200 p-3">
              <div className="flex gap-2">
                {(Object.keys(CATEGORY_LABELS) as Category[]).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setCategory(value)}
                    className={`inline-flex min-h-[40px] flex-1 items-center justify-center rounded-lg border px-3 text-sm ${
                      category === value
                        ? 'border-brand-600 bg-brand-50 font-medium text-brand-700'
                        : 'border-slate-200 text-slate-600'
                    }`}
                  >
                    {CATEGORY_LABELS[value]}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Amount" htmlFor="expense-amount" required>
                  <input
                    id="expense-amount"
                    inputMode="decimal"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    className={controlClass()}
                    placeholder="₹"
                  />
                </Field>
                <Field label="Date" htmlFor="expense-date">
                  <input
                    id="expense-date"
                    type="date"
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                    className={controlClass()}
                  />
                </Field>
              </div>

              <Field
                label="Note"
                htmlFor="expense-note"
                required={category === 'other'}
                hint={category === 'other' ? 'Say what it was for' : undefined}
              >
                <input
                  id="expense-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  className={controlClass()}
                  placeholder={category === 'fuel' ? 'Litres, pump name' : 'Optional'}
                />
              </Field>

              <Button
                fullWidth
                loading={expenseMutation.isPending}
                disabled={amount.trim() === '' || Number(amount) <= 0}
                onClick={() => expenseMutation.mutate()}
              >
                Add expense
              </Button>
            </div>
          )}
        </section>

        {/* Proof of delivery */}
        <section>
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Delivery photo</h3>
          {trip.pod_file_url ? (
            <div className="flex items-center gap-2">
              <p className="flex-1 text-sm text-emerald-700">✓ Photo on file</p>
              <Button variant="secondary" size="sm" onClick={() => void viewPhoto()}>
                View
              </Button>
            </div>
          ) : (
            <p className="mb-2 text-sm text-slate-500">
              Take a photo of the signed LR at the drop point.
            </p>
          )}

          {!closed && (
            <label className="mt-2 flex min-h-[44px] w-full cursor-pointer items-center justify-center rounded-lg border border-dashed border-slate-300 text-sm font-medium text-slate-600 active:bg-slate-50">
              {uploading ? 'Uploading…' : trip.pod_file_url ? 'Replace photo' : 'Take photo'}
              <input
                type="file"
                accept="image/*,application/pdf"
                capture="environment"
                className="sr-only"
                disabled={uploading}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file) void onPhotoPicked(file)
                }}
              />
            </label>
          )}
        </section>
      </div>
    </Sheet>
  )
}
