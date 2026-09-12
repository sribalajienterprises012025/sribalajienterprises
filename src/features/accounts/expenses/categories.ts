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

/** The category values, in the order the CHECK constraint declares them. */
export const EXPENSE_CATEGORY_VALUES = EXPENSE_CATEGORIES.map(
  (category) => category.value,
) as [ExpenseCategory, ...ExpenseCategory[]]
