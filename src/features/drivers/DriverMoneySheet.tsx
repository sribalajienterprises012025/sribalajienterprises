import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { controlClass } from '@/components/ui/control'
import { Sheet } from '@/components/ui/Sheet'
import { Pill } from '@/components/ui/StatusPill'
import { useBusinessId, useIsOwner } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import { describeError } from '@/lib/supabase'
import { formatCurrency, formatDate, todayInput } from '@/lib/format'
import { queryKeys } from '@/lib/queries/keys'
import {
  createAdvance,
  createSalaryPayment,
  deleteAdvance,
  listAdvances,
  listSalaryPayments,
} from '@/lib/queries/drivers-money'
import { listDriverLedger } from '@/lib/queries/ledgers'
import type { Driver } from '@/types'

type Mode = 'advances' | 'salary'

/** First day of the previous month — the period a salary run usually covers. */
function lastMonthStart(): string {
  const now = new Date()
  const date = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`
}

export function DriverMoneySheet({
  driver,
  onClose,
}: {
  driver: Driver
  onClose: () => void
}) {
  const [mode, setMode] = useState<Mode>('advances')

  return (
    <Sheet open onClose={onClose} title={`${driver.name} — money`}>
      <div className="mb-4 inline-flex rounded-lg bg-slate-100 p-1">
        <button
          type="button"
          onClick={() => setMode('advances')}
          className={[
            'rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
            mode === 'advances' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500',
          ].join(' ')}
        >
          Advances
        </button>
        <button
          type="button"
          onClick={() => setMode('salary')}
          className={[
            'rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
            mode === 'salary' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500',
          ].join(' ')}
        >
          Salary
        </button>
      </div>

      {mode === 'advances' ? (
        <AdvancesPanel driver={driver} />
      ) : (
        <SalaryPanel driver={driver} />
      )}
    </Sheet>
  )
}

function AdvancesPanel({ driver }: { driver: Driver }) {
  const businessId = useBusinessId()
  const isOwner = useIsOwner()
  const toast = useToast()
  const queryClient = useQueryClient()

  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayInput())
  const [reason, setReason] = useState('')

  const advancesQuery = useQuery({
    queryKey: queryKeys.advances(businessId, driver.id),
    queryFn: () => listAdvances(businessId, driver.id),
  })

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['advances'] }),
      queryClient.invalidateQueries({ queryKey: ['driver-ledger'] }),
    ])
  }

  const addMutation = useMutation({
    mutationFn: () =>
      createAdvance(businessId, {
        driver_id: driver.id,
        date,
        amount: Number(amount),
        reason: reason.trim() || null,
        adjusted: false,
      }),
    onSuccess: async () => {
      await refresh()
      toast.success('Advance recorded')
      setAmount('')
      setReason('')
    },
    onError: (error) => toast.error(describeError(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAdvance(id),
    onSuccess: async () => {
      await refresh()
      toast.success('Advance removed')
    },
    onError: (error) => toast.error(describeError(error)),
  })

  const outstanding = useMemo(
    () =>
      (advancesQuery.data ?? [])
        .filter((advance) => !advance.adjusted)
        .reduce((sum, advance) => sum + advance.amount, 0),
    [advancesQuery.data],
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5">
        <span className="text-sm text-slate-500">Not yet recovered</span>
        <span className="text-sm font-semibold text-amber-600">
          {formatCurrency(outstanding)}
        </span>
      </div>

      {isOwner && (
        <div className="space-y-3 rounded-lg border border-slate-200 p-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (₹)" htmlFor="adv_amount" required>
              <input
                id="adv_amount"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className={controlClass()}
              />
            </Field>
            <Field label="Date" htmlFor="adv_date" required>
              <input
                id="adv_date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className={controlClass()}
              />
            </Field>
          </div>

          <Field label="Reason" htmlFor="adv_reason">
            <input
              id="adv_reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className={controlClass()}
              placeholder="e.g. Trip batta, Hyderabad–Nagpur"
            />
          </Field>

          <Button
            fullWidth
            loading={addMutation.isPending}
            disabled={!amount || Number(amount) <= 0}
            onClick={() => addMutation.mutate()}
          >
            Record advance
          </Button>
        </div>
      )}

      {(advancesQuery.data?.length ?? 0) === 0 ? (
        <p className="py-4 text-center text-sm text-slate-500">No advances recorded.</p>
      ) : (
        <div className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
          {advancesQuery.data?.map((advance) => (
            <div key={advance.id} className="flex items-start justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">
                  {formatCurrency(advance.amount)}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {formatDate(advance.date)}
                  {advance.reason && ` · ${advance.reason}`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {advance.adjusted ? (
                  <Pill label="Recovered" tone="success" />
                ) : (
                  <Pill label="Outstanding" tone="warning" />
                )}
                {isOwner && !advance.adjusted && (
                  <button
                    type="button"
                    onClick={() => deleteMutation.mutate(advance.id)}
                    className="text-xs font-medium text-slate-400 hover:text-red-600"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SalaryPanel({ driver }: { driver: Driver }) {
  const businessId = useBusinessId()
  const isOwner = useIsOwner()
  const toast = useToast()
  const queryClient = useQueryClient()

  const [period, setPeriod] = useState(lastMonthStart())
  const [earned, setEarned] = useState(String(driver.fixed_salary_amount ?? ''))
  const [otherDeductions, setOtherDeductions] = useState('')
  const [paid, setPaid] = useState('')
  const [deductAdvances, setDeductAdvances] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const advancesQuery = useQuery({
    queryKey: queryKeys.advances(businessId, driver.id),
    queryFn: () => listAdvances(businessId, driver.id),
  })

  const paymentsQuery = useQuery({
    queryKey: queryKeys.salaryPayments(businessId, driver.id),
    queryFn: () => listSalaryPayments(businessId, driver.id),
  })

  const ledgerQuery = useQuery({
    queryKey: queryKeys.driverLedger(businessId),
    queryFn: () => listDriverLedger(businessId),
  })

  const ledgerRow = ledgerQuery.data?.find((row) => row.driver_id === driver.id)

  const outstandingAdvances = useMemo(
    () => (advancesQuery.data ?? []).filter((advance) => !advance.adjusted),
    [advancesQuery.data],
  )

  const advanceTotal = outstandingAdvances.reduce((sum, advance) => sum + advance.amount, 0)
  const advancesDeducted = deductAdvances ? advanceTotal : 0
  const netPayable =
    Number(earned || 0) - advancesDeducted - Number(otherDeductions || 0)

  const saveMutation = useMutation({
    mutationFn: () =>
      createSalaryPayment(
        businessId,
        {
          driver_id: driver.id,
          period_month: period,
          salary_earned: Number(earned || 0),
          advances_deducted: advancesDeducted,
          other_deductions: Number(otherDeductions || 0),
          net_payable: netPayable,
          amount_paid: Number(paid || 0),
          paid_date: Number(paid || 0) > 0 ? todayInput() : null,
        },
        // Recovering an advance through a salary run is what marks it adjusted;
        // otherwise it keeps showing as outstanding after it has been recovered.
        deductAdvances ? outstandingAdvances.map((advance) => advance.id) : [],
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['salary-payments'] }),
        queryClient.invalidateQueries({ queryKey: ['advances'] }),
        queryClient.invalidateQueries({ queryKey: ['driver-ledger'] }),
      ])
      toast.success('Salary run recorded')
      setPaid('')
      setOtherDeductions('')
    },
    onError: (err) => toast.error(describeError(err)),
  })

  function submit() {
    setError(null)
    if (Number(earned || 0) <= 0) {
      setError('Enter the salary earned for the period.')
      return
    }
    if (netPayable < 0) {
      setError('Deductions exceed the salary earned. Check the amounts.')
      return
    }
    if (Number(paid || 0) > netPayable) {
      setError('Amount paid cannot exceed the net payable.')
      return
    }
    saveMutation.mutate()
  }

  return (
    <div className="space-y-4">
      {ledgerRow && (
        <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5">
          <span className="text-sm text-slate-500">Salary due to date</span>
          <span className="text-sm font-semibold text-slate-900">
            {formatCurrency(ledgerRow.salary_due)}
          </span>
        </div>
      )}

      {isOwner && (
        <div className="space-y-3 rounded-lg border border-slate-200 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            New salary run
          </p>

          <Field label="Period" htmlFor="sal_period" required hint="Any date in the month.">
            <input
              id="sal_period"
              type="date"
              value={period}
              onChange={(event) => {
                // Stored as the first of the month: the table is unique on
                // (driver, period_month), which only works if the day is fixed.
                const value = event.target.value
                setPeriod(value ? `${value.slice(0, 7)}-01` : value)
              }}
              className={controlClass()}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Salary earned (₹)" htmlFor="sal_earned" required>
              <input
                id="sal_earned"
                inputMode="decimal"
                value={earned}
                onChange={(event) => setEarned(event.target.value)}
                className={controlClass()}
              />
            </Field>

            <Field label="Other deductions (₹)" htmlFor="sal_other">
              <input
                id="sal_other"
                inputMode="decimal"
                value={otherDeductions}
                onChange={(event) => setOtherDeductions(event.target.value)}
                className={controlClass()}
              />
            </Field>
          </div>

          {advanceTotal > 0 && (
            <label className="flex items-start gap-2.5 rounded-lg bg-slate-50 p-3">
              <input
                type="checkbox"
                checked={deductAdvances}
                onChange={(event) => setDeductAdvances(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300"
              />
              <span className="text-sm text-slate-700">
                Recover {formatCurrency(advanceTotal)} in advances
                <span className="mt-0.5 block text-xs text-slate-500">
                  Marks {outstandingAdvances.length} outstanding advance
                  {outstandingAdvances.length === 1 ? '' : 's'} as recovered.
                </span>
              </span>
            </label>
          )}

          <div className="space-y-1.5 rounded-lg bg-white px-3 py-2.5 ring-1 ring-slate-200">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Salary earned</span>
              <span className="text-slate-900">{formatCurrency(Number(earned || 0))}</span>
            </div>
            {advancesDeducted > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Advances recovered</span>
                <span className="text-emerald-600">
                  −{formatCurrency(advancesDeducted)}
                </span>
              </div>
            )}
            {Number(otherDeductions || 0) > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Other deductions</span>
                <span className="text-emerald-600">
                  −{formatCurrency(Number(otherDeductions))}
                </span>
              </div>
            )}
            <div className="flex justify-between border-t border-slate-100 pt-1.5 text-sm font-semibold">
              <span className="text-slate-900">Net payable</span>
              <span className="text-slate-900">{formatCurrency(netPayable)}</span>
            </div>
          </div>

          <Field label="Paying now (₹)" htmlFor="sal_paid" hint="Leave blank to record the run without paying yet.">
            <input
              id="sal_paid"
              inputMode="decimal"
              value={paid}
              onChange={(event) => setPaid(event.target.value)}
              className={controlClass()}
            />
          </Field>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}

          <Button fullWidth loading={saveMutation.isPending} onClick={submit}>
            Record salary run
          </Button>
        </div>
      )}

      {(paymentsQuery.data?.length ?? 0) === 0 ? (
        <p className="py-4 text-center text-sm text-slate-500">No salary runs yet.</p>
      ) : (
        <div className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
          {paymentsQuery.data?.map((payment) => (
            <div key={payment.id} className="p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">
                    {new Date(payment.period_month).toLocaleDateString('en-IN', {
                      month: 'long',
                      year: 'numeric',
                    })}
                  </p>
                  <p className="text-xs text-slate-500">
                    Earned {formatCurrency(payment.salary_earned)}
                    {payment.advances_deducted > 0 &&
                      ` · advances −${formatCurrency(payment.advances_deducted)}`}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold text-slate-900">
                    {formatCurrency(payment.net_payable)}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    paid {formatCurrency(payment.amount_paid)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
