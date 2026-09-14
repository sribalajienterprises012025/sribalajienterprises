import { Link } from 'react-router-dom'
import { PageHeader } from '@/components/ui/PageHeader'
import { useAuth, useRole } from '@/hooks/useAuth'
import { roleLabel } from '@/lib/roles'
import { visibleNavItems } from './navigation'

/** The overflow menu behind "More" in the phone bottom bar. */
export function MorePage() {
  const role = useRole()
  const { profile, signOut } = useAuth()
  const items = visibleNavItems(role).filter((item) => !item.primary)

  return (
    <>
      <PageHeader title="More" subtitle={`${profile?.name ?? ''} · ${roleLabel(role)}`} />

      <div className="px-4 pb-6">
        <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {items.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="flex items-center gap-3 px-4 py-3.5 active:bg-slate-50"
            >
              <span className="text-xl" aria-hidden="true">
                {item.icon}
              </span>
              <span className="flex-1 text-sm font-medium text-slate-900">
                {item.label}
              </span>
              <span className="text-slate-300" aria-hidden="true">
                ›
              </span>
            </Link>
          ))}
        </div>

        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-4 w-full rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-sm font-medium text-red-600 active:bg-slate-50"
        >
          Sign out
        </button>
      </div>
    </>
  )
}
