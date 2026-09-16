/**
 * The driver's own app.
 *
 * Every read here goes to a view that filters on the signed-in driver, and
 * every write goes to a function that first proves the trip belongs to them.
 * Neither is a convenience: the tables themselves refuse a driver outright, so
 * these are the only doors there are. See the driver migration for why.
 */
import { supabase } from '@/lib/supabase'
import type {
  MyAdvance,
  MyMoney,
  MySalaryRun,
  MyTrip,
  MyTripExpense,
  PaymentMode,
} from '@/types'

export async function listMyTrips(): Promise<MyTrip[]> {
  const { data, error } = await supabase
    .from('my_trips')
    .select('*')
    .order('trip_date', { ascending: false })

  if (error) throw error
  return data ?? []
}

export async function listMyTripExpenses(tripId: string): Promise<MyTripExpense[]> {
  const { data, error } = await supabase
    .from('my_trip_expenses')
    .select('*')
    .eq('trip_id', tripId)
    .order('date', { ascending: false })

  if (error) throw error
  return data ?? []
}

/** One row, or null before the owner has linked the login to a driver record. */
export async function getMyMoney(): Promise<MyMoney | null> {
  const { data, error } = await supabase.from('my_money').select('*').maybeSingle()
  if (error) throw error
  return data
}

export async function listMyAdvances(): Promise<MyAdvance[]> {
  const { data, error } = await supabase
    .from('my_advances')
    .select('*')
    .order('date', { ascending: false })

  if (error) throw error
  return data ?? []
}

export async function listMySalaryRuns(): Promise<MySalaryRun[]> {
  const { data, error } = await supabase
    .from('my_salary_runs')
    .select('*')
    .order('period_month', { ascending: false })

  if (error) throw error
  return data ?? []
}

export async function logOdometer(input: {
  tripId: string
  start: number | null
  end: number | null
}): Promise<void> {
  const { error } = await supabase.rpc('driver_log_odometer', {
    p_trip_id: input.tripId,
    p_start: input.start,
    p_end: input.end,
  })
  if (error) throw error
}

export async function setMyTripStatus(
  tripId: string,
  status: 'in_transit' | 'delivered',
): Promise<void> {
  const { error } = await supabase.rpc('driver_set_trip_status', {
    p_trip_id: tripId,
    p_status: status,
  })
  if (error) throw error
}

export async function logMyExpense(input: {
  tripId: string
  category: 'fuel' | 'toll' | 'other'
  amount: number
  paymentMode: PaymentMode
  note: string | null
  date: string
}): Promise<void> {
  const { error } = await supabase.rpc('driver_log_expense', {
    p_trip_id: input.tripId,
    p_category: input.category,
    p_amount: input.amount,
    p_payment_mode: input.paymentMode,
    p_note: input.note,
    p_date: input.date,
  })
  if (error) throw error
}

/**
 * Records a photo already uploaded to storage against the trip.
 *
 * The path is checked again on the server against the trip's own business, so
 * a file that landed in the wrong folder cannot be recorded as a delivery.
 */
export async function attachPod(tripId: string, path: string): Promise<void> {
  const { error } = await supabase.rpc('driver_attach_pod', {
    p_trip_id: tripId,
    p_file_url: path,
  })
  if (error) throw error
}
