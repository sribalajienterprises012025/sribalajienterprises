import { supabase } from '@/lib/supabase'
import type {
  InsuranceClaim,
  MaintenanceLogEntry,
  ServiceDueRow,
  ServiceSchedule,
} from '@/types'

export type ServiceScheduleInput = Omit<
  ServiceSchedule,
  'id' | 'business_id' | 'created_at' | 'updated_at'
>

export async function listServiceDue(businessId: string): Promise<ServiceDueRow[]> {
  const { data, error } = await supabase
    .from('service_due')
    .select('*')
    .eq('business_id', businessId)
    .order('reg_no')

  if (error) throw error
  return data ?? []
}

export async function createSchedule(
  businessId: string,
  input: ServiceScheduleInput,
): Promise<ServiceSchedule> {
  const { data, error } = await supabase
    .from('service_schedules')
    .insert({ ...input, business_id: businessId })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateSchedule(
  id: string,
  input: Partial<ServiceScheduleInput>,
): Promise<ServiceSchedule> {
  const { data, error } = await supabase
    .from('service_schedules')
    .update(input)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteSchedule(id: string): Promise<void> {
  const { error } = await supabase.from('service_schedules').delete().eq('id', id)
  if (error) throw error
}

/**
 * Marks a service done.
 *
 * One server-side call rather than three writes from here: it logs the cost,
 * resets the schedule and carries the vehicle's odometer forward in a single
 * transaction, so the truck can never show a service as overdue while its bill
 * is already on the books.
 */
export async function completeService(params: {
  scheduleId: string
  date: string
  odometer: number
  cost: number
  vendor: string | null
  note: string | null
}): Promise<string> {
  const { data, error } = await supabase.rpc('complete_service', {
    p_schedule_id: params.scheduleId,
    p_date: params.date,
    p_odometer: params.odometer,
    p_cost: params.cost,
    p_vendor: params.vendor,
    p_note: params.note,
  })

  if (error) throw error
  return data as string
}

// --- maintenance log ---------------------------------------------------------

export type MaintenanceInput = Omit<
  MaintenanceLogEntry,
  'id' | 'business_id' | 'created_at' | 'updated_at'
>

export async function listMaintenance(
  businessId: string,
  vehicleId?: string,
): Promise<MaintenanceLogEntry[]> {
  let query = supabase
    .from('vehicle_maintenance_log')
    .select('*')
    .eq('business_id', businessId)
    .order('date', { ascending: false })

  if (vehicleId) query = query.eq('vehicle_id', vehicleId)

  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

export async function createMaintenance(
  businessId: string,
  input: MaintenanceInput,
): Promise<MaintenanceLogEntry> {
  const { data, error } = await supabase
    .from('vehicle_maintenance_log')
    .insert({ ...input, business_id: businessId })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteMaintenance(id: string): Promise<void> {
  const { error } = await supabase.from('vehicle_maintenance_log').delete().eq('id', id)
  if (error) throw error
}

// --- insurance claims --------------------------------------------------------

export type ClaimInput = Omit<
  InsuranceClaim,
  'id' | 'business_id' | 'created_at' | 'updated_at'
>

export async function listClaims(businessId: string): Promise<InsuranceClaim[]> {
  const { data, error } = await supabase
    .from('insurance_claims')
    .select('*')
    .eq('business_id', businessId)
    .order('claim_date', { ascending: false })

  if (error) throw error
  return data ?? []
}

export async function createClaim(
  businessId: string,
  input: ClaimInput,
): Promise<InsuranceClaim> {
  const { data, error } = await supabase
    .from('insurance_claims')
    .insert({ ...input, business_id: businessId })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateClaim(
  id: string,
  input: Partial<ClaimInput>,
): Promise<InsuranceClaim> {
  const { data, error } = await supabase
    .from('insurance_claims')
    .update(input)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteClaim(id: string): Promise<void> {
  const { error } = await supabase.from('insurance_claims').delete().eq('id', id)
  if (error) throw error
}
