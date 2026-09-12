import type { Role } from '@/types'

export interface NavItem {
  to: string
  label: string
  icon: string
  /** Roles that may see the item. Omitted means every role. */
  roles?: Role[]
  /** Shown in the phone bottom bar. Everything else lives in More. */
  primary?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: '📊', primary: true },
  { to: '/trips', label: 'Trips', icon: '🚚', primary: true },
  { to: '/invoices', label: 'Invoices', icon: '🧾', primary: true },
  { to: '/expenses', label: 'Expenses', icon: '💰' },
  { to: '/ledgers', label: 'Ledgers', icon: '📒' },
  { to: '/distribution', label: 'Distribution', icon: '📦' },
  { to: '/vehicles', label: 'Vehicles', icon: '🚛' },
  { to: '/drivers', label: 'Drivers', icon: '👤' },
  { to: '/parties', label: 'Parties', icon: '🤝' },
  { to: '/settings', label: 'Settings', icon: '⚙️', roles: ['owner'] },
]

export function visibleNavItems(role: Role | null): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.roles || (role && item.roles.includes(role)))
}
