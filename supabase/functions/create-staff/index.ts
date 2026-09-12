/**
 * create-staff — an owner creates a login for a helper or a CA directly.
 *
 * Why this exists as a server function at all: creating another person's auth
 * account needs the Supabase admin API, which needs the secret key. That key
 * bypasses every row-level security policy, so it can never be shipped to a
 * browser. It lives here instead, in the function's own environment.
 *
 * The security shape matters more than the feature. Two clients are used:
 *
 *   adminClient  — the secret key. Used for exactly one thing: creating (and,
 *                  on failure, removing) the auth account.
 *   callerClient — the caller's own JWT. Used for every database read and
 *                  write, so RLS still applies and the audit trail records the
 *                  owner who acted rather than "System".
 *
 * That means business_id is never taken from the request body: it is read from
 * the caller's own profile, and the users_insert policy independently requires
 * the writer to be an owner of that business. A helper who calls this endpoint
 * is refused by Postgres even if this code were wrong.
 */

import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** Roles this endpoint may create. Owner is deliberately absent. */
const CREATABLE_ROLES = ['helper', 'ca'] as const
type CreatableRole = (typeof CREATABLE_ROLES)[number]

interface CreateStaffBody {
  email?: string
  password?: string
  name?: string
  role?: string
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function fail(code: string, message: string, status: number): Response {
  return json({ error: { code, message } }, status)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') {
    return fail('method_not_allowed', 'Use POST.', 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  // Supabase injects the first name; newer projects also expose the second.
  const secretKey =
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY')

  if (!supabaseUrl || !secretKey) {
    return fail(
      'not_configured',
      'The function is missing its Supabase credentials.',
      500,
    )
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return fail('unauthenticated', 'Sign in and try again.', 401)
  }

  let body: CreateStaffBody
  try {
    body = await req.json()
  } catch {
    return fail('bad_request', 'Expected a JSON body.', 400)
  }

  const email = (body.email ?? '').trim().toLowerCase()
  const password = body.password ?? ''
  const name = (body.name ?? '').trim()
  const role = body.role as CreatableRole

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return fail('invalid_email', 'Enter a valid email address.', 400)
  }
  if (password.length < 8) {
    return fail('weak_password', 'The password needs at least 8 characters.', 400)
  }
  if (!CREATABLE_ROLES.includes(role)) {
    return fail(
      'invalid_role',
      'Pick helper or CA. An owner is promoted from an existing member, not created here.',
      400,
    )
  }

  // Everything except the auth-account call runs as the caller, under RLS.
  const callerClient = createClient(supabaseUrl, secretKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: caller, error: callerError } = await callerClient.auth.getUser()
  if (callerError || !caller?.user) {
    return fail('unauthenticated', 'Your session has expired. Sign in again.', 401)
  }

  const { data: profile, error: profileError } = await callerClient
    .from('users')
    .select('business_id, role')
    .eq('id', caller.user.id)
    .single()

  if (profileError || !profile) {
    return fail(
      'no_profile',
      'Your account is not set up against a business yet.',
      403,
    )
  }
  if (profile.role !== 'owner') {
    return fail('not_owner', 'Only the business owner can create logins.', 403)
  }

  const adminClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // email_confirm: the owner is handing over the password in person, so there
  // is no confirmation link to click and no mailbox the staff member needs.
  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: name || email.split('@')[0] },
  })

  if (createError || !created?.user) {
    const message = createError?.message ?? 'Could not create the login.'
    const alreadyExists =
      /already (been )?registered|already exists|duplicate/i.test(message)
    return fail(
      alreadyExists ? 'email_taken' : 'create_failed',
      alreadyExists
        ? 'That email already has a login. Send them an invitation instead — they will join this business the next time they sign in.'
        : message,
      alreadyExists ? 409 : 400,
    )
  }

  // Written as the caller, so the users_insert policy applies and the audit
  // trail attributes the change to the owner rather than to the service role.
  const { error: linkError } = await callerClient.from('users').insert({
    id: created.user.id,
    business_id: profile.business_id,
    name: name || email.split('@')[0],
    role,
  })

  if (linkError) {
    // The auth account is useless without a profile row — it would sign in and
    // be offered a brand-new business. Remove it rather than leave that trap.
    await adminClient.auth.admin.deleteUser(created.user.id)
    return fail(
      'link_failed',
      `The login was not created: ${linkError.message}`,
      400,
    )
  }

  return json({
    user: { id: created.user.id, email, name: name || email.split('@')[0], role },
  })
})
