import { supabase } from '@/lib/supabase'
import type {
  BrokerLedgerRow,
  ClientLedgerRow,
  DriverLedgerRow,
  Payment,
  TripFinancialsRow,
} from '@/types'

export async function listClientLedger(businessId: string): Promise<ClientLedgerRow[]> {
  const { data, error } = await supabase
    .from('client_ledger')
    .select('*')
    .eq('business_id', businessId)
    .order('balance', { ascending: false })

  if (error) throw error
  return data ?? []
}

export async function listBrokerLedger(businessId: string): Promise<BrokerLedgerRow[]> {
  const { data, error } = await supabase
    .from('broker_ledger')
    .select('*')
    .eq('business_id', businessId)
    .order('net_balance', { ascending: false })

  if (error) throw error
  return data ?? []
}

export async function listDriverLedger(businessId: string): Promise<DriverLedgerRow[]> {
  const { data, error } = await supabase
    .from('driver_ledger')
    .select('*')
    .eq('business_id', businessId)
    .order('net_payable', { ascending: false })

  if (error) throw error
  return data ?? []
}

export async function listTripFinancials(
  businessId: string,
  filters: { from?: string; to?: string; vehicleId?: string } = {},
): Promise<TripFinancialsRow[]> {
  let query = supabase
    .from('trip_financials')
    .select('*')
    .eq('business_id', businessId)
    .order('trip_date', { ascending: false })

  if (filters.from) query = query.gte('trip_date', filters.from)
  if (filters.to) query = query.lte('trip_date', filters.to)
  if (filters.vehicleId) query = query.eq('vehicle_id', filters.vehicleId)

  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

// --- payments ----------------------------------------------------------------

export type PaymentInput = Omit<
  Payment,
  'id' | 'business_id' | 'created_at' | 'updated_at'
>

export async function listPayments(
  businessId: string,
  filters: { partyId?: string; from?: string; to?: string } = {},
): Promise<Payment[]> {
  let query = supabase
    .from('payments')
    .select('*')
    .eq('business_id', businessId)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })

  if (filters.partyId) query = query.eq('party_id', filters.partyId)
  if (filters.from) query = query.gte('date', filters.from)
  if (filters.to) query = query.lte('date', filters.to)

  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

export async function createPayment(
  businessId: string,
  input: PaymentInput,
): Promise<Payment> {
  const { data, error } = await supabase
    .from('payments')
    .insert({ ...input, business_id: businessId })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deletePayment(id: string): Promise<void> {
  const { error } = await supabase.from('payments').delete().eq('id', id)
  if (error) throw error
}
