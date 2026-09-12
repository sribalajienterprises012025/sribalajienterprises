import { supabase } from '@/lib/supabase'
import type { Trip, TripStatus, TripWithRelations } from '@/types'

export type TripInput = Omit<
  Trip,
  'id' | 'business_id' | 'created_at' | 'updated_at'
>

export interface TripFilters {
  status?: TripStatus | 'all'
  vehicleId?: string
  from?: string
  to?: string
  search?: string
}

/**
 * Vehicle and driver are joined in the same round trip. The party (client or
 * broker) is not — party_id is polymorphic across two tables, so PostgREST has
 * no foreign key to follow. Callers resolve the name from the already-cached
 * client/broker lists.
 */
const TRIP_SELECT = `
  *,
  vehicle:vehicles ( id, reg_no ),
  driver:drivers ( id, name )
`

export async function listTrips(
  businessId: string,
  filters: TripFilters = {},
): Promise<TripWithRelations[]> {
  let query = supabase
    .from('trips')
    .select(TRIP_SELECT)
    .eq('business_id', businessId)
    .order('trip_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (filters.status && filters.status !== 'all') {
    query = query.eq('status', filters.status)
  }
  if (filters.vehicleId) {
    query = query.eq('vehicle_id', filters.vehicleId)
  }
  if (filters.from) {
    query = query.gte('trip_date', filters.from)
  }
  if (filters.to) {
    query = query.lte('trip_date', filters.to)
  }
  if (filters.search) {
    // Escape commas — PostgREST uses them to separate .or() branches.
    const term = filters.search.replace(/,/g, '')
    query = query.or(
      `pickup.ilike.%${term}%,drop_location.ilike.%${term}%,lr_number.ilike.%${term}%,goods_description.ilike.%${term}%`,
    )
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as unknown as TripWithRelations[]
}

export async function getTrip(id: string): Promise<TripWithRelations> {
  const { data, error } = await supabase
    .from('trips')
    .select(TRIP_SELECT)
    .eq('id', id)
    .single()

  if (error) throw error
  return data as unknown as TripWithRelations
}

export async function createTrip(
  businessId: string,
  input: TripInput,
): Promise<Trip> {
  const { data, error } = await supabase
    .from('trips')
    .insert({ ...input, business_id: businessId })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateTrip(
  id: string,
  input: Partial<TripInput>,
): Promise<Trip> {
  const { data, error } = await supabase
    .from('trips')
    .update(input)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateTripStatus(
  id: string,
  status: TripStatus,
): Promise<Trip> {
  return updateTrip(id, { status })
}

export async function deleteTrip(id: string): Promise<void> {
  const { error } = await supabase.from('trips').delete().eq('id', id)
  if (error) throw error
}

/**
 * Pushes a vehicle's odometer forward after a trip is logged.
 *
 * Only ever moves forward: a mistyped closing reading lower than what the
 * vehicle already shows is ignored rather than rewinding the odometer.
 */
export async function syncVehicleOdometer(
  vehicleId: string,
  odometerEnd: number,
): Promise<void> {
  const { data: vehicle, error: readError } = await supabase
    .from('vehicles')
    .select('current_odometer')
    .eq('id', vehicleId)
    .single()

  if (readError) throw readError
  if (vehicle && odometerEnd > vehicle.current_odometer) {
    const { error } = await supabase
      .from('vehicles')
      .update({ current_odometer: odometerEnd })
      .eq('id', vehicleId)
    if (error) throw error
  }
}
