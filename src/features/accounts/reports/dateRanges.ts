import { format, subMonths } from 'date-fns'

export interface NamedRange {
  key: string
  label: string
  from: string
  to: string
}

const iso = (date: Date) => format(date, 'yyyy-MM-dd')

/**
 * Ranges a transport business actually reports on.
 *
 * The financial year comes from the business's own fy_start_month rather than
 * being hardcoded to April, because the setting exists and a few businesses
 * use something else.
 */
export function namedRanges(fyStartMonth: number, today = new Date()): NamedRange[] {
  const year = today.getFullYear()
  const month = today.getMonth() + 1

  // A date before the FY start month still belongs to the FY that opened the
  // previous calendar year.
  const fyStartYear = month >= fyStartMonth ? year : year - 1
  const fyStart = new Date(fyStartYear, fyStartMonth - 1, 1)
  const fyEnd = new Date(fyStartYear + 1, fyStartMonth - 1, 0)
  const previousFyStart = new Date(fyStartYear - 1, fyStartMonth - 1, 1)
  const previousFyEnd = new Date(fyStartYear, fyStartMonth - 1, 0)

  const fyLabel = (startYear: number) =>
    `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`

  return [
    {
      key: 'this_month',
      label: 'This month',
      from: iso(new Date(year, today.getMonth(), 1)),
      to: iso(today),
    },
    {
      key: 'last_month',
      label: 'Last month',
      from: iso(new Date(year, today.getMonth() - 1, 1)),
      to: iso(new Date(year, today.getMonth(), 0)),
    },
    {
      key: 'last_3',
      label: 'Last 3 months',
      from: iso(new Date(subMonths(today, 2).getFullYear(), subMonths(today, 2).getMonth(), 1)),
      to: iso(today),
    },
    {
      key: 'fy',
      label: `FY ${fyLabel(fyStartYear)}`,
      from: iso(fyStart),
      to: iso(fyEnd < today ? fyEnd : today),
    },
    {
      key: 'previous_fy',
      label: `FY ${fyLabel(fyStartYear - 1)}`,
      from: iso(previousFyStart),
      to: iso(previousFyEnd),
    },
  ]
}
