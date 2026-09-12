import type { jsPDF as JsPdfType } from 'jspdf'
import { formatCurrencyPdf, formatDate, pdfSafe } from '@/lib/format'
import { stateName } from '@/lib/gst'
import type { Business, FullInvoice, TaxBreakup } from '@/types'
import { downloadBlob, safeFilename } from './download'

/** jsPDF plus its table plugin, loaded on first export rather than at startup. */
async function loadPdf() {
  const [{ jsPDF }, autoTableModule] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])
  return { jsPDF, autoTable: autoTableModule.default }
}

const INK = '#0f172a'
const MUTED = '#64748b'

/**
 * Where the last autoTable finished, so the next block starts below it.
 * The plugin writes this onto the document; its types do not survive the
 * dynamic import, hence the narrow cast in one place rather than at each call.
 */
function lastTableBottom(doc: JsPdfType): number | undefined {
  return (doc as JsPdfType & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY
}

export interface PdfTable {
  title?: string
  head: string[]
  body: Array<Array<string | number>>
  /** Column indexes to right-align. Money and quantities, in practice. */
  numericColumns?: number[]
  foot?: Array<Array<string | number>>
}

export interface ReportPdfOptions {
  business: Business
  title: string
  subtitle?: string
  tables: PdfTable[]
  /** Key figures printed above the tables. */
  summary?: Array<{ label: string; value: string }>
  landscape?: boolean
}

export async function buildReportPdf(options: ReportPdfOptions): Promise<Blob> {
  const { jsPDF, autoTable } = await loadPdf()
  const doc = new jsPDF({
    orientation: options.landscape ? 'landscape' : 'portrait',
    unit: 'pt',
    format: 'a4',
  })

  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 40
  let y = margin

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(INK)
  doc.text(pdfSafe(options.business.name), margin, y)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(MUTED)
  const identity = [
    options.business.gstin ? `GSTIN ${options.business.gstin}` : null,
    options.business.pan ? `PAN ${options.business.pan}` : null,
  ]
    .filter(Boolean)
    .join('   ')
  if (identity) {
    y += 14
    doc.text(identity, margin, y)
  }

  y += 26
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(INK)
  doc.text(pdfSafe(options.title), margin, y)

  if (options.subtitle) {
    y += 14
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(MUTED)
    doc.text(pdfSafe(options.subtitle), margin, y)
  }

  if (options.summary?.length) {
    y += 22
    // Laid out in columns across the page rather than as a list, so the
    // headline numbers read at a glance.
    const columnWidth = (pageWidth - margin * 2) / Math.min(options.summary.length, 4)
    options.summary.forEach((item, index) => {
      const column = index % 4
      const row = Math.floor(index / 4)
      const x = margin + column * columnWidth
      const rowY = y + row * 34

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(MUTED)
      doc.text(pdfSafe(item.label), x, rowY)

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(12)
      doc.setTextColor(INK)
      doc.text(pdfSafe(item.value), x, rowY + 14)
    })
    y += Math.ceil(options.summary.length / 4) * 34
  }

  for (const table of options.tables) {
    y += 18
    if (table.title) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(10)
      doc.setTextColor(INK)
      doc.text(pdfSafe(table.title), margin, y)
      y += 6
    }

    const numeric = new Set(table.numericColumns ?? [])
    autoTable(doc, {
      startY: y,
      head: [table.head.map(pdfSafe)],
      body: table.body.map((row) => row.map(pdfSafe)),
      foot: table.foot?.map((row) => row.map(pdfSafe)),
      margin: { left: margin, right: margin },
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 4, textColor: INK },
      headStyles: { fillColor: [241, 245, 249], textColor: INK, fontStyle: 'bold' },
      footStyles: { fillColor: [248, 250, 252], textColor: INK, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [252, 252, 253] },
      columnStyles: Object.fromEntries(
        table.head.map((_, index) => [
          index,
          { halign: numeric.has(index) ? ('right' as const) : ('left' as const) },
        ]),
      ),
    })

    y = lastTableBottom(doc) ?? y + 40
  }

  stampFooter(doc, MUTED)
  return doc.output('blob')
}

/**
 * Page numbers and the generation date, on every page.
 *
 * Added after all the tables are laid out, because the page count is not known
 * until then.
 */
function stampFooter(doc: JsPdfType, muted: string): void {
  const pageCount = doc.getNumberOfPages()
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()

  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(muted)
    doc.text(`Generated ${formatDate(new Date().toISOString())}`, 40, pageHeight - 24)
    doc.text(`Page ${page} of ${pageCount}`, pageWidth - 40, pageHeight - 24, {
      align: 'right',
    })
  }
}

export async function exportReportPdf(
  options: ReportPdfOptions,
  filenameParts: Array<string | null | undefined>,
): Promise<void> {
  const blob = await buildReportPdf(options)
  downloadBlob(blob, `${safeFilename(filenameParts)}.pdf`)
}

// --- invoice -----------------------------------------------------------------

export interface InvoicePdfOptions {
  business: Business
  invoice: FullInvoice
  partyName: string
  partyGstin?: string | null
  partyAddress?: string | null
  route?: string | null
  lrNumber?: string | null
  ewayBillNo?: string | null
}

/** A tax invoice in the shape a GST-registered client expects to receive. */
export async function buildInvoicePdf(options: InvoicePdfOptions): Promise<Blob> {
  const { jsPDF, autoTable } = await loadPdf()
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const { business, invoice } = options

  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 40
  let y = margin

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(INK)
  doc.text(
    invoice.invoice_type === 'gst' ? 'TAX INVOICE' : 'INVOICE',
    pageWidth / 2,
    y,
    { align: 'center' },
  )

  y += 24
  doc.setFontSize(14)
  doc.text(pdfSafe(business.name), margin, y)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(MUTED)
  const sellerLines = [
    business.address,
    business.gstin ? `GSTIN: ${business.gstin}` : null,
    business.pan ? `PAN: ${business.pan}` : null,
  ].filter(Boolean) as string[]
  sellerLines.forEach((line, index) => {
    doc.text(pdfSafe(line), margin, y + 13 + index * 11)
  })

  // Invoice identity block, right-aligned opposite the seller.
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  const metaLines: Array<[string, string]> = [
    ['Invoice no.', invoice.invoice_number],
    ['Date', formatDate(invoice.invoice_date)],
  ]
  if (invoice.due_date) metaLines.push(['Due', formatDate(invoice.due_date)])
  if (invoice.place_of_supply) {
    metaLines.push(['Place of supply', stateName(invoice.place_of_supply)])
  }
  if (invoice.is_rcm) metaLines.push(['Reverse charge', 'Yes'])

  metaLines.forEach(([label, value], index) => {
    const lineY = y + 13 + index * 11
    doc.setTextColor(MUTED)
    doc.text(pdfSafe(label), pageWidth - margin - 120, lineY)
    doc.setTextColor(INK)
    doc.text(pdfSafe(value), pageWidth - margin, lineY, { align: 'right' })
  })

  y += 13 + Math.max(sellerLines.length, metaLines.length) * 11 + 18

  doc.setDrawColor(226, 232, 240)
  doc.line(margin, y, pageWidth - margin, y)
  y += 18

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(INK)
  doc.text('Billed to', margin, y)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(pdfSafe(options.partyName), margin, y + 14)

  doc.setFontSize(8)
  doc.setTextColor(MUTED)
  const buyerLines = [
    options.partyAddress,
    options.partyGstin ? `GSTIN: ${options.partyGstin}` : null,
  ].filter(Boolean) as string[]
  buyerLines.forEach((line, index) => {
    doc.text(pdfSafe(line), margin, y + 27 + index * 11)
  })

  y += 27 + buyerLines.length * 11 + 12

  const breakup = invoice.tax_breakup as Partial<TaxBreakup>
  const description = [
    'Freight charges',
    options.route ? `(${options.route})` : null,
    options.lrNumber ? `LR ${options.lrNumber}` : null,
    options.ewayBillNo ? `E-way ${options.ewayBillNo}` : null,
  ]
    .filter(Boolean)
    .join(' ')

  const body: Array<Array<string | number>> = [
    ['1', description, '996511', formatCurrencyPdf(invoice.taxable_value)],
  ]

  autoTable(doc, {
    startY: y,
    head: [['#', 'Description', 'SAC', 'Amount']],
    body: body.map((row) => row.map(pdfSafe)),
    margin: { left: margin, right: margin },
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 6, textColor: INK },
    headStyles: { fillColor: [241, 245, 249], textColor: INK, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 26 },
      2: { cellWidth: 56 },
      3: { halign: 'right', cellWidth: 90 },
    },
  })

  y = lastTableBottom(doc) ?? y + 60

  // Totals, right-aligned under the line items.
  const totals: Array<[string, string]> = [
    ['Taxable value', formatCurrencyPdf(invoice.taxable_value)],
  ]
  if (breakup.cgst_amount !== undefined) {
    totals.push([`CGST @ ${breakup.cgst_rate}%`, formatCurrencyPdf(breakup.cgst_amount)])
    totals.push([`SGST @ ${breakup.sgst_rate}%`, formatCurrencyPdf(breakup.sgst_amount ?? 0)])
  }
  if (breakup.igst_amount !== undefined) {
    totals.push([`IGST @ ${breakup.igst_rate}%`, formatCurrencyPdf(breakup.igst_amount)])
  }
  totals.push(['Total', formatCurrencyPdf(invoice.amount)])

  y += 16
  totals.forEach(([label, value], index) => {
    const isTotal = index === totals.length - 1
    const lineY = y + index * 15
    doc.setFont('helvetica', isTotal ? 'bold' : 'normal')
    doc.setFontSize(isTotal ? 10 : 8)
    doc.setTextColor(isTotal ? INK : MUTED)
    doc.text(pdfSafe(label), pageWidth - margin - 150, lineY)
    doc.setTextColor(INK)
    doc.text(pdfSafe(value), pageWidth - margin, lineY, { align: 'right' })
  })

  y += totals.length * 15 + 20

  if (invoice.is_rcm) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(INK)
    doc.text(
      'Tax payable by the recipient under reverse charge (Notification 13/2017-CT(R)).',
      margin,
      y,
    )
    y += 16
  }

  if (invoice.notes) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(MUTED)
    doc.text(pdfSafe(invoice.notes), margin, y, { maxWidth: pageWidth - margin * 2 })
    y += 20
  }

  const bank = business.bank_details as Record<string, unknown>
  const bankLines = Object.entries(bank)
    .filter(([, value]) => typeof value === 'string' && value)
    .map(([key, value]) => `${key.replace(/_/g, ' ')}: ${String(value)}`)

  if (bankLines.length > 0) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(INK)
    doc.text('Payment details', margin, y)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(MUTED)
    bankLines.forEach((line, index) => {
      doc.text(pdfSafe(line), margin, y + 12 + index * 10)
    })
  }

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(INK)
  doc.text(pdfSafe(`For ${business.name}`), pageWidth - margin, y + 30, { align: 'right' })
  doc.setTextColor(MUTED)
  doc.text('Authorised signatory', pageWidth - margin, y + 60, { align: 'right' })

  return doc.output('blob')
}

export async function exportInvoicePdf(options: InvoicePdfOptions): Promise<void> {
  const blob = await buildInvoicePdf(options)
  downloadBlob(blob, `${safeFilename([options.invoice.invoice_number])}.pdf`)
}
