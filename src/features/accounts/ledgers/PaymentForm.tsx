import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { controlClass } from '@/components/ui/control'
import { Sheet } from '@/components/ui/Sheet'
import { useBusinessId } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import { describeError } from '@/lib/supabase'
import { formatCurrency, todayInput } from '@/lib/format'
import { createPayment } from '@/lib/queries/ledgers'
import type { PartyType, PaymentDirection, PaymentMethod } from '@/types'

const MODES: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'bank', label: 'Bank transfer / NEFT' },
  { value: 'upi', label: 'UPI' },
  { value: 'cash', label: 'Cash' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'card', label: 'Card' },
  { value: 'adjustment', label: 'Adjustment (no money moved)' },
]

/**
 * Records a receipt from a client, or a commission payout to a broker.
 *
 * A trip's own `advance_received` is recorded on the trip, not here — the
 * ledger subtracts both, so entering an advance again would double-count it.
 */
export function PaymentForm({
  partyType,
  partyId,
  partyName,
  direction,
  outstanding,
  onClose,
  onSaved,
}: {
  partyType: PartyType
  partyId: string
  partyName: string
  direction: PaymentDirection
  outstanding: number
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const businessId = useBusinessId()
  const toast = useToast()

  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayInput())
  const [mode, setMode] = useState<PaymentMethod>('bank')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const saveMutation = useMutation({
    mutationFn: () =>
      createPayment(businessId, {
        party_type: partyType,
        party_id: partyId,
        direction,
        date,
        amount: Number(amount),
        mode,
        reference: reference.trim() || null,
        invoice_id: null,
        trip_id: null,
        note: note.trim() || null,
      }),
    onSuccess: async () => {
      toast.success(direction === 'in' ? 'Receipt recorded' : 'Payment recorded')
      await onSaved()
    },
    onError: (err) => toast.error(describeError(err)),
  })

  function submit() {
    setError(null)
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) {
      setError('Enter an amount above zero.')
      return
    }
    saveMutation.mutate()
  }

  const isReceipt = direction === 'in'

  return (
    <Sheet
      open
      onClose={onClose}
      title={isReceipt ? `Receipt from ${partyName}` : `Pay ${partyName}`}
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
            {isReceipt ? 'Record receipt' : 'Record payment'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5">
          <span className="text-sm text-slate-500">
            {isReceipt ? 'Currently outstanding' : 'Currently payable'}
          </span>
          <span className="text-sm font-semibold text-slate-900">
            {formatCurrency(outstanding)}
          </span>
        </div>

        <Field label="Amount (₹)" htmlFor="pay_amount" required>
          <input
            id="pay_amount"
            inputMode="decimal"
            autoFocus
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className={`${controlClass()} text-lg font-semibold`}
            placeholder="0"
          />
        </Field>

        {outstanding > 0 && (
          <button
            type="button"
            onClick={() => setAmount(String(outstanding))}
            className="text-sm font-medium text-brand-600"
          >
            Settle in full — {formatCurrency(outstanding)}
          </button>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" htmlFor="pay_date" required>
            <input
              id="pay_date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className={controlClass()}
            />
          </Field>

          <Field label="Mode" htmlFor="pay_mode">
            <select
              id="pay_mode"
              value={mode}
              onChange={(event) => setMode(event.target.value as PaymentMethod)}
              className={controlClass()}
            >
              {MODES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field
          label="Reference"
          htmlFor="pay_reference"
          hint="UTR, cheque number or whatever you can match against the bank statement."
        >
          <input
            id="pay_reference"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            className={controlClass()}
          />
        </Field>

        <Field label="Note" htmlFor="pay_note">
          <input
            id="pay_note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className={controlClass()}
          />
        </Field>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <p className="text-xs text-slate-400">
          Advances collected at the time of a trip belong on the trip itself. Recording
          one here as well would count it twice.
        </p>
      </div>
    </Sheet>
  )
}
