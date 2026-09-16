import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '@/components/ui/PageHeader'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { Pill } from '@/components/ui/StatusPill'
import { useDriverId } from '@/hooks/useAuth'
import { formatCurrency, formatDate, humanize } from '@/lib/format'
import { queryKeys } from '@/lib/queries/keys'
import { getMyMoney, listMyAdvances, listMySalaryRuns } from '@/lib/queries/driver'

/**
 * What the driver is owed and what they have taken.
 *
 * The same arithmetic the owner sees on the driver ledger, so the two can be
 * held up against each other — which is the point of showing it at all. A
 * disagreement about an advance is settled by both sides reading the same
 * figure instead of one side's notebook.
 */
export function MyMoneyPage() {
  const driverId = useDriverId() ?? 'none'

  const moneyQuery = useQuery({
    queryKey: queryKeys.myMoney(driverId),
    queryFn: getMyMoney,
  })
  const advancesQuery = useQuery({
    queryKey: queryKeys.myAdvances(driverId),
    queryFn: listMyAdvances,
  })
  const runsQuery = useQuery({
    queryKey: queryKeys.mySalaryRuns(driverId),
    queryFn: listMySalaryRuns,
  })

  const money = moneyQuery.data

  return (
    <div className="pb-6">
      <PageHeader title="My money" subtitle={money?.driver_name ?? undefined} />

      {moneyQuery.isPending && <LoadingState label="Loading…" />}
      {moneyQuery.isError && (
        <ErrorState error={moneyQuery.error} onRetry={() => void moneyQuery.refetch()} />
      )}

      {moneyQuery.isSuccess && !money && (
        <EmptyState
          icon="💰"
          title="Nothing recorded yet"
          description="Your salary and advances will show here once the office records them."
        />
      )}

      {money && (
        <div className="space-y-5 px-4 lg:px-6">
          <div className="grid grid-cols-2 gap-3">
            <Stat
              label="Still to be paid"
              value={formatCurrency(Number(money.salary_due))}
              tone={Number(money.salary_due) > 0 ? 'good' : 'plain'}
            />
            <Stat
              label="Advance to recover"
              value={formatCurrency(Number(money.advances_outstanding))}
              tone={Number(money.advances_outstanding) > 0 ? 'warn' : 'plain'}
            />
            <Stat label="Earned so far" value={formatCurrency(Number(money.salary_earned))} />
            <Stat label="Trips driven" value={String(money.trip_count)} />
          </div>

          <p className="text-xs leading-relaxed text-slate-500">
            {humanize(money.salary_type)} salary
            {money.fixed_salary_amount != null
              ? ` · ${formatCurrency(Number(money.fixed_salary_amount))} a month`
              : ''}
            . An advance you have taken is recovered from a later salary run, so it
            lowers what is still to be paid without lowering what you earned.
          </p>

          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Advances taken
            </h2>
            {advancesQuery.data?.length ? (
              <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
                {advancesQuery.data.map((advance) => (
                  <li key={advance.id} className="flex items-center justify-between px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm text-slate-900">
                        {formatCurrency(Number(advance.amount))}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {formatDate(advance.date)}
                        {advance.reason ? ` · ${advance.reason}` : ''}
                      </p>
                    </div>
                    <Pill
                      label={advance.adjusted ? 'Recovered' : 'Outstanding'}
                      tone={advance.adjusted ? 'neutral' : 'warning'}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-xl border border-slate-200 bg-white px-3 py-4 text-sm text-slate-500">
                No advances taken.
              </p>
            )}
          </section>

          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Salary runs
            </h2>
            {runsQuery.data?.length ? (
              <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
                {runsQuery.data.map((run) => {
                  const pending = Number(run.net_payable) - Number(run.amount_paid)
                  return (
                    <li key={run.id} className="px-3 py-2.5">
                      <div className="flex items-baseline justify-between">
                        <p className="text-sm font-medium text-slate-900">
                          {formatDate(run.period_month)}
                        </p>
                        <p className="text-sm text-slate-900">
                          {formatCurrency(Number(run.salary_earned))}
                        </p>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {Number(run.advances_deducted) > 0 &&
                          `less ${formatCurrency(Number(run.advances_deducted))} advance · `}
                        paid {formatCurrency(Number(run.amount_paid))}
                        {pending > 0 ? ` · ${formatCurrency(pending)} pending` : ''}
                      </p>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="rounded-xl border border-slate-200 bg-white px-3 py-4 text-sm text-slate-500">
                No salary run recorded yet.
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  tone = 'plain',
}: {
  label: string
  value: string
  tone?: 'plain' | 'good' | 'warn'
}) {
  const valueClass =
    tone === 'good' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : 'text-slate-900'

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${valueClass}`}>{value}</p>
    </div>
  )
}
