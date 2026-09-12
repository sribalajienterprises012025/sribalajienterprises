import { format, parseISO } from 'date-fns'
import { formatCurrencyPdf } from '@/lib/format'
import { stateName } from '@/lib/gst'
import type {
  Business,
  ClientLedgerRow,
  BrokerLedgerRow,
  ComplianceGapRow,
  DriverLedgerRow,
  GstSummaryRow,
  InvoiceWithRelations,
  MonthlyPlRow,
  TripFinancialsRow,
  VehicleMonthlyRow,
} from '@/types'
import { buildExcelBlob, type Sheet } from './excel'
import { buildReportPdf } from './pdf'
import { downloadBlob, safeFilename } from './download'
import { totalByVehicle, totalPl } from '@/lib/queries/reports'

export interface CaPackData {
  business: Business
  range: { from: string; to: string }
  pl: MonthlyPlRow[]
  gst: GstSummaryRow[]
  vehicles: VehicleMonthlyRow[]
  invoices: InvoiceWithRelations[]
  trips: TripFinancialsRow[]
  clients: ClientLedgerRow[]
  brokers: BrokerLedgerRow[]
  drivers: DriverLedgerRow[]
  compliance: ComplianceGapRow[]
  /** Resolves a party_id to a name — party_id is polymorphic. */
  partyNames: Map<string, string>
  vehicleNames: Map<string, string>
}

const monthLabel = (month: string) => format(parseISO(month), 'MMM yyyy')

/**
 * Everything a CA asks for at the end of a quarter, in one download.
 *
 * PDF for the documents they read (P&L, GST summary), Excel for the data they
 * will filter and pivot (trip register, invoice register, ledgers). Built
 * entirely in the browser — there is no server-side job to run or pay for.
 */
export async function exportCaPack(data: CaPackData): Promise<void> {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()

  const rangeLabel = `${format(parseISO(data.range.from), 'd MMM yyyy')} to ${format(
    parseISO(data.range.to),
    'd MMM yyyy',
  )}`
  const totals = totalPl(data.pl)

  // --- P&L, as a PDF to read ------------------------------------------------
  const plPdf = await buildReportPdf({
    business: data.business,
    title: 'Profit & Loss',
    subtitle: rangeLabel,
    summary: [
      { label: 'Freight billed', value: formatCurrencyPdf(totals.freight) },
      { label: 'Total expenses', value: formatCurrencyPdf(totals.expenses_total) },
      { label: 'Broker commission', value: formatCurrencyPdf(totals.broker_commission) },
      { label: 'Net profit', value: formatCurrencyPdf(totals.net_profit) },
    ],
    tables: [
      {
        title: 'Month by month',
        head: ['Month', 'Trips', 'Freight', 'Commission', 'Expenses', 'Salaries', 'Net'],
        numericColumns: [1, 2, 3, 4, 5, 6],
        body: data.pl.map((row) => [
          monthLabel(row.month),
          row.trip_count,
          formatCurrencyPdf(row.freight),
          formatCurrencyPdf(row.broker_commission),
          formatCurrencyPdf(row.expenses_total),
          formatCurrencyPdf(row.driver_salaries),
          formatCurrencyPdf(row.net_profit),
        ]),
        foot: [
          [
            'Total',
            totals.trip_count,
            formatCurrencyPdf(totals.freight),
            formatCurrencyPdf(totals.broker_commission),
            formatCurrencyPdf(totals.expenses_total),
            formatCurrencyPdf(totals.driver_salaries),
            formatCurrencyPdf(totals.net_profit),
          ],
        ],
      },
      {
        title: 'Expenses by head',
        head: ['Head', 'Amount'],
        numericColumns: [1],
        body: [
          ['Fuel / diesel', formatCurrencyPdf(totals.fuel)],
          ['Toll', formatCurrencyPdf(totals.toll)],
          ['Maintenance & tyres', formatCurrencyPdf(totals.maintenance)],
          ['Driver batta', formatCurrencyPdf(totals.driver_batta)],
          ['Insurance & permits', formatCurrencyPdf(totals.compliance)],
          ['Loan EMI', formatCurrencyPdf(totals.loan_emi)],
          ['Office', formatCurrencyPdf(totals.office)],
          ['Other', formatCurrencyPdf(totals.other_expenses)],
        ],
        foot: [['Total', formatCurrencyPdf(totals.expenses_total)]],
      },
    ],
  })
  zip.file('1-profit-and-loss.pdf', plPdf)

  // --- GST summary, as a PDF ------------------------------------------------
  const gstTotals = data.gst.reduce(
    (sum, row) => ({
      taxable: sum.taxable + row.taxable_value,
      cgst: sum.cgst + row.cgst,
      sgst: sum.sgst + row.sgst,
      igst: sum.igst + row.igst,
      tax: sum.tax + row.total_tax,
    }),
    { taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0 },
  )

  const gstPdf = await buildReportPdf({
    business: data.business,
    title: 'GST Summary',
    subtitle: `${rangeLabel} · outward supplies`,
    landscape: true,
    summary: [
      { label: 'Taxable value', value: formatCurrencyPdf(gstTotals.taxable) },
      { label: 'CGST', value: formatCurrencyPdf(gstTotals.cgst) },
      { label: 'SGST', value: formatCurrencyPdf(gstTotals.sgst) },
      { label: 'IGST', value: formatCurrencyPdf(gstTotals.igst) },
    ],
    tables: [
      {
        head: [
          'Month',
          'Rate',
          'RCM',
          'Place of supply',
          'Invoices',
          'Taxable',
          'CGST',
          'SGST',
          'IGST',
          'Total tax',
        ],
        numericColumns: [4, 5, 6, 7, 8, 9],
        body: data.gst.map((row) => [
          monthLabel(row.month),
          `${row.gst_rate}%`,
          row.is_rcm ? 'Yes' : 'No',
          row.place_of_supply ? stateName(row.place_of_supply) : '—',
          row.invoice_count,
          formatCurrencyPdf(row.taxable_value),
          formatCurrencyPdf(row.cgst),
          formatCurrencyPdf(row.sgst),
          formatCurrencyPdf(row.igst),
          formatCurrencyPdf(row.total_tax),
        ]),
        foot: [
          [
            'Total',
            '',
            '',
            '',
            data.gst.reduce((sum, row) => sum + row.invoice_count, 0),
            formatCurrencyPdf(gstTotals.taxable),
            formatCurrencyPdf(gstTotals.cgst),
            formatCurrencyPdf(gstTotals.sgst),
            formatCurrencyPdf(gstTotals.igst),
            formatCurrencyPdf(gstTotals.tax),
          ],
        ],
      },
    ],
  })
  zip.file('2-gst-summary.pdf', gstPdf)

  // --- Working data, as one Excel workbook ---------------------------------
  const sheets: Sheet[] = [
    {
      name: 'P&L',
      rows: [
        ['Month', 'Trips', 'Freight', 'Broker commission', 'TDS', 'Distance (km)',
         'Expenses', 'Fuel', 'Toll', 'Maintenance', 'Driver batta', 'Insurance & permits',
         'Loan EMI', 'Office', 'Other', 'Driver salaries', 'Net profit'],
        ...data.pl.map((row) => [
          monthLabel(row.month), row.trip_count, row.freight, row.broker_commission,
          row.tds_deducted, row.distance_km, row.expenses_total, row.fuel, row.toll,
          row.maintenance, row.driver_batta, row.compliance, row.loan_emi, row.office,
          row.other_expenses, row.driver_salaries, row.net_profit,
        ]),
      ],
    },
    {
      name: 'GST summary',
      rows: [
        ['Month', 'Rate %', 'RCM', 'Place of supply', 'Invoices', 'Taxable value',
         'CGST', 'SGST', 'IGST', 'Total tax', 'Invoice total'],
        ...data.gst.map((row) => [
          monthLabel(row.month), row.gst_rate, row.is_rcm ? 'Yes' : 'No',
          row.place_of_supply ? stateName(row.place_of_supply) : '', row.invoice_count,
          row.taxable_value, row.cgst, row.sgst, row.igst, row.total_tax, row.invoice_total,
        ]),
      ],
    },
    {
      name: 'Invoice register',
      rows: [
        ['Invoice no.', 'Date', 'Due', 'Type', 'Party', 'Route', 'LR', 'Taxable value',
         'Rate %', 'RCM', 'Place of supply', 'Tax', 'Total', 'Status'],
        ...data.invoices.map((invoice) => [
          invoice.invoice_number,
          invoice.invoice_date,
          invoice.due_date ?? '',
          invoice.invoice_type === 'gst' ? 'GST' : 'Non-GST',
          invoice.party_id ? (data.partyNames.get(invoice.party_id) ?? '') : '',
          invoice.trip ? `${invoice.trip.pickup} - ${invoice.trip.drop_location}` : '',
          invoice.trip?.lr_number ?? '',
          invoice.taxable_value,
          invoice.gst_rate,
          invoice.is_rcm ? 'Yes' : 'No',
          invoice.place_of_supply ? stateName(invoice.place_of_supply) : '',
          invoice.tax_amount,
          invoice.amount,
          invoice.status,
        ]),
      ],
    },
    {
      name: 'Trip register',
      rows: [
        ['Date', 'Vehicle', 'Party', 'Bill type', 'Status', 'Freight', 'Broker commission',
         'Advance', 'TDS', 'Trip expenses', 'Distance (km)', 'Net margin', 'Balance due'],
        ...data.trips.map((trip) => [
          trip.trip_date,
          trip.vehicle_id ? (data.vehicleNames.get(trip.vehicle_id) ?? '') : '',
          data.partyNames.get(trip.party_id) ?? '',
          trip.bill_type === 'gst' ? 'GST' : 'Non-GST',
          trip.status,
          trip.freight_amount,
          trip.broker_commission,
          trip.advance_received,
          trip.tds_deducted,
          trip.trip_expenses,
          trip.distance_km,
          trip.net_margin,
          trip.balance_due,
        ]),
      ],
    },
    {
      name: 'Vehicle economics',
      rows: [
        ['Vehicle', 'Trips', 'Distance (km)', 'Freight', 'Expenses', 'Fuel', 'Margin',
         'Cost / km', 'Revenue / km'],
        ...totalByVehicle(data.vehicles).map((vehicle) => [
          vehicle.reg_no, vehicle.trip_count, vehicle.distance_km, vehicle.freight,
          vehicle.expenses, vehicle.fuel, vehicle.margin, vehicle.cost_per_km,
          vehicle.revenue_per_km,
        ]),
      ],
    },
    {
      name: 'Client ledger',
      rows: [
        ['Client', 'Opening', 'Invoiced', 'Unbilled freight', 'Debit notes', 'Credit notes',
         'Advances', 'TDS', 'Receipts', 'Balance', 'Credit limit'],
        ...data.clients.map((row) => [
          row.client_name, row.opening_balance, row.invoiced, row.unbilled_freight,
          row.debit_notes, row.credit_notes, row.advances_received, row.tds_deducted,
          row.receipts, row.balance, row.credit_limit,
        ]),
      ],
    },
    {
      name: 'Broker ledger',
      rows: [
        ['Broker', 'Freight receivable', 'Commission earned', 'Commission paid',
         'Commission payable', 'Net balance'],
        ...data.brokers.map((row) => [
          row.broker_name, row.freight_receivable, row.commission_earned,
          row.commission_paid, row.commission_payable, row.net_balance,
        ]),
      ],
    },
    {
      name: 'Driver ledger',
      rows: [
        ['Driver', 'Advances outstanding', 'Salary earned', 'Salary paid', 'Salary due'],
        ...data.drivers.map((row) => [
          row.driver_name, row.advances_outstanding, row.salary_earned,
          row.salary_paid, row.salary_due,
        ]),
      ],
    },
    {
      name: 'Compliance gaps',
      rows: [
        ['Date', 'Route', 'Freight', 'Bill type', 'Missing LR', 'Missing e-way bill',
         'Missing POD', 'Not invoiced'],
        ...data.compliance.map((row) => [
          row.trip_date,
          `${row.pickup} - ${row.drop_location}`,
          row.freight_amount,
          row.bill_type === 'gst' ? 'GST' : 'Non-GST',
          row.missing_lr ? 'Yes' : '',
          row.missing_eway ? 'Yes' : '',
          row.missing_pod ? 'Yes' : '',
          row.not_invoiced ? 'Yes' : '',
        ]),
      ],
    },
  ]

  zip.file('3-working-data.xlsx', await buildExcelBlob(sheets))

  // A plain-text manifest so whoever opens the zip in six months knows what
  // period it covers and how the numbers were arrived at.
  zip.file(
    'README.txt',
    [
      `${data.business.name} — accounts export`,
      data.business.gstin ? `GSTIN: ${data.business.gstin}` : null,
      data.business.pan ? `PAN: ${data.business.pan}` : null,
      `Period: ${rangeLabel}`,
      `Generated: ${format(new Date(), 'd MMM yyyy, HH:mm')}`,
      '',
      'Contents',
      '  1-profit-and-loss.pdf   Month-by-month P&L and expenses by head',
      '  2-gst-summary.pdf       Outward supplies by month, rate and place of supply',
      '  3-working-data.xlsx     Nine sheets: P&L, GST, invoice and trip registers,',
      '                          vehicle economics, client/broker/driver ledgers,',
      '                          and compliance gaps',
      '',
      'Notes',
      '  Cancelled invoices are excluded from every total, but their numbers remain',
      '  in the series — a GST invoice is cancelled, never deleted.',
      '',
      '  Net profit counts driver pay from recorded salary runs and excludes expenses',
      '  filed under the salary head, so a salary entered in both places is not',
      '  deducted twice.',
      '',
      '  Ledgers are computed from the underlying trips, invoices, notes and receipts',
      '  at the moment of export, not stored as running balances.',
      '',
      '  "Compliance gaps" lists trips missing an LR number, e-way bill, proof of',
      '  delivery, or an invoice. An e-way bill is only required above a consignment',
      '  value threshold, so a blank one is reported for review rather than treated',
      '  as an error.',
    ]
      .filter((line) => line !== null)
      .join('\n'),
  )

  const blob = await zip.generateAsync({ type: 'blob' })
  downloadBlob(
    blob,
    `${safeFilename([
      data.business.name,
      'accounts',
      data.range.from,
      'to',
      data.range.to,
    ])}.zip`,
  )
}
