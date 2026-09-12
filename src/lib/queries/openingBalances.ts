import { supabase } from '@/lib/supabase'
import type { OpeningBalance, OpeningBalancePartyType } from '@/types'

export type OpeningBalanceInput = Omit<
  OpeningBalance,
  'id' | 'business_id' | 'created_at' | 'updated_at'
>

export async function listOpeningBalances(
  businessId: string,
): Promise<OpeningBalance[]> {
  const { data, error } = await supabase
    .from('opening_balances')
    .select('*')
    .eq('business_id', businessId)

  if (error) throw error
  return data ?? []
}

/**
 * Sets a party's opening balance, replacing any existing one.
 *
 * The table is unique on (business_id, party_type, party_id) — a party has one
 * opening position, not a history of them — so this upserts on that key rather
 * than inserting a second row that the ledger would then double-count.
 */
export async function setOpeningBalance(
  businessId: string,
  input: OpeningBalanceInput,
): Promise<OpeningBalance> {
  const { data, error } = await supabase
    .from('opening_balances')
    .upsert(
      { ...input, business_id: businessId },
      { onConflict: 'business_id,party_type,party_id' },
    )
    .select()
    .single()

  if (error) throw error
  return data
}

export async function clearOpeningBalance(
  businessId: string,
  partyType: OpeningBalancePartyType,
  partyId: string,
): Promise<void> {
  const { error } = await supabase
    .from('opening_balances')
    .delete()
    .eq('business_id', businessId)
    .eq('party_type', partyType)
    .eq('party_id', partyId)

  if (error) throw error
}
