import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { controlClass } from '@/components/ui/control'
import { Sheet } from '@/components/ui/Sheet'
import { toDateInput, todayInput } from '@/lib/format'
import type { Expense, Vehicle } from '@/types'
import type { ExpenseInput } from '@/lib/queries/expenses'
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_VALUES } from './categories'

const expenseSchema = z.object({
  date: z.string().min(1, 'Date is required'),
  category: z.enum(EXPENSE_CATEGORY_VALUES),
  amount: z
    .string()
    .min(1, 'Amount is required')
    .transform((value) => Number(value))
    .refine((value) => !Number.isNaN(value) && value > 0, 'Enter an amount above zero'),
  vehicle_id: z
    .string()
    .optional()
    .transform((value) => (value && value.length > 0 ? value : null)),
  payment_mode: z.enum(['cash', 'upi', 'bank', 'card', 'credit']),
  note: z
    .string()
    .optional()
    .transform((value) => value?.trim() || null),
})

type ExpenseFormValues = z.input<typeof expenseSchema>

interface ExpenseFormProps {
  open: boolean
  expense: Expense | null
  vehicles: Vehicle[]
  saving: boolean
  onClose: () => void
  onSubmit: (values: ExpenseInput) => void
}

export function ExpenseForm({
  open,
  expense,
  vehicles,
  saving,
  onClose,
  onSubmit,
}: ExpenseFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      date: expense ? toDateInput(expense.date) : todayInput(),
      category: expense?.category ?? 'fuel',
      amount: expense ? String(expense.amount) : '',
      vehicle_id: expense?.vehicle_id ?? '',
      payment_mode: expense?.payment_mode ?? 'cash',
      note: expense?.note ?? '',
    },
  })

  const submit = handleSubmit((values) => {
    const parsed = expenseSchema.parse(values)
    // trip_id stays on the record when editing; linking an expense to a trip
    // from this form arrives with the Phase 3 distribution screens.
    onSubmit({ ...parsed, trip_id: expense?.trip_id ?? null })
  })

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={expense ? 'Edit expense' : 'Add expense'}
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" fullWidth onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button fullWidth onClick={() => void submit()} loading={saving}>
            {expense ? 'Save changes' : 'Add expense'}
          </Button>
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Amount (₹)" htmlFor="amount" required error={errors.amount?.message}>
          <input
            id="amount"
            inputMode="decimal"
            autoFocus
            placeholder="0"
            className={`${controlClass(Boolean(errors.amount))} text-lg font-semibold`}
            {...register('amount')}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Category" htmlFor="category">
            <select id="category" className={controlClass()} {...register('category')}>
              {EXPENSE_CATEGORIES.map((category) => (
                <option key={category.value} value={category.value}>
                  {category.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Date" htmlFor="date" required error={errors.date?.message}>
            <input
              id="date"
              type="date"
              className={controlClass(Boolean(errors.date))}
              {...register('date')}
            />
          </Field>
        </div>

        <Field
          label="Vehicle"
          htmlFor="vehicle_id"
          hint="Link the expense to a truck to get per-vehicle running costs."
        >
          <select id="vehicle_id" className={controlClass()} {...register('vehicle_id')}>
            <option value="">Not vehicle-specific</option>
            {vehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.reg_no}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Paid by" htmlFor="payment_mode">
          <select id="payment_mode" className={controlClass()} {...register('payment_mode')}>
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
            <option value="bank">Bank transfer</option>
            <option value="card">Card</option>
            <option value="credit">On credit</option>
          </select>
        </Field>

        <Field label="Note" htmlFor="note">
          <input
            id="note"
            placeholder="e.g. 60L at Shell, NH44"
            className={controlClass()}
            {...register('note')}
          />
        </Field>
      </form>
    </Sheet>
  )
}
