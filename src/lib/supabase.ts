import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL

/**
 * The browser-side API key.
 *
 * Supabase issues two generations of it. New projects get a publishable key
 * (`sb_publishable_…`); older ones an anon key, which is a JWT (`eyJ…`). They
 * are interchangeable here — both resolve to the `anon` Postgres role, and the
 * client only ever forwards them as a header — so either variable name works
 * and the newer one wins when both are set.
 *
 * Whichever it is, it is meant to be public: it carries no privileges of its
 * own, and every read and write is checked against the RLS policies. The
 * secret key (`sb_secret_…`, formerly `service_role`) bypasses those policies
 * and must never reach this app.
 */
const publishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * Whether the app has credentials to talk to Supabase.
 *
 * Checked at startup so a missing .env.local shows a setup screen instead of a
 * stack trace — this is the first thing anyone hits on a fresh clone.
 */
export const isSupabaseConfigured = Boolean(url && publishableKey)

/** Guards against the one key that must never be shipped to a browser. */
export const isSecretKeyMistake = Boolean(
  publishableKey && publishableKey.startsWith('sb_secret_'),
)

/**
 * The only API layer this app has. Security is enforced by Postgres RLS, so the
 * key being visible in the browser bundle is by design, not an oversight.
 */
export const supabase: SupabaseClient = createClient(
  url ?? 'http://localhost:54321',
  publishableKey ?? 'public-anon-key-placeholder',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
)

/** Postgres error codes worth handling by name rather than by message text. */
export const PG_ERROR = {
  /** RLS rejected the write, or the row is outside the caller's business. */
  INSUFFICIENT_PRIVILEGE: '42501',
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
  /** PostgREST: the filter matched no rows on a .single() query. */
  NO_ROWS: 'PGRST116',
} as const

/**
 * Turns a Supabase error into something a transport operator can act on.
 * Raw Postgres messages name constraints and columns, which is noise on a phone.
 */
export function describeError(error: unknown): string {
  if (!error) return 'Something went wrong.'

  const err = error as { code?: string; message?: string; details?: string }

  switch (err.code) {
    case PG_ERROR.UNIQUE_VIOLATION:
      return 'That record already exists.'
    case PG_ERROR.FOREIGN_KEY_VIOLATION:
      return 'This is still linked to other records and cannot be removed.'
    case PG_ERROR.CHECK_VIOLATION:
      return 'Some values are out of range. Please check the amounts and dates.'
    case PG_ERROR.INSUFFICIENT_PRIVILEGE:
      return 'You do not have permission to do that.'
    default:
      return err.message || 'Something went wrong.'
  }
}
