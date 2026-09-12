import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { controlClass } from '@/components/ui/control'
import { Sheet } from '@/components/ui/Sheet'
import { useToast } from '@/hooks/useToast'
import { describeError } from '@/lib/supabase'
import { formatNumber, todayInput } from '@/lib/format'
import { completeService } from '@/lib/queries/assetCare'
import type { ServiceDueRow } from '@/types'
import { serviceLabel } from './serviceTypes'

export function CompleteServiceSheet({
  schedule,
  onClose,
  onSaved,
}: {
  schedule: ServiceDueRow
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const toast = useToast()

  const [date, setDate] = useState(todayInput())
  const [odometer, setOdometer] = useState(String(schedule.current_odometer))
  const [cost, setCost] = useState('')
  const [vendor, setVendor] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const saveMutation = useMutation({
    mutationFn: () =>
      completeService({
        scheduleId: schedule.id,
        date,
        odometer: Number(odometer),
        cost: cost ? Number(cost) : 0,
        vendor: vendor.trim() || null,
        note: note.trim() || null,
      }),
    onSuccess: async () => {
      toast.success('Service logged and schedule reset')
      await onSaved()
    },
    onError: (err) => toast.error(describeError(err)),
  })

  function submit() {
    setError(null)
    const reading = Number(odometer)
    if (!Number.isFinite(reading) || reading < 0) {
      setError('Enter the odometer reading at the time of service.')
      return
    }
    if (
      schedule.last_done_odometer != null &&
      reading < schedule.last_done_odometer
    ) {
      setError(
        `That is below the last recorded service at ${formatNumber(schedule.last_done_odometer)} km.`,
      )
      return
    }
    saveMutation.mutate()
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={`${serviceLabel(schedule.service_type)} — ${schedule.reg_no}`}
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
            Log as done
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
          This logs the cost to the workshop history and restarts the interval from the
          reading below, in one step.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" htmlFor="svc_date" required>
            <input
              id="svc_date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className={controlClass()}
            />
          </Field>

          <Field
            label="Odometer (km)"
            htmlFor="svc_odo"
            required
            hint={`Now showing ${formatNumber(schedule.current_odometer)}`}
          >
            <input
              id="svc_odo"
              inputMode="numeric"
              value={odometer}
              onChange={(event) => setOdometer(event.target.value)}
              className={controlClass()}
            />
          </Field>
        </div>

        <Field label="Cost (₹)" htmlFor="svc_cost">
          <input
            id="svc_cost"
            inputMode="decimal"
            value={cost}
            onChange={(event) => setCost(event.target.value)}
            className={controlClass()}
            placeholder="0"
          />
        </Field>

        <Field label="Workshop" htmlFor="svc_vendor">
          <input
            id="svc_vendor"
            value={vendor}
            onChange={(event) => setVendor(event.target.value)}
            className={controlClass()}
            placeholder="e.g. Sri Ganesh Motors"
          />
        </Field>

        <Field label="Note" htmlFor="svc_note">
          <input
            id="svc_note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className={controlClass()}
            placeholder="Parts replaced, observations"
          />
        </Field>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}
      </div>
    </Sheet>
  )
}
