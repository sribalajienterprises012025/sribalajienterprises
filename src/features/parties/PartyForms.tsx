import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { controlClass } from '@/components/ui/control'
import { Sheet } from '@/components/ui/Sheet'
import type { Broker, Client } from '@/types'
import type { BrokerInput, ClientInput } from '@/lib/queries/parties'

const optionalText = z
  .string()
  .optional()
  .transform((value) => value?.trim() || null)

/**
 * 27AAAPA1234A1Z5 — state code, PAN, entity number, Z, checksum.
 * Validated because a wrong GSTIN on an invoice is a filing problem later.
 */
const gstinField = z
  .string()
  .optional()
  .transform((value) => value?.toUpperCase().replace(/\s+/g, '').trim() || null)
  .refine(
    (value) =>
      value === null ||
      /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}Z[A-Z\d]{1}$/.test(value),
    'Enter a valid 15-character GSTIN',
  )

const optionalAmount = z
  .string()
  .optional()
  .transform((value) => (value && value.length > 0 ? Number(value) : null))
  .refine(
    (value) => value === null || (!Number.isNaN(value) && value >= 0),
    'Enter a valid amount',
  )

const clientSchema = z.object({
  name: z.string().min(1, 'Name is required').transform((value) => value.trim()),
  gstin: gstinField,
  contact: optionalText,
  address: optionalText,
  credit_limit: optionalAmount,
  credit_period_days: optionalAmount.refine(
    (value) => value === null || Number.isInteger(value),
    'Enter whole days',
  ),
  status: z.enum(['active', 'inactive']),
})

const brokerSchema = z.object({
  name: z.string().min(1, 'Name is required').transform((value) => value.trim()),
  contact: optionalText,
  gstin: gstinField,
  commission_type: z.enum(['percentage', 'fixed']),
  commission_rate: optionalAmount,
  status: z.enum(['active', 'inactive']),
})

type ClientFormValues = z.input<typeof clientSchema>
type BrokerFormValues = z.input<typeof brokerSchema>

export function ClientForm({
  open,
  client,
  saving,
  onClose,
  onSubmit,
}: {
  open: boolean
  client: Client | null
  saving: boolean
  onClose: () => void
  onSubmit: (values: ClientInput) => void
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ClientFormValues>({
    resolver: zodResolver(clientSchema),
    defaultValues: {
      name: client?.name ?? '',
      gstin: client?.gstin ?? '',
      contact: client?.contact ?? '',
      address: client?.address ?? '',
      credit_limit: client?.credit_limit != null ? String(client.credit_limit) : '',
      credit_period_days:
        client?.credit_period_days != null ? String(client.credit_period_days) : '',
      status: client?.status ?? 'active',
    },
  })

  const submit = handleSubmit((values) => onSubmit(clientSchema.parse(values)))

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={client ? 'Edit client' : 'Add client'}
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" fullWidth onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button fullWidth onClick={() => void submit()} loading={saving}>
            {client ? 'Save changes' : 'Add client'}
          </Button>
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Client name" htmlFor="client-name" required error={errors.name?.message}>
          <input
            id="client-name"
            className={controlClass(Boolean(errors.name))}
            {...register('name')}
          />
        </Field>

        <Field label="GSTIN" htmlFor="client-gstin" error={errors.gstin?.message}>
          <input
            id="client-gstin"
            autoCapitalize="characters"
            placeholder="27AAAPA1234A1Z5"
            className={controlClass(Boolean(errors.gstin))}
            {...register('gstin')}
          />
        </Field>

        <Field label="Contact" htmlFor="client-contact">
          <input
            id="client-contact"
            placeholder="Name or phone"
            className={controlClass()}
            {...register('contact')}
          />
        </Field>

        <Field label="Address" htmlFor="client-address">
          <textarea
            id="client-address"
            rows={2}
            className={`${controlClass()} min-h-[72px]`}
            {...register('address')}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Credit limit (₹)"
            htmlFor="credit_limit"
            error={errors.credit_limit?.message}
          >
            <input
              id="credit_limit"
              inputMode="decimal"
              className={controlClass(Boolean(errors.credit_limit))}
              {...register('credit_limit')}
            />
          </Field>

          <Field
            label="Credit period (days)"
            htmlFor="credit_period_days"
            error={errors.credit_period_days?.message}
          >
            <input
              id="credit_period_days"
              inputMode="numeric"
              placeholder="30"
              className={controlClass(Boolean(errors.credit_period_days))}
              {...register('credit_period_days')}
            />
          </Field>
        </div>

        <Field label="Status" htmlFor="client-status">
          <select id="client-status" className={controlClass()} {...register('status')}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </Field>
      </form>
    </Sheet>
  )
}

export function BrokerForm({
  open,
  broker,
  saving,
  onClose,
  onSubmit,
}: {
  open: boolean
  broker: Broker | null
  saving: boolean
  onClose: () => void
  onSubmit: (values: BrokerInput) => void
}) {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<BrokerFormValues>({
    resolver: zodResolver(brokerSchema),
    defaultValues: {
      name: broker?.name ?? '',
      contact: broker?.contact ?? '',
      gstin: broker?.gstin ?? '',
      commission_type: broker?.commission_type ?? 'percentage',
      commission_rate:
        broker?.commission_rate != null ? String(broker.commission_rate) : '',
      status: broker?.status ?? 'active',
    },
  })

  const commissionType = watch('commission_type')
  const submit = handleSubmit((values) => onSubmit(brokerSchema.parse(values)))

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={broker ? 'Edit broker' : 'Add broker'}
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" fullWidth onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button fullWidth onClick={() => void submit()} loading={saving}>
            {broker ? 'Save changes' : 'Add broker'}
          </Button>
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Broker name" htmlFor="broker-name" required error={errors.name?.message}>
          <input
            id="broker-name"
            className={controlClass(Boolean(errors.name))}
            {...register('name')}
          />
        </Field>

        <Field label="Contact" htmlFor="broker-contact">
          <input
            id="broker-contact"
            placeholder="Name or phone"
            className={controlClass()}
            {...register('contact')}
          />
        </Field>

        <Field label="GSTIN" htmlFor="broker-gstin" error={errors.gstin?.message}>
          <input
            id="broker-gstin"
            autoCapitalize="characters"
            placeholder="27AAAPA1234A1Z5"
            className={controlClass(Boolean(errors.gstin))}
            {...register('gstin')}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Commission type" htmlFor="commission_type">
            <select
              id="commission_type"
              className={controlClass()}
              {...register('commission_type')}
            >
              <option value="percentage">Percentage</option>
              <option value="fixed">Fixed per trip</option>
            </select>
          </Field>

          <Field
            label={commissionType === 'percentage' ? 'Rate (%)' : 'Amount (₹)'}
            htmlFor="commission_rate"
            error={errors.commission_rate?.message}
          >
            <input
              id="commission_rate"
              inputMode="decimal"
              className={controlClass(Boolean(errors.commission_rate))}
              {...register('commission_rate')}
            />
          </Field>
        </div>

        <Field label="Status" htmlFor="broker-status">
          <select id="broker-status" className={controlClass()} {...register('status')}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </Field>
      </form>
    </Sheet>
  )
}
