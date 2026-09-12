import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Pill } from '@/components/ui/StatusPill'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { useBusinessId, useCanEdit } from '@/hooks/useAuth'
import { formatCurrency, formatCurrencyCompact, humanize, plural } from '@/lib/format'
import { queryKeys } from '@/lib/queries/keys'
import {
  listBrokerLedger,
  listClientLedger,
  listDriverLedger,
} from '@/lib/queries/ledgers'
import type { BrokerLedgerRow, ClientLedgerRow, DriverLedgerRow } from '@/types'
import { PaymentForm } from './PaymentForm'

type Tab = 'clients' | 'brokers' | 'drivers'

export function LedgersPage() {
  const [tab, setTab] = useState<Tab>('clients')

  return (
    <>
      <PageHeader
        title="Ledgers"
        subtitle="Computed live from trips, invoices, notes and receipts"
      />

      <div className="px-4 lg:px-6">
        <div className="mb-4 inline-flex rounded-lg bg-slate-100 p-1">
          {(['clients', 'brokers', 'drivers'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={[
                'rounded-md px-4 py-1.5 text-sm font-medium capitalize transition-colors',
                tab === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500',
              ].join(' ')}
            >
              {value}
            </button>
          ))}
        </div>

        {tab === 'clients' && <ClientLedger />}
        {tab === 'brokers' && <BrokerLedger />}
        {tab === 'drivers' && <DriverLedger />}
      </div>
    </>
  )
}

/** Ledgers move whenever a trip, invoice, note or receipt does. */
function useLedgerRefresh() {
  const queryClient = useQueryClient()
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['client-ledger'] }),
      queryClient.invalidateQueries({ queryKey: ['broker-ledger'] }),
      queryClient.invalidateQueries({ queryKey: ['driver-ledger'] }),
      queryClient.invalidateQueries({ queryKey: ['payments'] }),
    ])
  }
}

function ClientLedger() {
  const businessId = useBusinessId()
  const canEdit = useCanEdit()
  const refresh = useLedgerRefresh()
  const [collecting, setCollecting] = useState<ClientLedgerRow | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const ledgerQuery = useQuery({
    queryKey: queryKeys.clientLedger(businessId),
    queryFn: () => listClientLedger(businessId),
  })

  const totalDue = useMemo(
    () => (ledgerQuery.data ?? []).reduce((sum, row) => sum + row.balance, 0),
    [ledgerQuery.data],
  )

  if (ledgerQuery.isPending) return <LoadingState label="Building the ledger…" />
  if (ledgerQuery.isError) {
    return <ErrorState error={ledgerQuery.error} onRetry={() => void ledgerQuery.refetch()} />
  }
  if (ledgerQuery.data.length === 0) {
    return (
      <EmptyState
        icon="🏢"
        title="No clients yet"
        description="Add clients and log trips against them, and the ledger builds itself."
      />
    )
  }

  return (
    <>
      <SummaryBar label="Total receivable" value={totalDue} tone={totalDue > 0 ? 'warning' : 'neutral'} />

      <div className="space-y-2.5 pb-4">
        {ledgerQuery.data.map((row) => {
          const overLimit =
            row.credit_limit != null && row.balance > row.credit_limit
          const isOpen = expanded === row.client_id

          return (
            <div key={row.client_id} className="rounded-xl border border-slate-200 bg-white p-4">
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : row.client_id)}
                className="flex w-full items-start justify-between gap-3 text-left"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">{row.client_name}</p>
                  <p className="mt-0.5 text-sm text-slate-500">
                    {plural(row.trip_count, 'trip')} · {plural(row.invoice_count, 'invoice')}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p
                    className={[
                      'font-semibold',
                      row.balance > 0 ? 'text-amber-600' : 'text-slate-900',
                    ].join(' ')}
                  >
                    {formatCurrency(row.balance)}
                  </p>
                  {overLimit && (
                    <span className="mt-1 inline-block">
                      <Pill label="Over limit" tone="danger" />
                    </span>
                  )}
                </div>
              </button>

              {isOpen && (
                <dl className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
                  <LedgerLine label="Opening balance" value={row.opening_balance} />
                  <LedgerLine label="Invoiced" value={row.invoiced} />
                  <LedgerLine label="Unbilled freight" value={row.unbilled_freight} />
                  <LedgerLine label="Debit notes" value={row.debit_notes} />
                  <LedgerLine label="Credit notes" value={-row.credit_notes} />
                  <LedgerLine label="Advances received" value={-row.advances_received} />
                  <LedgerLine label="TDS deducted" value={-row.tds_deducted} />
                  <LedgerLine label="Receipts" value={-row.receipts} />
                  <div className="flex justify-between border-t border-slate-100 pt-2 text-sm font-semibold">
                    <span className="text-slate-900">Balance</span>
                    <span className="text-slate-900">{formatCurrency(row.balance)}</span>
                  </div>
                  {row.credit_limit != null && (
                    <p className="pt-1 text-xs text-slate-400">
                      Credit limit {formatCurrency(row.credit_limit)}
                      {row.credit_period_days != null && ` · ${row.credit_period_days} days`}
                    </p>
                  )}
                </dl>
              )}

              {canEdit && row.balance > 0 && (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <Button size="sm" onClick={() => setCollecting(row)}>
                    Record receipt
                  </Button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {collecting && (
        <PaymentForm
          partyType="client"
          partyId={collecting.client_id}
          partyName={collecting.client_name}
          direction="in"
          outstanding={collecting.balance}
          onClose={() => setCollecting(null)}
          onSaved={async () => {
            await refresh()
            setCollecting(null)
          }}
        />
      )}
    </>
  )
}

function BrokerLedger() {
  const businessId = useBusinessId()
  const canEdit = useCanEdit()
  const refresh = useLedgerRefresh()
  const [paying, setPaying] = useState<BrokerLedgerRow | null>(null)

  const ledgerQuery = useQuery({
    queryKey: queryKeys.brokerLedger(businessId),
    queryFn: () => listBrokerLedger(businessId),
  })

  const totalPayable = useMemo(
    () => (ledgerQuery.data ?? []).reduce((sum, row) => sum + row.commission_payable, 0),
    [ledgerQuery.data],
  )

  if (ledgerQuery.isPending) return <LoadingState label="Building the ledger…" />
  if (ledgerQuery.isError) {
    return <ErrorState error={ledgerQuery.error} onRetry={() => void ledgerQuery.refetch()} />
  }
  if (ledgerQuery.data.length === 0) {
    return <EmptyState icon="🤝" title="No brokers yet" />
  }

  return (
    <>
      <SummaryBar label="Commission payable" value={totalPayable} tone="neutral" />

      <div className="space-y-2.5 pb-4">
        {ledgerQuery.data.map((row) => (
          <div key={row.broker_id} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-slate-900">{row.broker_name}</p>
                <p className="mt-0.5 text-sm text-slate-500">
                  {plural(row.trip_count, 'trip')} ·{' '}
                  {row.commission_type === 'percentage'
                    ? `${row.commission_rate ?? 0}%`
                    : formatCurrency(row.commission_rate)}
                </p>
              </div>
            </div>

            {/* Two directions at once, so both are shown rather than netted
                into one number nobody can reconcile. */}
            <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-400">
                  They owe us
                </p>
                <p className="text-sm font-semibold text-amber-600">
                  {formatCurrency(row.freight_receivable)}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-400">
                  We owe them
                </p>
                <p className="text-sm font-semibold text-slate-900">
                  {formatCurrency(row.commission_payable)}
                </p>
              </div>
            </div>

            <p className="mt-2 text-xs text-slate-400">
              Net: {formatCurrency(Math.abs(row.net_balance))}{' '}
              {row.net_balance >= 0 ? 'in your favour' : 'in theirs'}
            </p>

            {canEdit && row.commission_payable > 0 && (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <Button size="sm" variant="secondary" onClick={() => setPaying(row)}>
                  Pay commission
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      {paying && (
        <PaymentForm
          partyType="broker"
          partyId={paying.broker_id}
          partyName={paying.broker_name}
          direction="out"
          outstanding={paying.commission_payable}
          onClose={() => setPaying(null)}
          onSaved={async () => {
            await refresh()
            setPaying(null)
          }}
        />
      )}
    </>
  )
}

function DriverLedger() {
  const businessId = useBusinessId()

  const ledgerQuery = useQuery({
    queryKey: queryKeys.driverLedger(businessId),
    queryFn: () => listDriverLedger(businessId),
  })

  const totals = useMemo(() => {
    const rows = ledgerQuery.data ?? []
    return {
      advances: rows.reduce((sum, row) => sum + row.advances_outstanding, 0),
      salary: rows.reduce((sum, row) => sum + row.salary_due, 0),
    }
  }, [ledgerQuery.data])

  if (ledgerQuery.isPending) return <LoadingState label="Building the ledger…" />
  if (ledgerQuery.isError) {
    return <ErrorState error={ledgerQuery.error} onRetry={() => void ledgerQuery.refetch()} />
  }
  if (ledgerQuery.data.length === 0) {
    return <EmptyState icon="👤" title="No drivers yet" />
  }

  return (
    <>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Advances outstanding</p>
          <p className="mt-1 text-lg font-semibold text-amber-600">
            {formatCurrencyCompact(totals.advances)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Salary due</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">
            {formatCurrencyCompact(totals.salary)}
          </p>
        </div>
      </div>

      <div className="space-y-2.5 pb-4">
        {ledgerQuery.data.map((row: DriverLedgerRow) => (
          <div key={row.driver_id} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-slate-900">{row.driver_name}</p>
                <p className="mt-0.5 text-sm text-slate-500">
                  {humanize(row.salary_type)} · {plural(row.trip_count, 'trip')}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-semibold text-slate-900">
                  {formatCurrency(row.salary_due)}
                </p>
                <p className="text-[11px] text-slate-400">salary due</p>
              </div>
            </div>

            {row.advances_outstanding > 0 && (
              <p className="mt-2 text-xs font-medium text-amber-600">
                {formatCurrency(row.advances_outstanding)} advance not yet recovered
              </p>
            )}
          </div>
        ))}
      </div>

      <p className="pb-4 text-xs text-slate-400">
        Advances and salary runs are entered from a driver's page under Drivers.
      </p>
    </>
  )
}

function SummaryBar({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'neutral' | 'warning'
}) {
  return (
    <div className="mb-3 flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3">
      <span className="text-sm text-slate-500">{label}</span>
      <span
        className={[
          'text-lg font-semibold',
          tone === 'warning' ? 'text-amber-600' : 'text-slate-900',
        ].join(' ')}
      >
        {formatCurrency(value)}
      </span>
    </div>
  )
}

function LedgerLine({ label, value }: { label: string; value: number }) {
  if (value === 0) return null
  return (
    <div className="flex justify-between text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className={value < 0 ? 'text-emerald-600' : 'text-slate-900'}>
        {formatCurrency(value)}
      </dd>
    </div>
  )
}
