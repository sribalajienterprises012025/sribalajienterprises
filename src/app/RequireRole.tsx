import type { ReactNode } from 'react'
import { useRole } from '@/hooks/useAuth'
import { EmptyState } from '@/components/ui/States'
import type { Role } from '@/types'

/**
 * Route guard for screens limited to particular roles.
 *
 * The real enforcement is RLS — this only keeps someone off a screen whose
 * every query would come back empty or rejected.
 */
export function RequireRole({
  roles,
  label,
  children,
}: {
  roles: Role[]
  label: string
  children: ReactNode
}) {
  const role = useRole()

  if (!role || !roles.includes(role)) {
    return (
      <EmptyState
        icon="🔒"
        title={`${label} is not available to you`}
        description="Ask the business owner if you need access to this section."
      />
    )
  }

  return <>{children}</>
}
