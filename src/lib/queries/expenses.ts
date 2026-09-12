import { supabase } from '@/lib/supabase'
import type { Expense, ExpenseCategory, ExpenseWithRelations } from '@/types'

export type ExpenseInput = Omit<
  Expense,
  'id' | 'business_id' | 'created_at' | 'updated_at'
>

export interface ExpenseFilters {
  category?: ExpenseCategory | 'all'
  vehicleId?: string
  from?: string
  to?: string
}

const EXPENSE_SELECT = `
  *,
  vehicle:vehicles ( id, reg_no )
`

export async function listExpenses(
  businessId: string,
  filters: ExpenseFilters = {},
): Promise<ExpenseWithRelations[]> {
  let query = supabase
    .from('expenses')
    .select(EXPENSE_SELECT)
    .eq('business_id', businessId)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })

  if (filters.category && filters.category !== 'all') {
    query = query.eq('category', filters.category)
  }
  if (filters.vehicleId) {
    query = query.eq('vehicle_id', filters.vehicleId)
  }
  if (filters.from) {
    query = query.gte('date', filters.from)
  }
  if (filters.to) {
    query = query.lte('date', filters.to)
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as unknown as ExpenseWithRelations[]
}

export async function createExpense(
  businessId: string,
  input: ExpenseInput,
): Promise<Expense> {
  const { data, error } = await supabase
    .from('expenses')
    .insert({ ...input, business_id: businessId })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateExpense(
  id: string,
  input: Partial<ExpenseInput>,
): Promise<Expense> {
  const { data, error } = await supabase
    .from('expenses')
    .update(input)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteExpense(id: string): Promise<void> {
  const { error } = await supabase.from('expenses').delete().eq('id', id)
  if (error) throw error
}
