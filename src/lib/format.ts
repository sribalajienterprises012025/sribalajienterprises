import { format, isValid, parseISO, differenceInCalendarDays } from 'date-fns'

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

const inrPrecise = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** ₹1,20,000 — Indian digit grouping, no paise. For totals and list rows. */
export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return inr.format(value)
}

/** ₹1,20,000.00 — for invoice lines and anything that must reconcile exactly. */
export function formatCurrencyPrecise(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return inrPrecise.format(value)
}

/** Compact form for dashboard tiles: ₹1.2L, ₹3.4Cr. */
export function formatCurrencyCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)}Cr`
  if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(2)}L`
  if (abs >= 1000) return `${sign}₹${(abs / 1000).toFixed(1)}K`
  return formatCurrency(value)
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = parseISO(value)
  return isValid(date) ? format(date, 'dd MMM yyyy') : '—'
}

export function formatDateShort(value: string | null | undefined): string {
  if (!value) return '—'
  const date = parseISO(value)
  return isValid(date) ? format(date, 'dd MMM') : '—'
}

/** yyyy-MM-dd, the shape Postgres `date` columns and `<input type="date">` want. */
export function toDateInput(value: Date | string | null | undefined): string {
  if (!value) return ''
  const date = typeof value === 'string' ? parseISO(value) : value
  return isValid(date) ? format(date, 'yyyy-MM-dd') : ''
}

export function todayInput(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

/**
 * Days until an expiry date. Negative means already expired.
 * Returns null for a missing date so callers can tell "no data" from "expired".
 */
export function daysUntil(value: string | null | undefined): number | null {
  if (!value) return null
  const date = parseISO(value)
  if (!isValid(date)) return null
  return differenceInCalendarDays(date, new Date())
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return new Intl.NumberFormat('en-IN').format(value)
}

/** "1,240 km" — odometer readings and trip distances. */
export function formatKm(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${formatNumber(value)} km`
}

export function formatPhone(value: string | null | undefined): string {
  if (!value) return '—'
  const digits = value.replace(/\D/g, '')
  if (digits.length === 10) return `${digits.slice(0, 5)} ${digits.slice(5)}`
  return value
}

/** Turns a snake_case enum value into a readable label: in_transit -> In transit. */
export function humanize(value: string | null | undefined): string {
  if (!value) return '—'
  const withSpaces = value.replace(/_/g, ' ')
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1)
}

/**
 * Rupees written for a PDF: "Rs. 1,20,000.00".
 *
 * jsPDF's built-in Helvetica is WinAnsi-encoded and has no rupee glyph
 * (U+20B9). Handed one, it switches the string to UTF-16 while still drawing it
 * through a Latin-1 font, and the line comes out as mangled, space-separated
 * digits. Embedding a font that has the glyph would cost a few hundred
 * kilobytes for a symbol "Rs." conveys perfectly well, and "Rs." is what most
 * Indian invoices print anyway.
 */
export function formatCurrencyPdf(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-'
  const sign = value < 0 ? '-' : ''
  const amount = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(value))
  return `${sign}Rs. ${amount}`
}

/**
 * Replaces characters the PDF base fonts cannot draw.
 *
 * Applied to every string that reaches a PDF, so a stray arrow or dash in a
 * route name, a party name or a note cannot silently corrupt a line of an
 * invoice. Anything still outside Latin-1 after the substitutions is dropped
 * rather than left to render as mojibake.
 */
export function pdfSafe(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  let out = ''
  for (const character of String(value)) {
    const code = character.codePointAt(0) ?? 0
    const replacement = PDF_SUBSTITUTIONS[code]
    if (replacement !== undefined) {
      out += replacement
    } else if (code <= 0xff) {
      out += character
    }
    // Anything else is dropped: the base fonts would draw it as mojibake.
  }
  return out
}

/**
 * Code point to ASCII, for the characters that actually turn up in this app's
 * data and labels. Keyed by code point rather than written as literals so the
 * source stays plain ASCII and cannot be mangled by an editor or a tool.
 */
const PDF_SUBSTITUTIONS: Record<number, string> = {
  0x20b9: 'Rs.', // rupee sign
  0x2192: '->', // rightwards arrow
  0x27a1: '->', // black rightwards arrow
  0x2190: '<-', // leftwards arrow
  0x2014: '-', // em dash
  0x2013: '-', // en dash
  0x2018: "'", // left single quote
  0x2019: "'", // right single quote
  0x201c: '"', // left double quote
  0x201d: '"', // right double quote
  0x2022: '*', // bullet
  0x00b7: '-', // middle dot
  0x2026: '...', // ellipsis
  0x00a0: ' ', // non-breaking space
  0x2212: '-', // minus sign
}
