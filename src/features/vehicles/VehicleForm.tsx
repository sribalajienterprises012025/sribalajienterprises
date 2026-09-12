import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { controlClass } from '@/components/ui/control'
import { Sheet } from '@/components/ui/Sheet'
import { toDateInput } from '@/lib/format'
import { zodForm } from '@/lib/form'
import type { Vehicle } from '@/types'
import type { VehicleInput } from '@/lib/queries/vehicles'

/**
 * Empty date and number inputs come back as '' from the DOM. Postgres rejects
 * '' for a date or numeric column, so each optional field is normalised to null
 * before it leaves the form.
 */
const optionalDate = z
  .string()
  .optional()
  .transform((value) => (value && value.length > 0 ? value : null))

const optionalNumber = z
  .string()
  .optional()
  .transform((value) => (value && value.length > 0 ? Number(value) : null))
  .refine((value) => value === null || !Number.isNaN(value), 'Enter a valid number')

const vehicleSchema = z.object({
  reg_no: z
    .string()
    .min(1, 'Registration number is required')
    .transform((value) => value.toUpperCase().replace(/\s+/g, ' ').trim()),
  type: z.string().optional().transform((value) => value?.trim() || null),
  capacity: optionalNumber,
  purchase_date: optionalDate,
  insurance_expiry: optionalDate,
  permit_expiry: optionalDate,
  fitness_expiry: optionalDate,
  current_odometer: z
    .string()
    .optional()
    .transform((value) => (value && value.length > 0 ? Number(value) : 0))
    .refine((value) => !Number.isNaN(value) && value >= 0, 'Odometer cannot be negative'),
  status: z.enum(['active', 'in_maintenance', 'idle', 'sold']),
})

type VehicleFormValues = z.input<typeof vehicleSchema>
type VehicleFormOutput = z.output<typeof vehicleSchema>

interface VehicleFormProps {
  open: boolean
  vehicle: Vehicle | null
  saving: boolean
  onClose: () => void
  onSubmit: (values: VehicleInput) => void
}

export function VehicleForm({
  open,
  vehicle,
  saving,
  onClose,
  onSubmit,
}: VehicleFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<VehicleFormValues, unknown, VehicleFormOutput>({
    resolver: zodForm(vehicleSchema),
    // Remounting on open (see key below) means defaults are read fresh each
    // time, so editing a second vehicle never shows the first one's values.
    defaultValues: {
      reg_no: vehicle?.reg_no ?? '',
      type: vehicle?.type ?? '',
      capacity: vehicle?.capacity != null ? String(vehicle.capacity) : '',
      purchase_date: toDateInput(vehicle?.purchase_date),
      insurance_expiry: toDateInput(vehicle?.insurance_expiry),
      permit_expiry: toDateInput(vehicle?.permit_expiry),
      fitness_expiry: toDateInput(vehicle?.fitness_expiry),
      current_odometer: String(vehicle?.current_odometer ?? 0),
      status: vehicle?.status ?? 'active',
    },
  })

  const submit = handleSubmit((values) => {
    onSubmit({ ...values, assigned_driver_id: vehicle?.assigned_driver_id ?? null })
  })

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={vehicle ? 'Edit vehicle' : 'Add vehicle'}
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" fullWidth onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button fullWidth onClick={() => void submit()} loading={saving}>
            {vehicle ? 'Save changes' : 'Add vehicle'}
          </Button>
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Registration number" htmlFor="reg_no" required error={errors.reg_no?.message}>
          <input
            id="reg_no"
            autoCapitalize="characters"
            placeholder="TS 07 AB 1234"
            className={controlClass(Boolean(errors.reg_no))}
            {...register('reg_no')}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Type" htmlFor="type" error={errors.type?.message}>
            <input
              id="type"
              placeholder="Tipper, Container…"
              className={controlClass(Boolean(errors.type))}
              {...register('type')}
            />
          </Field>

          <Field label="Capacity (tonnes)" htmlFor="capacity" error={errors.capacity?.message}>
            <input
              id="capacity"
              inputMode="decimal"
              placeholder="16"
              className={controlClass(Boolean(errors.capacity))}
              {...register('capacity')}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Purchase date" htmlFor="purchase_date">
            <input
              id="purchase_date"
              type="date"
              className={controlClass()}
              {...register('purchase_date')}
            />
          </Field>

          <Field
            label="Odometer (km)"
            htmlFor="current_odometer"
            error={errors.current_odometer?.message}
          >
            <input
              id="current_odometer"
              inputMode="numeric"
              className={controlClass(Boolean(errors.current_odometer))}
              {...register('current_odometer')}
            />
          </Field>
        </div>

        <div className="rounded-lg bg-slate-50 p-3">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">
            Document expiry
          </p>
          <div className="space-y-3">
            <Field label="Insurance" htmlFor="insurance_expiry">
              <input
                id="insurance_expiry"
                type="date"
                className={controlClass()}
                {...register('insurance_expiry')}
              />
            </Field>
            <Field label="Permit" htmlFor="permit_expiry">
              <input
                id="permit_expiry"
                type="date"
                className={controlClass()}
                {...register('permit_expiry')}
              />
            </Field>
            <Field label="Fitness" htmlFor="fitness_expiry">
              <input
                id="fitness_expiry"
                type="date"
                className={controlClass()}
                {...register('fitness_expiry')}
              />
            </Field>
          </div>
        </div>

        <Field label="Status" htmlFor="status">
          <select id="status" className={controlClass()} {...register('status')}>
            <option value="active">Active</option>
            <option value="in_maintenance">In maintenance</option>
            <option value="idle">Idle</option>
            <option value="sold">Sold</option>
          </select>
        </Field>
      </form>
    </Sheet>
  )
}
