import { supabase } from '@/lib/supabase'
import type { AppUser, AuditEntry, Invite, Role, InvitableRole } from '@/types'

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
  input: { email: string; name: string | null; role: InvitableRole },
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
/**
 * A pending invitation addressed to this account, for someone who is already
 * signed in somewhere.
 *
 * Filtered by email, unlike findMyInvite: the invites policy also lets an owner
 * read the invitations they sent, so an unfiltered query would tell an owner
 * they had been invited to their own business.
 */
export async function findInviteAddressedTo(email: string): Promise<Invite | null> {
  const { data, error } = await supabase
    .from('invites')
    .select('*')
    .is('accepted_at', null)
    .ilike('email', email)
    .limit(1)

  if (error) throw error
  return data?.[0] ?? null
}

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

/** Shape returned by the create-staff function on success. */
export interface CreatedStaff {
  id: string
  email: string
  name: string
  role: InvitableRole | 'driver'
  /** Driver logins only: the number they sign in with. */
  phone?: string
  driver_id?: string
}

export interface CreateStaffError {
  code: string
  message: string
}

/**
 * Creates a login for a helper or a CA outright, rather than inviting them.
 *
 * Runs in the `create-staff` Edge Function because creating someone else's
 * auth account needs the secret key, which must never reach a browser. The
 * function checks the caller is an owner and writes the profile row as the
 * caller, so RLS still applies.
 *
 * Use this when handing over credentials in person; use `createInvite` when the
 * person has their own mailbox and should set their own password.
 */
export async function createStaffLogin(input: {
  email: string
  password: string
  name: string
  role: InvitableRole
}): Promise<CreatedStaff> {
  const { data, error } = await supabase.functions.invoke('create-staff', {
    body: input,
  })

  if (error) {
    throw new Error(await describeFunctionError(error))
  }

  if (data?.error) throw new Error(data.error.message ?? 'Could not create the login.')
  return data.user as CreatedStaff
}

/**
 * Creates a driver's login from the phone number already on their record.
 *
 * Same function, same reason — the admin API needs the secret key — but no
 * email address anywhere: the number is the username, and create-staff turns
 * it into an address in a domain that cannot receive mail. See
 * src/lib/driverLogin.ts.
 */
export async function createDriverLogin(input: {
  driverId: string
  phone: string
  password: string
  name: string
}): Promise<CreatedStaff> {
  const { data, error } = await supabase.functions.invoke('create-staff', {
    body: {
      role: 'driver',
      driver_id: input.driverId,
      phone: input.phone,
      password: input.password,
      name: input.name,
    },
  })

  if (error) throw new Error(await describeFunctionError(error))
  if (data?.error) throw new Error(data.error.message ?? 'Could not create the login.')
  return data.user as CreatedStaff
}

const NOT_DEPLOYED =
  'Creating logins needs the create-staff function, which is not deployed yet. ' +
  'Run `supabase functions deploy create-staff`, or invite by email instead.'

/**
 * Turns a function failure into something the owner can act on.
 *
 * supabase-js reports every non-2xx as "Edge Function returned a non-2xx status
 * code", so the useful information is in the response, not the message. The
 * status is read first — a 404 means not deployed, which is the common case and
 * not a breakage, since the app works fully without it — and then the body,
 * which carries the function's own error envelope.
 */
async function describeFunctionError(error: unknown): Promise<string> {
  const context = (error as { context?: Response }).context
  const message = (error as { message?: string })?.message ?? ''

  if (context?.status === 404) return NOT_DEPLOYED

  let detail: CreateStaffError | null = null
  if (context && typeof context.json === 'function') {
    try {
      const payload = await context.json()
      detail = payload?.error ?? null
    } catch {
      detail = null
    }
  }

  if (detail?.code === 'not_configured') {
    return (
      'The create-staff function is deployed but cannot see its Supabase ' +
      'credentials. Redeploy it, or invite by email instead.'
    )
  }
  if (detail?.message) return detail.message

  // A body that parsed but held no envelope of ours is not our function
  // answering — most likely the route does not exist on this project.
  if (context && context.status >= 400 && context.status < 500) return NOT_DEPLOYED

  if (/failed to (fetch|send)/i.test(message)) {
    return 'Could not reach the function. Check your connection and try again.'
  }
  return message || 'Could not create the login.'
}
