import { Outlet } from 'react-router-dom'
import { InviteBanner } from '@/features/auth/InviteBanner'
import { BottomNav } from './BottomNav'
import { Sidebar } from './Sidebar'

export function AppShell() {
  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <InviteBanner />
        {/* pb-20 keeps the last list row clear of the fixed bottom nav. */}
        <main className="flex-1 pb-20 lg:pb-6">
          <Outlet />
        </main>
      </div>
      <BottomNav />
    </div>
  )
}
