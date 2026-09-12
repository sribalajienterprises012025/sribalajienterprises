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
