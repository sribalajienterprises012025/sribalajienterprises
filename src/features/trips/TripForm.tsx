import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { controlClass } from '@/components/ui/control'
import { Sheet } from '@/components/ui/Sheet'
import { formatCurrency, toDateInput, todayInput } from '@/lib/format'
import type { Broker, Client, Driver, Trip, Vehicle } from '@/types'
import type { TripInput } from '@/lib/queries/trips'
import { balanceDue, tripSchema, type TripFormValues } from './tripSchema'

interface TripFormProps {
  open: boolean
  trip: Trip | null
  vehicles: Vehicle[]
  drivers: Driver[]
  clients: Client[]
  brokers: Broker[]
  saving: boolean
  onClose: () => void
  onSubmit: (values: TripInput) => void
}

export function TripForm({
  open,
  trip,
  vehicles,
  drivers,
  clients,
  brokers,
  saving,
  onClose,
  onSubmit,
}: TripFormProps) {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<TripFormValues>({
    resolver: zodResolver(tripSchema),
    defaultValues: {
      trip_date: trip ? toDateInput(trip.trip_date) : todayInput(),
      vehicle_id: trip?.vehicle_id ?? '',
      driver_id: trip?.driver_id ?? '',
      party_type: trip?.party_type ?? 'client',
      party_id: trip?.party_id ?? '',
      pickup: trip?.pickup ?? '',
      drop_location: trip?.drop_location ?? '',
      goods_description: trip?.goods_description ?? '',
      odometer_start: trip?.odometer_start != null ? String(trip.odometer_start) : '',
      odometer_end: trip?.odometer_end != null ? String(trip.odometer_end) : '',
      freight_amount: trip ? String(trip.freight_amount) : '',
      broker_commission: trip ? String(trip.broker_commission) : '',
      advance_received: trip ? String(trip.advance_received) : '',
      bill_type: trip?.bill_type ?? 'gst',
      lr_number: trip?.lr_number ?? '',
      eway_bill_no: trip?.eway_bill_no ?? '',
      tds_deducted: trip ? String(trip.tds_deducted) : '',
      status: trip?.status ?? 'booked',
      notes: trip?.notes ?? '',
    },
  })

  const partyType = watch('party_type')
  const partyId = watch('party_id')
  const vehicleId = watch('vehicle_id')
  const freight = Number(watch('freight_amount') || 0)
  const advance = Number(watch('advance_received') || 0)
  const tds = Number(watch('tds_deducted') || 0)

  // Switching client <-> broker leaves a party_id pointing at the wrong table,
  // which would insert a dangling reference (party_id is polymorphic, so there
  // is no foreign key to stop it).
  useEffect(() => {
    const validIds = partyType === 'client' ? clients : brokers
    if (partyId && !validIds.some((party) => party.id === partyId)) {
      setValue('party_id', '')
    }
  }, [partyType, partyId, clients, brokers, setValue])

  // Selecting a vehicle pre-fills the opening odometer from the vehicle's last
  // known reading. Only on a new trip, so an edit never overwrites real data.
  useEffect(() => {
    if (trip || !vehicleId) return
    const vehicle = vehicles.find((item) => item.id === vehicleId)
    if (vehicle) setValue('odometer_start', String(vehicle.current_odometer))
  }, [vehicleId, vehicles, trip, setValue])

  // A broker's commission follows their agreed rate; still editable, because a
  // one-off load is often negotiated away from the standing rate.
  useEffect(() => {
    if (trip || partyType !== 'broker' || !partyId || freight <= 0) return
    const broker = brokers.find((item) => item.id === partyId)
    if (!broker || broker.commission_rate == null) return

    const commission =
      broker.commission_type === 'percentage'
        ? Math.round((freight * broker.commission_rate) / 100)
        : broker.commission_rate

    setValue('broker_commission', String(commission))
  }, [trip, partyType, partyId, freight, brokers, setValue])

  const parties = partyType === 'client' ? clients : brokers
  const submit = handleSubmit((values) => onSubmit(tripSchema.parse(values) as TripInput))

  const due = balanceDue({
    freight_amount: freight,
    advance_received: advance,
    tds_deducted: tds,
  })

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={trip ? 'Edit trip' : 'New trip'}
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" fullWidth onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button fullWidth onClick={() => void submit()} loading={saving}>
            {trip ? 'Save changes' : 'Save trip'}
          </Button>
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Trip date" htmlFor="trip_date" required error={errors.trip_date?.message}>
            <input
              id="trip_date"
              type="date"
              className={controlClass(Boolean(errors.trip_date))}
              {...register('trip_date')}
            />
          </Field>

          <Field label="Status" htmlFor="status">
            <select id="status" className={controlClass()} {...register('status')}>
              <option value="booked">Booked</option>
              <option value="in_transit">In transit</option>
              <option value="delivered">Delivered</option>
              <option value="payment_pending">Payment pending</option>
              <option value="closed">Closed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Vehicle" htmlFor="vehicle_id">
            <select id="vehicle_id" className={controlClass()} {...register('vehicle_id')}>
              <option value="">Select vehicle</option>
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.reg_no}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Driver" htmlFor="driver_id">
            <select id="driver_id" className={controlClass()} {...register('driver_id')}>
              <option value="">Select driver</option>
              {drivers.map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Party type" htmlFor="party_type">
            <select id="party_type" className={controlClass()} {...register('party_type')}>
              <option value="client">Client</option>
              <option value="broker">Broker</option>
            </select>
          </Field>

          <Field
            label={partyType === 'client' ? 'Client' : 'Broker'}
            htmlFor="party_id"
            required
            error={errors.party_id?.message}
          >
            <select
              id="party_id"
              className={controlClass(Boolean(errors.party_id))}
              {...register('party_id')}
            >
              <option value="">Select {partyType}</option>
              {parties.map((party) => (
                <option key={party.id} value={party.id}>
                  {party.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Pickup" htmlFor="pickup" required error={errors.pickup?.message}>
          <input
            id="pickup"
            placeholder="e.g. Hyderabad"
            className={controlClass(Boolean(errors.pickup))}
            {...register('pickup')}
          />
        </Field>

        <Field label="Drop" htmlFor="drop_location" required error={errors.drop_location?.message}>
          <input
            id="drop_location"
            placeholder="e.g. Nagpur"
            className={controlClass(Boolean(errors.drop_location))}
            {...register('drop_location')}
          />
        </Field>

        <Field label="Goods" htmlFor="goods_description">
          <input
            id="goods_description"
            placeholder="e.g. Cement bags, 400 nos"
            className={controlClass()}
            {...register('goods_description')}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Odometer start"
            htmlFor="odometer_start"
            error={errors.odometer_start?.message}
          >
            <input
              id="odometer_start"
              inputMode="numeric"
              className={controlClass(Boolean(errors.odometer_start))}
              {...register('odometer_start')}
            />
          </Field>

          <Field
            label="Odometer end"
            htmlFor="odometer_end"
            error={errors.odometer_end?.message}
          >
            <input
              id="odometer_end"
              inputMode="numeric"
              className={controlClass(Boolean(errors.odometer_end))}
              {...register('odometer_end')}
            />
          </Field>
        </div>

        <div className="space-y-3 rounded-lg bg-slate-50 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Money
          </p>

          <Field
            label="Freight amount (₹)"
            htmlFor="freight_amount"
            required
            error={errors.freight_amount?.message}
          >
            <input
              id="freight_amount"
              inputMode="decimal"
              className={controlClass(Boolean(errors.freight_amount))}
              {...register('freight_amount')}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Advance received (₹)"
              htmlFor="advance_received"
              error={errors.advance_received?.message}
            >
              <input
                id="advance_received"
                inputMode="decimal"
                className={controlClass(Boolean(errors.advance_received))}
                {...register('advance_received')}
              />
            </Field>

            <Field
              label="TDS deducted (₹)"
              htmlFor="tds_deducted"
              error={errors.tds_deducted?.message}
            >
              <input
                id="tds_deducted"
                inputMode="decimal"
                className={controlClass(Boolean(errors.tds_deducted))}
                {...register('tds_deducted')}
              />
            </Field>
          </div>

          {partyType === 'broker' && (
            <Field
              label="Broker commission (₹)"
              htmlFor="broker_commission"
              hint="Pre-filled from the broker's agreed rate. Edit if this load differs."
              error={errors.broker_commission?.message}
            >
              <input
                id="broker_commission"
                inputMode="decimal"
                className={controlClass(Boolean(errors.broker_commission))}
                {...register('broker_commission')}
              />
            </Field>
          )}

          <div className="flex items-center justify-between rounded-lg bg-white px-3 py-2.5">
            <span className="text-sm text-slate-600">Balance due</span>
            <span className="text-sm font-semibold text-slate-900">
              {formatCurrency(due)}
            </span>
          </div>
        </div>

        <div className="space-y-3 rounded-lg bg-slate-50 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Billing &amp; compliance
          </p>

          <Field label="Bill type" htmlFor="bill_type">
            <select id="bill_type" className={controlClass()} {...register('bill_type')}>
              <option value="gst">GST</option>
              <option value="non_gst">Non-GST</option>
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="LR number" htmlFor="lr_number">
              <input
                id="lr_number"
                autoCapitalize="characters"
                className={controlClass()}
                {...register('lr_number')}
              />
            </Field>

            <Field label="E-way bill no." htmlFor="eway_bill_no">
              <input
                id="eway_bill_no"
                inputMode="numeric"
                className={controlClass()}
                {...register('eway_bill_no')}
              />
            </Field>
          </div>
        </div>

        <Field label="Notes" htmlFor="notes">
          <textarea
            id="notes"
            rows={2}
            className={`${controlClass()} min-h-[72px]`}
            {...register('notes')}
          />
        </Field>
      </form>
    </Sheet>
  )
}
