import { supabase } from '@/lib/supabase'
import type { Vehicle } from '@/types'

export type VehicleInput = Omit<
  Vehicle,
  'id' | 'business_id' | 'created_at' | 'updated_at'
>

export async function listVehicles(businessId: string): Promise<Vehicle[]> {
  const { data, error } = await supabase
    .from('vehicles')
    .select('*')
    .eq('business_id', businessId)
    .order('reg_no')

  if (error) throw error
  return data ?? []
}

export async function getVehicle(id: string): Promise<Vehicle> {
  const { data, error } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

export async function createVehicle(
  businessId: string,
  input: VehicleInput,
): Promise<Vehicle> {
  const { data, error } = await supabase
    .from('vehicles')
    .insert({ ...input, business_id: businessId })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateVehicle(
  id: string,
  input: Partial<VehicleInput>,
): Promise<Vehicle> {
  const { data, error } = await supabase
    .from('vehicles')
    .update(input)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteVehicle(id: string): Promise<void> {
  const { error } = await supabase.from('vehicles').delete().eq('id', id)
  if (error) throw error
}
