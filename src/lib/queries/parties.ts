import { supabase } from '@/lib/supabase'
import type { Broker, Client } from '@/types'

export type ClientInput = Omit<
  Client,
  'id' | 'business_id' | 'created_at' | 'updated_at'
>
export type BrokerInput = Omit<
  Broker,
  'id' | 'business_id' | 'created_at' | 'updated_at'
>

// --- clients ----------------------------------------------------------------

export async function listClients(businessId: string): Promise<Client[]> {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('business_id', businessId)
    .order('name')

  if (error) throw error
  return data ?? []
}

export async function createClient(
  businessId: string,
  input: ClientInput,
): Promise<Client> {
  const { data, error } = await supabase
    .from('clients')
    .insert({ ...input, business_id: businessId })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateClient(
  id: string,
  input: Partial<ClientInput>,
): Promise<Client> {
  const { data, error } = await supabase
    .from('clients')
    .update(input)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteClient(id: string): Promise<void> {
  const { error } = await supabase.from('clients').delete().eq('id', id)
  if (error) throw error
}

// --- brokers ----------------------------------------------------------------

export async function listBrokers(businessId: string): Promise<Broker[]> {
  const { data, error } = await supabase
    .from('brokers')
    .select('*')
    .eq('business_id', businessId)
    .order('name')

  if (error) throw error
  return data ?? []
}

export async function createBroker(
  businessId: string,
  input: BrokerInput,
): Promise<Broker> {
  const { data, error } = await supabase
    .from('brokers')
    .insert({ ...input, business_id: businessId })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateBroker(
  id: string,
  input: Partial<BrokerInput>,
): Promise<Broker> {
  const { data, error } = await supabase
    .from('brokers')
    .update(input)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteBroker(id: string): Promise<void> {
  const { error } = await supabase.from('brokers').delete().eq('id', id)
  if (error) throw error
}
