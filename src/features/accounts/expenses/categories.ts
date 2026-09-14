import type { ExpenseCategory } from '@/types'

/** Display order follows how often each category comes up day to day. */
export const EXPENSE_CATEGORIES: Array<{ value: ExpenseCategory; label: string }> = [
  { value: 'fuel', label: 'Fuel / diesel' },
  { value: 'toll', label: 'Toll' },
  { value: 'driver_batta', label: 'Driver batta' },
  { value: 'maintenance', label: 'Maintenance / service' },
  { value: 'tyre', label: 'Tyre' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'permit', label: 'Permit / tax' },
  { value: 'office', label: 'Office' },
  { value: 'salary', label: 'Salary' },
  { value: 'loan_emi', label: 'Loan EMI' },
  { value: 'other', label: 'Other' },
]

/**
 * What a category is called on screen.
 *
 * The rows used to humanise the stored value instead, so the same expense read
 * "Loan emi" in the list and "Loan EMI" in the filter above it, and `fuel`
 * showed as "Fuel" next to a picker offering "Fuel / diesel". One label, used
 * everywhere.
 */
export function categoryLabel(category: string | null | undefined): string {
  if (!category) return '\u2014'
  return (
    EXPENSE_CATEGORIES.find((item) => item.value === category)?.label ??
    category.replace(/_/g, ' ')
  )
}

/** The category values, in the order the CHECK constraint declares them. */
export const EXPENSE_CATEGORY_VALUES = EXPENSE_CATEGORIES.map(
  (category) => category.value,
) as [ExpenseCategory, ...ExpenseCategory[]]
