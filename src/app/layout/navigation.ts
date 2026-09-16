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
  { to: '/reports', label: 'Reports', icon: '📈', roles: ['owner', 'ca'] },
  { to: '/vehicles', label: 'Vehicles', icon: '🚛' },
  { to: '/drivers', label: 'Drivers', icon: '👤' },
  { to: '/assets', label: 'Asset care', icon: '🔧' },
  { to: '/parties', label: 'Parties', icon: '🤝' },
  { to: '/settings', label: 'Settings', icon: '⚙️', roles: ['owner'] },
]

/**
 * A driver's app, which is a different app rather than a filtered one.
 *
 * Every other role is looking at the business; a driver is looking at their own
 * work. Filtering the list above would leave a driver staring at a Dashboard
 * and a Trips tab that the database will answer with nothing.
 */
export const DRIVER_NAV_ITEMS: NavItem[] = [
  { to: '/my-trips', label: 'My trips', icon: '🚚', primary: true },
  { to: '/my-money', label: 'My money', icon: '💰', primary: true },
]

export function visibleNavItems(role: Role | null): NavItem[] {
  if (role === 'driver') return DRIVER_NAV_ITEMS
  return NAV_ITEMS.filter((item) => !item.roles || (role && item.roles.includes(role)))
}
