import { parseISO, startOfWeek } from 'date-fns'

/**
 * Monday, because a transport week is planned from Monday — not the Sunday
 * that date-fns defaults to.
 */
export function weekStartFor(date: Date): Date {
  return startOfWeek(date, { weekStartsOn: 1 })
}

export function parseWeek(value: string): Date {
  return weekStartFor(parseISO(value))
}
