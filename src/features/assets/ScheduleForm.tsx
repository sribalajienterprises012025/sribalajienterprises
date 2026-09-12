import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { controlClass } from '@/components/ui/control'
import { Sheet } from '@/components/ui/Sheet'
import { useBusinessId } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import { describeError } from '@/lib/supabase'
import { toDateInput } from '@/lib/format'
import { createSchedule } from '@/lib/queries/assetCare'
import type { ServiceType, Vehicle } from '@/types'
import { SERVICE_TYPES } from './serviceTypes'

export function ScheduleForm({
  vehicles,
  onClose,
  onSaved,
}: {
  vehicles: Vehicle[]
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const businessId = useBusinessId()
  const toast = useToast()

  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? '')
  const [serviceType, setServiceType] = useState<ServiceType>('engine_oil')
  const [intervalKm, setIntervalKm] = useState('15000')
  const [intervalDays, setIntervalDays] = useState('')
  const [lastOdometer, setLastOdometer] = useState('')
  const [lastDate, setLastDate] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Picking a service type fills in the interval that is typical for it.
  useEffect(() => {
    const preset = SERVICE_TYPES.find((item) => item.value === serviceType)
    if (!preset) return
    setIntervalKm(preset.defaultKm != null ? String(preset.defaultKm) : '')
    setIntervalDays(preset.defaultDays != null ? String(preset.defaultDays) : '')
  }, [serviceType])

  // The vehicle's current odometer is the natural baseline for a schedule set
  // up today, so it is offered rather than left blank.
  useEffect(() => {
    const vehicle = vehicles.find((item) => item.id === vehicleId)
    if (vehicle) setLastOdometer(String(vehicle.current_odometer))
  }, [vehicleId, vehicles])

  const saveMutation = useMutation({
    mutationFn: () =>
      createSchedule(businessId, {
        vehicle_id: vehicleId,
        service_type: serviceType,
        interval_km: intervalKm ? Number(intervalKm) : null,
        interval_days: intervalDays ? Number(intervalDays) : null,
        last_done_odometer: lastOdometer ? Number(lastOdometer) : null,
        last_done_date: lastDate || null,
        note: note.trim() || null,
        active: true,
      }),
    onSuccess: async () => {
      toast.success('Schedule added')
      await onSaved()
    },
    onError: (err) => toast.error(describeError(err)),
  })

  function submit() {
    setError(null)
    if (!vehicleId) {
      setError('Choose a vehicle.')
      return
    }
    // Mirrors the service_schedules_needs_an_interval constraint: a schedule
    // with neither interval can never come due.
    if (!intervalKm && !intervalDays) {
      setError('Set an interval in kilometres, in days, or both.')
      return
    }
    saveMutation.mutate()
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Add service schedule"
      footer={
        <div className="flex gap-3">
          <Button
            variant="secondary"
            fullWidth
            onClick={onClose}
            disabled={saveMutation.isPending}
          >
            Cancel
          </Button>
          <Button fullWidth onClick={submit} loading={saveMutation.isPending}>
            Add schedule
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Vehicle" htmlFor="sched_vehicle" required>
            <select
              id="sched_vehicle"
              value={vehicleId}
              onChange={(event) => setVehicleId(event.target.value)}
              className={controlClass()}
            >
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.reg_no}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Service" htmlFor="sched_type">
            <select
              id="sched_type"
              value={serviceType}
              onChange={(event) => setServiceType(event.target.value as ServiceType)}
              className={controlClass()}
            >
              {SERVICE_TYPES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Every (km)"
            htmlFor="sched_km"
            hint="Leave blank for a time-only schedule."
          >
            <input
              id="sched_km"
              inputMode="numeric"
              value={intervalKm}
              onChange={(event) => setIntervalKm(event.target.value)}
              className={controlClass()}
            />
          </Field>

          <Field label="Every (days)" htmlFor="sched_days">
            <input
              id="sched_days"
              inputMode="numeric"
              value={intervalDays}
              onChange={(event) => setIntervalDays(event.target.value)}
              className={controlClass()}
            />
          </Field>
        </div>

        <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
          With both set, whichever comes first is what shows as due.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Last done at (km)"
            htmlFor="sched_last_km"
            hint="Defaults to the truck's current reading."
          >
            <input
              id="sched_last_km"
              inputMode="numeric"
              value={lastOdometer}
              onChange={(event) => setLastOdometer(event.target.value)}
              className={controlClass()}
            />
          </Field>

          <Field label="Last done on" htmlFor="sched_last_date">
            <input
              id="sched_last_date"
              type="date"
              max={toDateInput(new Date())}
              value={lastDate}
              onChange={(event) => setLastDate(event.target.value)}
              className={controlClass()}
            />
          </Field>
        </div>

        <Field label="Note" htmlFor="sched_note">
          <input
            id="sched_note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className={controlClass()}
            placeholder="e.g. Use 15W-40 only"
          />
        </Field>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}
      </div>
    </Sheet>
  )
}
