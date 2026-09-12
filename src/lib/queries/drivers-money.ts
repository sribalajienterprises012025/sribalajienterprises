import { supabase } from '@/lib/supabase'
import type { DriverAdvance, DriverSalaryPayment } from '@/types'

export type AdvanceInput = Omit<
  DriverAdvance,
  'id' | 'business_id' | 'created_at' | 'updated_at'
>

export type SalaryPaymentInput = Omit<
  DriverSalaryPayment,
  'id' | 'business_id' | 'created_at' | 'updated_at'
>

export async function listAdvances(
  businessId: string,
  driverId?: string,
): Promise<DriverAdvance[]> {
  let query = supabase
    .from('driver_advances')
    .select('*')
    .eq('business_id', businessId)
    .order('date', { ascending: false })

  if (driverId) query = query.eq('driver_id', driverId)

  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

export async function createAdvance(
  businessId: string,
  input: AdvanceInput,
): Promise<DriverAdvance> {
  const { data, error } = await supabase
    .from('driver_advances')
    .insert({ ...input, business_id: businessId })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function setAdvanceAdjusted(
  id: string,
  adjusted: boolean,
): Promise<DriverAdvance> {
  const { data, error } = await supabase
    .from('driver_advances')
    .update({ adjusted })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteAdvance(id: string): Promise<void> {
  const { error } = await supabase.from('driver_advances').delete().eq('id', id)
  if (error) throw error
}

export async function listSalaryPayments(
  businessId: string,
  driverId?: string,
): Promise<DriverSalaryPayment[]> {
  let query = supabase
    .from('driver_salary_payments')
    .select('*')
    .eq('business_id', businessId)
    .order('period_month', { ascending: false })

  if (driverId) query = query.eq('driver_id', driverId)

  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

/**
 * Records a salary run and, if asked, marks the advances it deducted as
 * adjusted — otherwise the same advance keeps showing as outstanding after it
 * has already been recovered from a salary.
 */
export async function createSalaryPayment(
  businessId: string,
  input: SalaryPaymentInput,
  adviceIdsToAdjust: string[] = [],
): Promise<DriverSalaryPayment> {
  const { data, error } = await supabase
    .from('driver_salary_payments')
    .insert({ ...input, business_id: businessId })
    .select()
    .single()

  if (error) throw error

  if (adviceIdsToAdjust.length > 0) {
    const { error: adjustError } = await supabase
      .from('driver_advances')
      .update({ adjusted: true })
      .in('id', adviceIdsToAdjust)
    if (adjustError) throw adjustError
  }

  return data
}

export async function deleteSalaryPayment(id: string): Promise<void> {
  const { error } = await supabase.from('driver_salary_payments').delete().eq('id', id)
  if (error) throw error
}
