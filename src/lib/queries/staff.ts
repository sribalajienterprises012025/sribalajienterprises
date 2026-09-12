import { supabase } from '@/lib/supabase'
import type { AppUser, AuditEntry, Invite, Role } from '@/types'

export async function listStaff(businessId: string): Promise<AppUser[]> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('business_id', businessId)
    .order('name')

  if (error) throw error
  return data ?? []
}

export async function updateStaffRole(id: string, role: Role): Promise<AppUser> {
  const { data, error } = await supabase
    .from('users')
    .update({ role })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function removeStaff(id: string): Promise<void> {
  // Removes their access to this business. The auth account itself remains —
  // deleting that needs the admin API, which the browser has no key for.
  const { error } = await supabase.from('users').delete().eq('id', id)
  if (error) throw error
}

export async function listInvites(businessId: string): Promise<Invite[]> {
  const { data, error } = await supabase
    .from('invites')
    .select('*')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data ?? []
}

export async function createInvite(
  businessId: string,
  input: { email: string; name: string | null; role: Exclude<Role, 'owner'> },
): Promise<Invite> {
  const { data: auth } = await supabase.auth.getUser()

  const { data, error } = await supabase
    .from('invites')
    .insert({
      business_id: businessId,
      // Lowercased so a claim cannot miss on capitalisation.
      email: input.email.trim().toLowerCase(),
      name: input.name,
      role: input.role,
      invited_by: auth.user?.id ?? null,
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteInvite(id: string): Promise<void> {
  const { error } = await supabase.from('invites').delete().eq('id', id)
  if (error) throw error
}

/** Any pending invitation addressed to the signed-in account's own email. */
export async function findMyInvite(): Promise<Invite | null> {
  const { data, error } = await supabase
    .from('invites')
    .select('*')
    .is('accepted_at', null)
    .limit(1)

  if (error) throw error
  return data?.[0] ?? null
}

/**
 * Joins the business the invitation names.
 *
 * Runs server-side: it will only ever create the caller's own profile row, from
 * an invite matching their own verified email, at the role the invite names.
 */
export async function claimInvite(): Promise<string> {
  const { data, error } = await supabase.rpc('claim_invite')
  if (error) throw error
  return data as string
}

export async function listAudit(
  businessId: string,
  filters: { tableName?: string; limit?: number } = {},
): Promise<AuditEntry[]> {
  let query = supabase
    .from('audit_feed')
    .select('*')
    .eq('business_id', businessId)
    .order('changed_at', { ascending: false })
    .limit(filters.limit ?? 100)

  if (filters.tableName && filters.tableName !== 'all') {
    query = query.eq('table_name', filters.tableName)
  }

  const { data, error } = await query
  if (error) throw error
  return data ?? []
}
