import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { controlClass } from '@/components/ui/control'
import { Sheet } from '@/components/ui/Sheet'
import { useBusinessId } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import { describeError } from '@/lib/supabase'
import { formatCurrency, toDateInput } from '@/lib/format'
import { queryKeys } from '@/lib/queries/keys'
import {
  clearOpeningBalance,
  listOpeningBalances,
  setOpeningBalance,
} from '@/lib/queries/openingBalances'
import type { OpeningBalancePartyType } from '@/types'

/**
 * The balance carried in from before the app was in use.
 *
 * Without this a business that starts mid-year shows every party as square on
 * day one, and the ledgers are quietly wrong until someone notices. It is a
 * single figure per party, not a history, so saving replaces any earlier one.
 */
export function OpeningBalanceSheet({
  partyType,
  partyId,
  partyName,
  onClose,
}: {
  partyType: OpeningBalancePartyType
  partyId: string
  partyName: string
  onClose: () => void
}) {
  const businessId = useBusinessId()
  const toast = useToast()
  const queryClient = useQueryClient()

  const balancesQuery = useQuery({
    queryKey: queryKeys.openingBalances(businessId),
    queryFn: () => listOpeningBalances(businessId),
  })

  const existing = useMemo(
    () =>
      (balancesQuery.data ?? []).find(
        (row) => row.party_type === partyType && row.party_id === partyId,
      ),
    [balancesQuery.data, partyType, partyId],
  )

  // The business owes brokers and drivers more often than the reverse, so the
  // direction is a choice rather than a minus sign the user has to remember.
  const [direction, setDirection] = useState<'they_owe' | 'we_owe'>(
    existing && existing.amount < 0 ? 'we_owe' : 'they_owe',
  )
  const [amount, setAmount] = useState(
    existing ? String(Math.abs(existing.amount)) : '',
  )
  const [asOf, setAsOf] = useState(
    existing ? toDateInput(existing.as_of_date) : financialYearStart(),
  )
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['opening-balances'] }),
      queryClient.invalidateQueries({ queryKey: ['client-ledger'] }),
      queryClient.invalidateQueries({ queryKey: ['broker-ledger'] }),
      queryClient.invalidateQueries({ queryKey: ['driver-ledger'] }),
    ])
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      setOpeningBalance(businessId, {
        party_type: partyType,
        party_id: partyId,
        amount: direction === 'we_owe' ? -Math.abs(Number(amount)) : Math.abs(Number(amount)),
        as_of_date: asOf,
      }),
    onSuccess: async () => {
      await refresh()
      toast.success('Opening balance saved')
      onClose()
    },
    onError: (err) => toast.error(describeError(err)),
  })

  const clearMutation = useMutation({
    mutationFn: () => clearOpeningBalance(businessId, partyType, partyId),
    onSuccess: async () => {
      await refresh()
      toast.success('Opening balance cleared')
      onClose()
    },
    onError: (err) => toast.error(describeError(err)),
  })

  function submit() {
    setError(null)
    const value = Number(amount)
    if (!Number.isFinite(value) || value < 0) {
      setError('Enter the amount carried forward, or clear it below.')
      return
    }
    saveMutation.mutate()
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Opening balance — ${partyName}`}
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
            Save
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
          What was already outstanding before you started using this app. The ledger
          adds this to everything recorded since, so a business starting mid-year does
          not show every party as square on day one.
        </p>

        {existing && (
          <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5">
            <span className="text-sm text-slate-500">Currently set</span>
            <span className="text-sm font-semibold text-slate-900">
              {formatCurrency(Math.abs(existing.amount))}{' '}
              <span className="font-normal text-slate-500">
                {existing.amount < 0 ? 'we owe' : 'they owe'}
              </span>
            </span>
          </div>
        )}

        <Field label="Direction" htmlFor="ob_direction">
          <select
            id="ob_direction"
            value={direction}
            onChange={(event) =>
              setDirection(event.target.value as 'they_owe' | 'we_owe')
            }
            className={controlClass()}
          >
            <option value="they_owe">They owe us</option>
            <option value="we_owe">We owe them</option>
          </select>
        </Field>

        <Field label="Amount (₹)" htmlFor="ob_amount" required>
          <input
            id="ob_amount"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className={`${controlClass()} text-lg font-semibold`}
            placeholder="0"
          />
        </Field>

        <Field
          label="As of"
          htmlFor="ob_date"
          hint="Usually the first day of the financial year you started from."
        >
          <input
            id="ob_date"
            type="date"
            value={asOf}
            onChange={(event) => setAsOf(event.target.value)}
            className={controlClass()}
          />
        </Field>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        {existing && (
          <Button
            variant="ghost"
            fullWidth
            loading={clearMutation.isPending}
            onClick={() => clearMutation.mutate()}
          >
            Clear opening balance
          </Button>
        )}
      </div>
    </Sheet>
  )
}

/** 1 April of the current Indian financial year — the usual starting point. */
function financialYearStart(): string {
  const now = new Date()
  const year = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1
  return `${year}-04-01`
}
