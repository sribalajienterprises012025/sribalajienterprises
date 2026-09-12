import { useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { controlClass } from '@/components/ui/control'
import { Pill } from '@/components/ui/StatusPill'
import { ErrorState, LoadingState } from '@/components/ui/States'
import { useBusinessId } from '@/hooks/useAuth'
import { useMasterData } from '@/hooks/useMasterData'
import { useToast } from '@/hooks/useToast'
import { describeError } from '@/lib/supabase'
import {
  formatCurrency,
  formatCurrencyCompact,
  formatCurrencyPdf,
  formatKm,
  formatNumber,
} from '@/lib/format'
import { stateName } from '@/lib/gst'
import { queryKeys } from '@/lib/queries/keys'
import { getBusiness } from '@/lib/queries/business'
import {
  getComplianceGaps,
  getGstSummary,
  getMonthlyPl,
  getVehicleMonthly,
  totalByVehicle,
  totalPl,
} from '@/lib/queries/reports'
import { listInvoices } from '@/lib/queries/invoices'
import {
  listBrokerLedger,
  listClientLedger,
  listDriverLedger,
  listTripFinancials,
} from '@/lib/queries/ledgers'
import { exportCaPack } from '@/lib/export/caPack'
import { exportExcel } from '@/lib/export/excel'
import { exportReportPdf } from '@/lib/export/pdf'
import { namedRanges } from './dateRanges'

type Report = 'pl' | 'gst' | 'vehicles' | 'compliance'

const monthLabel = (month: string) => format(parseISO(month), 'MMM yyyy')

export function ReportsPage() {
  const businessId = useBusinessId()
  const toast = useToast()
  const master = useMasterData()

  const businessQuery = useQuery({
    queryKey: queryKeys.business(businessId),
    queryFn: () => getBusiness(businessId),
  })

  const ranges = useMemo(
    () => namedRanges(businessQuery.data?.fy_start_month ?? 4),
    [businessQuery.data?.fy_start_month],
  )

  const [rangeKey, setRangeKey] = useState('fy')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [report, setReport] = useState<Report>('pl')
  const [packing, setPacking] = useState(false)

  const range = useMemo(() => {
    if (rangeKey === 'custom' && customFrom && customTo) {
      return { from: customFrom, to: customTo }
    }
    const named = ranges.find((item) => item.key === rangeKey) ?? ranges[3] ?? ranges[0]
    return { from: named?.from ?? '', to: named?.to ?? '' }
  }, [rangeKey, customFrom, customTo, ranges])

  const enabled = Boolean(range.from && range.to)

  const plQuery = useQuery({
    queryKey: queryKeys.monthlyPl(businessId, range),
    queryFn: () => getMonthlyPl(businessId, range),
    enabled,
  })
  const gstQuery = useQuery({
    queryKey: queryKeys.gstSummary(businessId, range),
    queryFn: () => getGstSummary(businessId, range),
    enabled,
  })
  const vehiclesQuery = useQuery({
    queryKey: queryKeys.vehicleMonthly(businessId, range),
    queryFn: () => getVehicleMonthly(businessId, range),
    enabled,
  })
  const complianceQuery = useQuery({
    queryKey: queryKeys.complianceGaps(businessId, range),
    queryFn: () => getComplianceGaps(businessId, range),
    enabled,
  })

  const totals = useMemo(() => totalPl(plQuery.data ?? []), [plQuery.data])
  const byVehicle = useMemo(
    () => totalByVehicle(vehiclesQuery.data ?? []),
    [vehiclesQuery.data],
  )

  const rangeLabel = enabled
    ? `${format(parseISO(range.from), 'd MMM yyyy')} – ${format(parseISO(range.to), 'd MMM yyyy')}`
    : ''

  /**
   * Fetches everything the pack needs at export time rather than keeping it
   * all loaded — the ledgers and registers are only read here.
   */
  async function downloadCaPack() {
    if (!businessQuery.data || !enabled) return
    setPacking(true)
    try {
      const [invoices, trips, clients, brokers, drivers] = await Promise.all([
        listInvoices(businessId, { from: range.from, to: range.to }),
        listTripFinancials(businessId, { from: range.from, to: range.to }),
        listClientLedger(businessId),
        listBrokerLedger(businessId),
        listDriverLedger(businessId),
      ])

      await exportCaPack({
        business: businessQuery.data,
        range,
        pl: plQuery.data ?? [],
        gst: gstQuery.data ?? [],
        vehicles: vehiclesQuery.data ?? [],
        invoices,
        trips,
        clients,
        brokers,
        drivers,
        compliance: complianceQuery.data ?? [],
        partyNames: master.partyNames,
        vehicleNames: new Map(master.vehicles.map((v) => [v.id, v.reg_no])),
      })
      toast.success('CA export pack downloaded')
    } catch (error) {
      toast.error(describeError(error))
    } finally {
      setPacking(false)
    }
  }

  async function downloadPdf() {
    if (!businessQuery.data) return
    try {
      if (report === 'pl') {
        await exportReportPdf(
          {
            business: businessQuery.data,
            title: 'Profit & Loss',
            subtitle: rangeLabel,
            summary: [
              { label: 'Freight billed', value: formatCurrencyPdf(totals.freight) },
              { label: 'Expenses', value: formatCurrencyPdf(totals.expenses_total) },
              { label: 'Commission', value: formatCurrencyPdf(totals.broker_commission) },
              { label: 'Net profit', value: formatCurrencyPdf(totals.net_profit) },
            ],
            tables: [
              {
                head: ['Month', 'Trips', 'Freight', 'Commission', 'Expenses', 'Net'],
                numericColumns: [1, 2, 3, 4, 5],
                body: (plQuery.data ?? []).map((row) => [
                  monthLabel(row.month),
                  row.trip_count,
                  formatCurrencyPdf(row.freight),
                  formatCurrencyPdf(row.broker_commission),
                  formatCurrencyPdf(row.expenses_total),
                  formatCurrencyPdf(row.net_profit),
                ]),
              },
            ],
          },
          [businessQuery.data.name, 'pl', range.from, range.to],
        )
      } else if (report === 'gst') {
        await exportReportPdf(
          {
            business: businessQuery.data,
            title: 'GST Summary',
            subtitle: rangeLabel,
            landscape: true,
            tables: [
              {
                head: ['Month', 'Rate', 'RCM', 'Place of supply', 'Taxable', 'CGST', 'SGST', 'IGST'],
                numericColumns: [4, 5, 6, 7],
                body: (gstQuery.data ?? []).map((row) => [
                  monthLabel(row.month),
                  `${row.gst_rate}%`,
                  row.is_rcm ? 'Yes' : 'No',
                  row.place_of_supply ? stateName(row.place_of_supply) : '—',
                  formatCurrencyPdf(row.taxable_value),
                  formatCurrencyPdf(row.cgst),
                  formatCurrencyPdf(row.sgst),
                  formatCurrencyPdf(row.igst),
                ]),
              },
            ],
          },
          [businessQuery.data.name, 'gst', range.from, range.to],
        )
      } else if (report === 'vehicles') {
        await exportReportPdf(
          {
            business: businessQuery.data,
            title: 'Vehicle economics',
            subtitle: rangeLabel,
            tables: [
              {
                head: ['Vehicle', 'Trips', 'Km', 'Freight', 'Expenses', 'Margin', 'Cost/km'],
                numericColumns: [1, 2, 3, 4, 5, 6],
                body: byVehicle.map((vehicle) => [
                  vehicle.reg_no,
                  vehicle.trip_count,
                  formatNumber(vehicle.distance_km),
                  formatCurrencyPdf(vehicle.freight),
                  formatCurrencyPdf(vehicle.expenses),
                  formatCurrencyPdf(vehicle.margin),
                  vehicle.cost_per_km != null ? `Rs. ${vehicle.cost_per_km}` : '-',
                ]),
              },
            ],
          },
          [businessQuery.data.name, 'vehicles', range.from, range.to],
        )
      } else {
        await exportReportPdf(
          {
            business: businessQuery.data,
            title: 'Compliance gaps',
            subtitle: rangeLabel,
            landscape: true,
            tables: [
              {
                head: ['Date', 'Route', 'Freight', 'Type', 'LR', 'E-way', 'POD', 'Invoice'],
                numericColumns: [2],
                body: (complianceQuery.data ?? []).map((row) => [
                  row.trip_date,
                  `${row.pickup} -> ${row.drop_location}`,
                  formatCurrencyPdf(row.freight_amount),
                  row.bill_type === 'gst' ? 'GST' : 'Non-GST',
                  row.missing_lr ? 'Missing' : 'OK',
                  row.missing_eway ? 'Missing' : 'OK',
                  row.missing_pod ? 'Missing' : 'OK',
                  row.not_invoiced ? 'Missing' : 'OK',
                ]),
              },
            ],
          },
          [businessQuery.data.name, 'compliance', range.from, range.to],
        )
      }
      toast.success('PDF downloaded')
    } catch (error) {
      toast.error(describeError(error))
    }
  }

  async function downloadExcel() {
    if (!businessQuery.data) return
    try {
      await exportExcel(
        [
          {
            name: report === 'pl' ? 'P&L' : report === 'gst' ? 'GST summary' : report === 'vehicles' ? 'Vehicles' : 'Compliance',
            rows:
              report === 'pl'
                ? [
                    ['Month', 'Trips', 'Freight', 'Commission', 'TDS', 'Km', 'Expenses',
                     'Fuel', 'Toll', 'Maintenance', 'Batta', 'Insurance & permits',
                     'Loan EMI', 'Office', 'Other', 'Salaries', 'Net profit'],
                    ...(plQuery.data ?? []).map((row) => [
                      monthLabel(row.month), row.trip_count, row.freight,
                      row.broker_commission, row.tds_deducted, row.distance_km,
                      row.expenses_total, row.fuel, row.toll, row.maintenance,
                      row.driver_batta, row.compliance, row.loan_emi, row.office,
                      row.other_expenses, row.driver_salaries, row.net_profit,
                    ]),
                  ]
                : report === 'gst'
                  ? [
                      ['Month', 'Rate %', 'RCM', 'Place of supply', 'Invoices',
                       'Taxable value', 'CGST', 'SGST', 'IGST', 'Total tax', 'Invoice total'],
                      ...(gstQuery.data ?? []).map((row) => [
                        monthLabel(row.month), row.gst_rate, row.is_rcm ? 'Yes' : 'No',
                        row.place_of_supply ? stateName(row.place_of_supply) : '',
                        row.invoice_count, row.taxable_value, row.cgst, row.sgst,
                        row.igst, row.total_tax, row.invoice_total,
                      ]),
                    ]
                  : report === 'vehicles'
                    ? [
                        ['Vehicle', 'Trips', 'Distance (km)', 'Freight', 'Expenses',
                         'Fuel', 'Margin', 'Cost / km', 'Revenue / km'],
                        ...byVehicle.map((vehicle) => [
                          vehicle.reg_no, vehicle.trip_count, vehicle.distance_km,
                          vehicle.freight, vehicle.expenses, vehicle.fuel,
                          vehicle.margin, vehicle.cost_per_km, vehicle.revenue_per_km,
                        ]),
                      ]
                    : [
                        ['Date', 'Route', 'Freight', 'Bill type', 'Missing LR',
                         'Missing e-way', 'Missing POD', 'Not invoiced'],
                        ...(complianceQuery.data ?? []).map((row) => [
                          row.trip_date, `${row.pickup} - ${row.drop_location}`,
                          row.freight_amount, row.bill_type === 'gst' ? 'GST' : 'Non-GST',
                          row.missing_lr ? 'Yes' : '', row.missing_eway ? 'Yes' : '',
                          row.missing_pod ? 'Yes' : '', row.not_invoiced ? 'Yes' : '',
                        ]),
                      ],
          },
        ],
        [businessQuery.data.name, report, range.from, range.to],
      )
      toast.success('Excel downloaded')
    } catch (error) {
      toast.error(describeError(error))
    }
  }

  if (businessQuery.isPending) return <LoadingState />
  if (businessQuery.isError) {
    return (
      <ErrorState
        error={businessQuery.error}
        onRetry={() => void businessQuery.refetch()}
      />
    )
  }

  const loading =
    plQuery.isPending || gstQuery.isPending || vehiclesQuery.isPending || complianceQuery.isPending
  const error = plQuery.error ?? gstQuery.error ?? vehiclesQuery.error ?? complianceQuery.error

  return (
    <>
      <PageHeader title="Reports" subtitle={rangeLabel} />

      <div className="space-y-4 px-4 pb-4 lg:px-6">
        <Card>
          <CardBody className="space-y-3">
            <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
              {ranges.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setRangeKey(item.key)}
                  className={[
                    'shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors',
                    rangeKey === item.key
                      ? 'bg-brand-600 text-white'
                      : 'bg-white text-slate-600 ring-1 ring-slate-200',
                  ].join(' ')}
                >
                  {item.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setRangeKey('custom')}
                className={[
                  'shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors',
                  rangeKey === 'custom'
                    ? 'bg-brand-600 text-white'
                    : 'bg-white text-slate-600 ring-1 ring-slate-200',
                ].join(' ')}
              >
                Custom
              </button>
            </div>

            {rangeKey === 'custom' && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="From" htmlFor="range_from">
                  <input
                    id="range_from"
                    type="date"
                    value={customFrom}
                    onChange={(event) => setCustomFrom(event.target.value)}
                    className={controlClass()}
                  />
                </Field>
                <Field label="To" htmlFor="range_to">
                  <input
                    id="range_to"
                    type="date"
                    value={customTo}
                    onChange={(event) => setCustomTo(event.target.value)}
                    className={controlClass()}
                  />
                </Field>
              </div>
            )}

            <Button
              fullWidth
              loading={packing}
              disabled={!enabled || loading}
              onClick={() => void downloadCaPack()}
            >
              Download CA export pack
            </Button>
            <p className="text-center text-xs text-slate-400">
              P&amp;L and GST summary as PDF, plus a nine-sheet workbook, zipped.
            </p>
          </CardBody>
        </Card>

        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:px-0">
          {(
            [
              ['pl', 'P&L'],
              ['gst', 'GST'],
              ['vehicles', 'Vehicles'],
              ['compliance', 'Compliance'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setReport(value)}
              className={[
                'shrink-0 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors',
                report === value
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-600 ring-1 ring-slate-200',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>

        {!enabled ? (
          <p className="py-8 text-center text-sm text-slate-500">
            Pick both dates to run the report.
          </p>
        ) : error ? (
          <ErrorState
            error={error}
            onRetry={() => {
              void plQuery.refetch()
              void gstQuery.refetch()
              void vehiclesQuery.refetch()
              void complianceQuery.refetch()
            }}
          />
        ) : loading ? (
          <LoadingState label="Running the report…" />
        ) : (
          <>
            {report === 'pl' && <PlReport rows={plQuery.data ?? []} totals={totals} />}
            {report === 'gst' && <GstReport rows={gstQuery.data ?? []} />}
            {report === 'vehicles' && <VehicleReport rows={byVehicle} />}
            {report === 'compliance' && (
              <ComplianceReport rows={complianceQuery.data ?? []} />
            )}

            <div className="flex gap-3">
              <Button variant="secondary" fullWidth onClick={() => void downloadPdf()}>
                Export PDF
              </Button>
              <Button variant="secondary" fullWidth onClick={() => void downloadExcel()}>
                Export Excel
              </Button>
            </div>
          </>
        )}
      </div>
    </>
  )
}

function PlReport({
  rows,
  totals,
}: {
  rows: Array<{ month: string; freight: number; expenses_total: number; net_profit: number; trip_count: number }>
  totals: ReturnType<typeof totalPl>
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Tile label="Freight billed" value={formatCurrencyCompact(totals.freight)} />
        <Tile label="Expenses" value={formatCurrencyCompact(totals.expenses_total)} />
        <Tile
          label="Net profit"
          value={formatCurrencyCompact(totals.net_profit)}
          tone={totals.net_profit < 0 ? 'danger' : 'success'}
        />
        <Tile label="Distance" value={formatKm(totals.distance_km)} />
      </div>

      <Card>
        <CardHeader title="Expenses by head" />
        <div className="divide-y divide-slate-100">
          {(
            [
              ['Fuel / diesel', totals.fuel],
              ['Toll', totals.toll],
              ['Maintenance & tyres', totals.maintenance],
              ['Driver batta', totals.driver_batta],
              ['Insurance & permits', totals.compliance],
              ['Loan EMI', totals.loan_emi],
              ['Office', totals.office],
              ['Other', totals.other_expenses],
              ['Driver salaries', totals.driver_salaries],
            ] as const
          )
            .filter(([, amount]) => amount > 0)
            .map(([label, amount]) => {
              const share =
                totals.expenses_total > 0
                  ? Math.round((amount / totals.expenses_total) * 100)
                  : 0
              return (
                <div key={label} className="px-4 py-2.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">{label}</span>
                    <span className="font-medium text-slate-900">
                      {formatCurrency(amount)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-brand-400" style={{ width: `${share}%` }} />
                  </div>
                </div>
              )
            })}
        </div>
      </Card>

      <Card>
        <CardHeader title="Month by month" />
        <div className="divide-y divide-slate-100">
          {rows.length === 0 ? (
            <CardBody>
              <p className="text-sm text-slate-500">Nothing recorded in this period.</p>
            </CardBody>
          ) : (
            rows.map((row) => (
              <div key={row.month} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {monthLabel(row.month)}
                  </p>
                  <p className="text-xs text-slate-500">
                    {row.trip_count} trips · {formatCurrency(row.freight)} freight
                  </p>
                </div>
                <p
                  className={[
                    'text-sm font-semibold',
                    row.net_profit < 0 ? 'text-red-600' : 'text-emerald-600',
                  ].join(' ')}
                >
                  {formatCurrency(row.net_profit)}
                </p>
              </div>
            ))
          )}
        </div>
      </Card>
    </>
  )
}

function GstReport({
  rows,
}: {
  rows: Array<{
    month: string
    gst_rate: number
    is_rcm: boolean
    place_of_supply: string | null
    taxable_value: number
    cgst: number
    sgst: number
    igst: number
    total_tax: number
  }>
}) {
  const totals = rows.reduce(
    (sum, row) => ({
      taxable: sum.taxable + row.taxable_value,
      cgst: sum.cgst + row.cgst,
      sgst: sum.sgst + row.sgst,
      igst: sum.igst + row.igst,
    }),
    { taxable: 0, cgst: 0, sgst: 0, igst: 0 },
  )

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Tile label="Taxable value" value={formatCurrencyCompact(totals.taxable)} />
        <Tile label="Total tax" value={formatCurrencyCompact(totals.cgst + totals.sgst + totals.igst)} />
        <Tile label="CGST + SGST" value={formatCurrencyCompact(totals.cgst + totals.sgst)} />
        <Tile label="IGST" value={formatCurrencyCompact(totals.igst)} />
      </div>

      <Card>
        <CardHeader title="Outward supplies" />
        <div className="divide-y divide-slate-100">
          {rows.length === 0 ? (
            <CardBody>
              <p className="text-sm text-slate-500">No GST invoices in this period.</p>
            </CardBody>
          ) : (
            rows.map((row, index) => (
              <div key={`${row.month}-${row.gst_rate}-${row.place_of_supply}-${index}`} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">
                      {monthLabel(row.month)} · {row.gst_rate}%
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {row.place_of_supply ? stateName(row.place_of_supply) : 'Place not set'}
                      {row.igst > 0 ? ' · inter-state' : row.cgst > 0 ? ' · intra-state' : ''}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {row.is_rcm && <Pill label="RCM" tone="warning" />}
                    <p className="mt-1 text-sm font-semibold text-slate-900">
                      {formatCurrency(row.taxable_value)}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      tax {formatCurrency(row.total_tax)}
                    </p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </>
  )
}

function VehicleReport({ rows }: { rows: ReturnType<typeof totalByVehicle> }) {
  return (
    <Card>
      <CardHeader title="Per truck" />
      <div className="divide-y divide-slate-100">
        {rows.length === 0 ? (
          <CardBody>
            <p className="text-sm text-slate-500">No vehicle activity in this period.</p>
          </CardBody>
        ) : (
          rows.map((vehicle) => (
            <div key={vehicle.vehicle_id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{vehicle.reg_no}</p>
                  <p className="text-xs text-slate-500">
                    {vehicle.trip_count} trips · {formatKm(vehicle.distance_km)}
                  </p>
                </div>
                <p
                  className={[
                    'shrink-0 text-sm font-semibold',
                    vehicle.margin < 0 ? 'text-red-600' : 'text-emerald-600',
                  ].join(' ')}
                >
                  {formatCurrency(vehicle.margin)}
                </p>
              </div>

              <div className="mt-2 grid grid-cols-3 gap-2">
                <Metric label="Freight" value={formatCurrency(vehicle.freight)} />
                <Metric label="Expenses" value={formatCurrency(vehicle.expenses)} />
                <Metric
                  label="Cost / km"
                  value={vehicle.cost_per_km != null ? `₹${vehicle.cost_per_km}` : '—'}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  )
}

function ComplianceReport({
  rows,
}: {
  rows: Array<{
    trip_id: string
    trip_date: string
    pickup: string
    drop_location: string
    freight_amount: number
    missing_lr: boolean
    missing_eway: boolean
    missing_pod: boolean
    not_invoiced: boolean
  }>
}) {
  return (
    <Card>
      <CardHeader title={`${rows.length} trip${rows.length === 1 ? '' : 's'} to tidy up`} />
      <div className="divide-y divide-slate-100">
        {rows.length === 0 ? (
          <CardBody>
            <p className="text-sm text-emerald-700">
              Every trip in this period has its LR, e-way bill, proof of delivery and
              invoice on file.
            </p>
          </CardBody>
        ) : (
          rows.map((row) => (
            <div key={row.trip_id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {row.pickup} → {row.drop_location}
                  </p>
                  <p className="text-xs text-slate-500">{row.trip_date}</p>
                </div>
                <p className="shrink-0 text-sm font-medium text-slate-600">
                  {formatCurrency(row.freight_amount)}
                </p>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {row.missing_lr && <Pill label="No LR" tone="danger" />}
                {row.missing_eway && <Pill label="No e-way bill" tone="warning" />}
                {row.missing_pod && <Pill label="No POD" tone="warning" />}
                {row.not_invoiced && <Pill label="Not invoiced" tone="danger" />}
              </div>
            </div>
          ))
        )}
      </div>
      <CardBody className="pt-0">
        <p className="text-xs text-slate-400">
          An e-way bill is only required above a consignment value threshold, so a blank
          one is flagged for review rather than treated as an error.
        </p>
      </CardBody>
    </Card>
  )
}

function Tile({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'neutral' | 'success' | 'danger'
}) {
  const valueTone = {
    neutral: 'text-slate-900',
    success: 'text-emerald-600',
    danger: 'text-red-600',
  }[tone]

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${valueTone}`}>{value}</p>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-sm font-medium text-slate-900">{value}</p>
    </div>
  )
}
