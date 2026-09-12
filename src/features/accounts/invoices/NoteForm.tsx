import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { controlClass } from '@/components/ui/control'
import { Sheet } from '@/components/ui/Sheet'
import { useBusinessId } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import { describeError } from '@/lib/supabase'
import { formatCurrency, formatDate, todayInput } from '@/lib/format'
import { queryKeys } from '@/lib/queries/keys'
import { createNote, listNotes } from '@/lib/queries/invoices'
import type { InvoiceWithRelations, NoteType } from '@/types'

/**
 * Credit and debit notes against an invoice.
 *
 * A credit note reduces what the party owes (short delivery, rate correction
 * downward, damage); a debit note increases it (detention, extra halting,
 * under-billing). Both feed the ledger, so the balance stays right without the
 * original invoice being edited — which a GST invoice must not be.
 */
export function NoteForm({
  invoice,
  onClose,
  onSaved,
}: {
  invoice: InvoiceWithRelations
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const businessId = useBusinessId()
  const toast = useToast()

  const [type, setType] = useState<NoteType>('credit')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [date, setDate] = useState(todayInput())
  const [error, setError] = useState<string | null>(null)

  const notesQuery = useQuery({
    queryKey: queryKeys.notes(businessId, invoice.id),
    queryFn: () => listNotes(businessId, invoice.id),
  })

  const saveMutation = useMutation({
    mutationFn: () =>
      createNote(businessId, {
        invoice_id: invoice.id,
        party_type: invoice.party_type ?? 'client',
        party_id: invoice.party_id ?? '',
        type,
        amount: Number(amount),
        reason: reason.trim() || null,
        date,
      }),
    onSuccess: async () => {
      toast.success(type === 'credit' ? 'Credit note added' : 'Debit note added')
      await onSaved()
    },
    onError: (err) => toast.error(describeError(err)),
  })

  function submit() {
    setError(null)
    const value = Number(amount)

    if (!invoice.party_id) {
      setError('This invoice has no party recorded, so a note cannot be attributed.')
      return
    }
    if (!Number.isFinite(value) || value <= 0) {
      setError('Enter an amount above zero.')
      return
    }
    if (type === 'credit' && value > invoice.amount) {
      setError('A credit note cannot exceed the invoice total.')
      return
    }

    saveMutation.mutate()
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Note against ${invoice.invoice_number}`}
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
            Add note
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Invoice total</span>
            <span className="font-medium text-slate-900">
              {formatCurrency(invoice.amount)}
            </span>
          </div>
        </div>

        <Field label="Note type" htmlFor="note_type">
          <select
            id="note_type"
            value={type}
            onChange={(event) => setType(event.target.value as NoteType)}
            className={controlClass()}
          >
            <option value="credit">Credit note — reduces what they owe</option>
            <option value="debit">Debit note — increases what they owe</option>
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (₹)" htmlFor="note_amount" required>
            <input
              id="note_amount"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className={controlClass()}
            />
          </Field>

          <Field label="Date" htmlFor="note_date" required>
            <input
              id="note_date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className={controlClass()}
            />
          </Field>
        </div>

        <Field label="Reason" htmlFor="note_reason">
          <input
            id="note_reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className={controlClass()}
            placeholder={
              type === 'credit' ? 'e.g. Short delivery — 6 bags' : 'e.g. 2 days detention'
            }
          />
        </Field>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        {(notesQuery.data?.length ?? 0) > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              Existing notes
            </p>
            <div className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
              {notesQuery.data?.map((note) => (
                <div key={note.id} className="flex items-start justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">
                      {note.type === 'credit' ? 'Credit' : 'Debit'} note
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {formatDate(note.date)}
                      {note.reason && ` · ${note.reason}`}
                    </p>
                  </div>
                  <span
                    className={[
                      'shrink-0 text-sm font-semibold',
                      note.type === 'credit' ? 'text-emerald-600' : 'text-amber-600',
                    ].join(' ')}
                  >
                    {note.type === 'credit' ? '−' : '+'}
                    {formatCurrency(note.amount)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Sheet>
  )
}
