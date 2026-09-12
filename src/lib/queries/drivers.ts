import { supabase } from '@/lib/supabase'
import type { Driver } from '@/types'

export type DriverInput = Omit<
  Driver,
  'id' | 'business_id' | 'created_at' | 'updated_at'
>

export async function listDrivers(businessId: string): Promise<Driver[]> {
  const { data, error } = await supabase
    .from('drivers')
    .select('*')
    .eq('business_id', businessId)
    .order('name')

  if (error) throw error
  return data ?? []
}

export async function getDriver(id: string): Promise<Driver> {
  const { data, error } = await supabase
    .from('drivers')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

export async function createDriver(
  businessId: string,
  input: DriverInput,
): Promise<Driver> {
  const { data, error } = await supabase
    .from('drivers')
    .insert({ ...input, business_id: businessId })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateDriver(
  id: string,
  input: Partial<DriverInput>,
): Promise<Driver> {
  const { data, error } = await supabase
    .from('drivers')
    .update(input)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteDriver(id: string): Promise<void> {
  const { error } = await supabase.from('drivers').delete().eq('id', id)
  if (error) throw error
}
