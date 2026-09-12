import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { controlClass } from '@/components/ui/control'
import { Sheet } from '@/components/ui/Sheet'
import { toDateInput } from '@/lib/format'
import { zodForm } from '@/lib/form'
import type { Driver, Vehicle } from '@/types'
import type { DriverInput } from '@/lib/queries/drivers'

const optionalText = z
  .string()
  .optional()
  .transform((value) => value?.trim() || null)

const optionalDate = z
  .string()
  .optional()
  .transform((value) => (value && value.length > 0 ? value : null))

const driverSchema = z.object({
  name: z.string().min(1, 'Name is required').transform((value) => value.trim()),
  phone: z
    .string()
    .optional()
    .transform((value) => value?.replace(/\s+/g, '').trim() || null)
    .refine(
      (value) => value === null || /^(\+91)?[6-9]\d{9}$/.test(value),
      'Enter a 10-digit mobile number',
    ),
  license_no: optionalText,
  license_expiry: optionalDate,
  assigned_vehicle_id: z
    .string()
    .optional()
    .transform((value) => (value && value.length > 0 ? value : null)),
  salary_type: z.enum(['fixed', 'per_trip', 'percentage']),
  fixed_salary_amount: z
    .string()
    .optional()
    .transform((value) => (value && value.length > 0 ? Number(value) : null))
    .refine(
      (value) => value === null || (!Number.isNaN(value) && value >= 0),
      'Enter a valid amount',
    ),
  joining_date: optionalDate,
  status: z.enum(['active', 'inactive']),
})

type DriverFormValues = z.input<typeof driverSchema>
type DriverFormOutput = z.output<typeof driverSchema>

interface DriverFormProps {
  open: boolean
  driver: Driver | null
  vehicles: Vehicle[]
  saving: boolean
  onClose: () => void
  onSubmit: (values: DriverInput) => void
}

export function DriverForm({
  open,
  driver,
  vehicles,
  saving,
  onClose,
  onSubmit,
}: DriverFormProps) {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<DriverFormValues, unknown, DriverFormOutput>({
    resolver: zodForm(driverSchema),
    defaultValues: {
      name: driver?.name ?? '',
      phone: driver?.phone ?? '',
      license_no: driver?.license_no ?? '',
      license_expiry: toDateInput(driver?.license_expiry),
      assigned_vehicle_id: driver?.assigned_vehicle_id ?? '',
      salary_type: driver?.salary_type ?? 'fixed',
      fixed_salary_amount:
        driver?.fixed_salary_amount != null ? String(driver.fixed_salary_amount) : '',
      joining_date: toDateInput(driver?.joining_date),
      status: driver?.status ?? 'active',
    },
  })

  const salaryType = watch('salary_type')

  const submit = handleSubmit((values) => {
    onSubmit(values)
  })

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={driver ? 'Edit driver' : 'Add driver'}
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" fullWidth onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button fullWidth onClick={() => void submit()} loading={saving}>
            {driver ? 'Save changes' : 'Add driver'}
          </Button>
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name" htmlFor="name" required error={errors.name?.message}>
          <input
            id="name"
            className={controlClass(Boolean(errors.name))}
            {...register('name')}
          />
        </Field>

        <Field label="Phone" htmlFor="phone" error={errors.phone?.message}>
          <input
            id="phone"
            type="tel"
            inputMode="tel"
            placeholder="9876543210"
            className={controlClass(Boolean(errors.phone))}
            {...register('phone')}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Licence no." htmlFor="license_no">
            <input
              id="license_no"
              autoCapitalize="characters"
              className={controlClass()}
              {...register('license_no')}
            />
          </Field>

          <Field label="Licence expiry" htmlFor="license_expiry">
            <input
              id="license_expiry"
              type="date"
              className={controlClass()}
              {...register('license_expiry')}
            />
          </Field>
        </div>

        <Field
          label="Assigned vehicle"
          htmlFor="assigned_vehicle_id"
          hint="The truck this driver usually runs. Trip entry pre-fills from it."
        >
          <select
            id="assigned_vehicle_id"
            className={controlClass()}
            {...register('assigned_vehicle_id')}
          >
            <option value="">Not assigned</option>
            {vehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.reg_no}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Salary type" htmlFor="salary_type">
            <select id="salary_type" className={controlClass()} {...register('salary_type')}>
              <option value="fixed">Fixed monthly</option>
              <option value="per_trip">Per trip</option>
              <option value="percentage">% of freight</option>
            </select>
          </Field>

          <Field
            label={salaryType === 'percentage' ? 'Rate (%)' : 'Amount (₹)'}
            htmlFor="fixed_salary_amount"
            error={errors.fixed_salary_amount?.message}
          >
            <input
              id="fixed_salary_amount"
              inputMode="decimal"
              className={controlClass(Boolean(errors.fixed_salary_amount))}
              {...register('fixed_salary_amount')}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Joining date" htmlFor="joining_date">
            <input
              id="joining_date"
              type="date"
              className={controlClass()}
              {...register('joining_date')}
            />
          </Field>

          <Field label="Status" htmlFor="status">
            <select id="status" className={controlClass()} {...register('status')}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </Field>
        </div>
      </form>
    </Sheet>
  )
}
