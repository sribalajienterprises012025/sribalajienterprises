import { supabase } from '@/lib/supabase'
import { PG_ERROR } from '@/lib/supabase'
import type { AppUser, Business } from '@/types'

/**
 * The signed-in user's profile row.
 *
 * Returns null — rather than throwing — when the auth account has no
 * public.users row yet. That is the normal state right after sign-up, and the
 * app routes those users to onboarding.
 */
export async function getCurrentUser(): Promise<AppUser | null> {
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return null

  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', auth.user.id)
    .single()

  if (error) {
    if (error.code === PG_ERROR.NO_ROWS) return null
    throw error
  }
  return data
}

export async function getBusiness(id: string): Promise<Business> {
  const { data, error } = await supabase
    .from('businesses')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

export async function updateBusiness(
  id: string,
  input: Partial<Omit<Business, 'id' | 'created_at' | 'updated_at'>>,
): Promise<Business> {
  const { data, error } = await supabase
    .from('businesses')
    .update(input)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Creates the business and its owner record for a brand-new account.
 * Runs server-side in one transaction; see bootstrap_business() in the RLS
 * migration for why this is not two client-side inserts.
 */
export async function bootstrapBusiness(
  businessName: string,
  ownerName: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('bootstrap_business', {
    business_name: businessName,
    owner_name: ownerName,
  })

  if (error) throw error
  return data as string
}
