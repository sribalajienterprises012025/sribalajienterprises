import type { Role } from '@/types'

/**
 * What each role is called on screen.
 *
 * Needed because the stored values are not all words: `humanize('ca')` gives
 * "Ca", which is how the accountant's own role appeared everywhere it was
 * shown — in the sidebar, on the More page, in settings and on their
 * invitation. The other two happen to survive humanising, but they are
 * named here too so there is one place to change a role's wording.
 */
export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  helper: 'Helper',
  ca: 'CA',
  driver: 'Driver',
}

/** Falls back to a dash, matching how the rest of the app shows a missing value. */
export function roleLabel(role: Role | null | undefined): string {
  return role ? ROLE_LABELS[role] : '—'
}
