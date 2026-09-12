import { NavLink } from 'react-router-dom'
import { useAuth, useRole } from '@/hooks/useAuth'
import { humanize } from '@/lib/format'
import { visibleNavItems } from './navigation'

export function Sidebar() {
  const role = useRole()
  const { profile, signOut } = useAuth()
  const items = visibleNavItems(role)

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
      <div className="flex items-center gap-2 px-5 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-900 text-sm font-bold text-white">
          BE
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">
            Balaji Enterprises
          </p>
          <p className="text-xs text-slate-500">Transport &amp; Accounts</p>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 px-3">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              [
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
              ].join(' ')
            }
          >
            <span className="text-base" aria-hidden="true">
              {item.icon}
            </span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-slate-100 px-3 py-3">
        <div className="px-2 pb-2">
          <p className="truncate text-sm font-medium text-slate-900">
            {profile?.name ?? 'Signed in'}
          </p>
          <p className="text-xs text-slate-500">{humanize(profile?.role)}</p>
        </div>
        <button
          type="button"
          onClick={() => void signOut()}
          className="w-full rounded-lg px-2 py-2 text-left text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          Sign out
        </button>
      </div>
    </aside>
  )
}
