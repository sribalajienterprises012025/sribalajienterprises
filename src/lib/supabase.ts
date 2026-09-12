import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * Whether the app has credentials to talk to Supabase.
 *
 * Checked at startup so a missing .env.local shows a setup screen instead of a
 * stack trace — this is the first thing anyone hits on a fresh clone.
 */
export const isSupabaseConfigured = Boolean(url && anonKey)

/**
 * The only API layer this app has. Security is enforced by Postgres RLS, so the
 * anon key being visible in the browser bundle is by design, not an oversight.
 */
export const supabase: SupabaseClient = createClient(
  url ?? 'http://localhost:54321',
  anonKey ?? 'public-anon-key-placeholder',
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
