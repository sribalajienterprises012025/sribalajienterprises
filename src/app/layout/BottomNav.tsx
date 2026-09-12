import { NavLink } from 'react-router-dom'
import { useRole } from '@/hooks/useAuth'
import { visibleNavItems } from './navigation'

/**
 * Phone navigation. Three primary destinations plus More, because a five-icon
 * bar on a 360px screen leaves labels unreadable.
 */
export function BottomNav() {
  const role = useRole()
  const items = visibleNavItems(role)
  const primary = items.filter((item) => item.primary)

  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white lg:hidden">
      <div className="grid grid-cols-4">
        {primary.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              [
                'flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors',
                isActive ? 'text-brand-600' : 'text-slate-500',
              ].join(' ')
            }
          >
            <span className="text-xl leading-none" aria-hidden="true">
              {item.icon}
            </span>
            {item.label}
          </NavLink>
        ))}

        <NavLink
          to="/more"
          className={({ isActive }) =>
            [
              'flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors',
              isActive ? 'text-brand-600' : 'text-slate-500',
            ].join(' ')
          }
        >
          <span className="text-xl leading-none" aria-hidden="true">
            ☰
          </span>
          More
        </NavLink>
      </div>
    </nav>
  )
}
