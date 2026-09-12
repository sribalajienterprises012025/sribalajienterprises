import { supabase } from '@/lib/supabase'
import type {
  Consignment,
  ConsignmentProgressRow,
  TripStop,
  VehicleUtilisationRow,
} from '@/types'

export type ConsignmentInput = Omit<
  Consignment,
  'id' | 'business_id' | 'created_at' | 'updated_at'
>

export async function listConsignments(
  businessId: string,
  filters: { from?: string; to?: string; status?: string } = {},
): Promise<ConsignmentProgressRow[]> {
  let query = supabase
    .from('consignment_progress')
    .select('*')
    .eq('business_id', businessId)
    .order('planned_date', { ascending: false })

  if (filters.from) query = query.gte('planned_date', filters.from)
  if (filters.to) query = query.lte('planned_date', filters.to)
  if (filters.status && filters.status !== 'all') query = query.eq('status', filters.status)

  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

export async function createConsignment(
  businessId: string,
  input: ConsignmentInput,
): Promise<Consignment> {
  const { data, error } = await supabase
    .from('consignments')
    .insert({ ...input, business_id: businessId })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateConsignment(
  id: string,
  input: Partial<ConsignmentInput>,
): Promise<Consignment> {
  const { data, error } = await supabase
    .from('consignments')
    .update(input)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteConsignment(id: string): Promise<void> {
  const { error } = await supabase.from('consignments').delete().eq('id', id)
  if (error) throw error
}

/**
 * One row per vehicle per day that has a trip.
 *
 * Grouped in Postgres rather than in the browser so the planning grid can span
 * a month without pulling every trip on the phone.
 */
export async function listUtilisation(
  businessId: string,
  from: string,
  to: string,
): Promise<VehicleUtilisationRow[]> {
  const { data, error } = await supabase
    .from('vehicle_utilisation')
    .select('*')
    .eq('business_id', businessId)
    .gte('trip_date', from)
    .lte('trip_date', to)

  if (error) throw error
  return data ?? []
}

/** Trips in a date window, for the planning grid's cell contents. */
export async function listTripsInRange(businessId: string, from: string, to: string) {
  const { data, error } = await supabase
    .from('trips')
    .select('id, vehicle_id, driver_id, trip_date, pickup, drop_location, status, freight_amount, consignment_id, planned_quantity, party_type, party_id')
    .eq('business_id', businessId)
    .gte('trip_date', from)
    .lte('trip_date', to)
    .neq('status', 'cancelled')
    .order('trip_date')

  if (error) throw error
  return data ?? []
}

// --- trip stops --------------------------------------------------------------

export type TripStopInput = Omit<
  TripStop,
  'id' | 'business_id' | 'created_at' | 'updated_at'
>

export async function listStops(tripId: string): Promise<TripStop[]> {
  const { data, error } = await supabase
    .from('trip_stops')
    .select('*')
    .eq('trip_id', tripId)
    .order('sequence')

  if (error) throw error
  return data ?? []
}

export async function createStop(
  businessId: string,
  input: TripStopInput,
): Promise<TripStop> {
  const { data, error } = await supabase
    .from('trip_stops')
    .insert({ ...input, business_id: businessId })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateStop(
  id: string,
  input: Partial<TripStopInput>,
): Promise<TripStop> {
  const { data, error } = await supabase
    .from('trip_stops')
    .update(input)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteStop(id: string): Promise<void> {
  const { error } = await supabase.from('trip_stops').delete().eq('id', id)
  if (error) throw error
}

/**
 * Moves a stop up or down the running order by swapping positions with its
 * neighbour.
 *
 * Done as three writes through a position no stop occupies, because
 * (trip_id, sequence) is unique — writing the two rows directly would collide
 * on the first update.
 */
export async function swapStops(a: TripStop, b: TripStop): Promise<void> {
  const parking = -1

  const { error: park } = await supabase
    .from('trip_stops')
    .update({ sequence: parking })
    .eq('id', a.id)
  if (park) throw park

  const { error: moveB } = await supabase
    .from('trip_stops')
    .update({ sequence: a.sequence })
    .eq('id', b.id)
  if (moveB) throw moveB

  const { error: moveA } = await supabase
    .from('trip_stops')
    .update({ sequence: b.sequence })
    .eq('id', a.id)
  if (moveA) throw moveA
}
