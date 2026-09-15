import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { TripStatusPill } from '@/components/ui/StatusPill'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { Button } from '@/components/ui/Button'
import { useAuth, useBusinessId } from '@/hooks/useAuth'
import { useMasterData } from '@/hooks/useMasterData'
import {
  daysUntil,
  formatCurrency,
  formatCurrencyCompact,
  formatDateShort,
  plural,
} from '@/lib/format'
import { queryKeys } from '@/lib/queries/keys'
import { listTrips } from '@/lib/queries/trips'
import { listExpenses } from '@/lib/queries/expenses'
import { balanceDue } from '@/features/trips/tripSchema'

/** First day of the current month, in the yyyy-MM-dd shape Postgres expects. */
function startOfThisMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

const EXPIRY_WARNING_DAYS = 30

export function DashboardPage() {
  const businessId = useBusinessId()
  const { profile } = useAuth()
  const master = useMasterData()
  const monthStart = useMemo(startOfThisMonth, [])

  const tripsQuery = useQuery({
    queryKey: queryKeys.trips(businessId, { from: monthStart }),
    queryFn: () => listTrips(businessId, { from: monthStart }),
  })

  const expensesQuery = useQuery({
    queryKey: queryKeys.expenses(businessId, { from: monthStart }),
    queryFn: () => listExpenses(businessId, { from: monthStart }),
  })

  const summary = useMemo(() => {
    const trips = tripsQuery.data ?? []
    const expenses = expensesQuery.data ?? []

    const freight = trips
      .filter((trip) => trip.status !== 'cancelled')
      .reduce((sum, trip) => sum + trip.freight_amount, 0)

    // Outstanding covers every trip that has been run but not settled.
    // Cancelled trips and closed ones are excluded by definition.
    const outstanding = trips
      .filter((trip) => trip.status !== 'cancelled' && trip.status !== 'closed')
      .reduce((sum, trip) => sum + balanceDue(trip), 0)

    const spend = expenses.reduce((sum, expense) => sum + expense.amount, 0)

    return {
      tripCount: trips.filter((trip) => trip.status !== 'cancelled').length,
      freight,
      outstanding,
      spend,
      /** Freight minus direct expenses. Not a P&L — that lands in Phase 4. */
      margin: freight - spend,
      active: trips.filter(
        (trip) => trip.status === 'booked' || trip.status === 'in_transit',
      ),
    }
  }, [tripsQuery.data, expensesQuery.data])

  /** Vehicle and driver papers falling due inside the warning window. */
  const expiring = useMemo(() => {
    const items: Array<{ id: string; label: string; days: number }> = []

    for (const vehicle of master.vehicles) {
      const checks: Array<[string, string | null]> = [
        ['Insurance', vehicle.insurance_expiry],
        ['Permit', vehicle.permit_expiry],
        ['Fitness', vehicle.fitness_expiry],
      ]
      for (const [label, date] of checks) {
        const days = daysUntil(date)
        if (days !== null && days <= EXPIRY_WARNING_DAYS) {
          items.push({ id: `${vehicle.id}-${label}`, label: `${vehicle.reg_no} · ${label}`, days })
        }
      }
    }

    for (const driver of master.drivers) {
      const days = daysUntil(driver.license_expiry)
      if (days !== null && days <= EXPIRY_WARNING_DAYS) {
        items.push({ id: `${driver.id}-licence`, label: `${driver.name} · Licence`, days })
      }
    }

    return items.sort((a, b) => a.days - b.days)
  }, [master.vehicles, master.drivers])

  const isLoading = tripsQuery.isPending || expensesQuery.isPending
  const error = tripsQuery.error ?? expensesQuery.error

  const firstName = profile?.name?.split(' ')[0] ?? ''

  return (
    <>
      <PageHeader
        title={firstName ? `Hello, ${firstName}` : 'Dashboard'}
        subtitle="This month at a glance"
      />

      <div className="space-y-4 px-4 pb-4 lg:px-6">
        {error ? (
          <ErrorState
            error={error}
            onRetry={() => {
              void tripsQuery.refetch()
              void expensesQuery.refetch()
            }}
          />
        ) : isLoading ? (
          <LoadingState label="Loading your numbers…" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <StatTile
                label="Freight billed"
                value={formatCurrencyCompact(summary.freight)}
                detail={plural(summary.tripCount, 'trip')}
              />
              <StatTile
                label="Outstanding"
                value={formatCurrencyCompact(summary.outstanding)}
                detail="Yet to collect"
                tone={summary.outstanding > 0 ? 'warning' : 'neutral'}
              />
              <StatTile
                label="Expenses"
                value={formatCurrencyCompact(summary.spend)}
                detail="Paid out"
              />
              <StatTile
                label="Freight − expenses"
                value={formatCurrencyCompact(summary.margin)}
                detail="Before salaries and EMI"
                tone={summary.margin < 0 ? 'danger' : 'success'}
              />
            </div>

            {expiring.length > 0 && (
              <Card>
                <CardHeader title="Papers due soon" />
                <div className="divide-y divide-slate-100">
                  {expiring.slice(0, 5).map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between px-4 py-2.5"
                    >
                      <span className="truncate text-sm text-slate-700">{item.label}</span>
                      <span
                        className={[
                          'shrink-0 text-xs font-medium',
                          item.days < 0 ? 'text-red-600' : 'text-amber-600',
                        ].join(' ')}
                      >
                        {item.days < 0
                          ? `${Math.abs(item.days)}d overdue`
                          : `${item.days}d left`}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            <Card>
              <CardHeader
                title="On the road"
                action={
                  <Link
                    to="/trips"
                    className="inline-flex min-h-[40px] items-center px-2 text-sm font-medium text-brand-600"
                  >
                    All trips
                  </Link>
                }
              />
              {summary.active.length === 0 ? (
                <CardBody>
                  <p className="text-sm text-slate-500">
                    No trips booked or in transit right now.
                  </p>
                </CardBody>
              ) : (
                <div className="divide-y divide-slate-100">
                  {summary.active.slice(0, 5).map((trip) => (
                    <div key={trip.id} className="flex items-start justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">
                          {trip.pickup} → {trip.drop_location}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-slate-500">
                          {formatDateShort(trip.trip_date)}
                          {trip.vehicle && ` · ${trip.vehicle.reg_no}`}
                          {trip.driver && ` · ${trip.driver.name}`}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <TripStatusPill status={trip.status} />
                        <p className="mt-1 text-xs font-medium text-slate-600">
                          {formatCurrency(trip.freight_amount)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {master.vehicles.length === 0 && (
              <EmptyState
                icon="🚛"
                title="Set up your fleet"
                description="Add vehicles, drivers and parties, and the dashboard starts filling in on its own."
                action={
                  <Link to="/vehicles">
                    <Button>Add vehicles</Button>
                  </Link>
                }
              />
            )}
          </>
        )}
      </div>
    </>
  )
}

function StatTile({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string
  value: string
  detail: string
  tone?: 'neutral' | 'success' | 'warning' | 'danger'
}) {
  const valueTone = {
    neutral: 'text-slate-900',
    success: 'text-emerald-600',
    warning: 'text-amber-600',
    danger: 'text-red-600',
  }[tone]

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${valueTone}`}>{value}</p>
      <p className="mt-0.5 text-[11px] text-slate-400">{detail}</p>
    </div>
  )
}
