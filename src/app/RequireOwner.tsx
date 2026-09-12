import type { ReactNode } from 'react'
import { useIsOwner } from '@/hooks/useAuth'
import { EmptyState } from '@/components/ui/States'

/**
 * Route guard for owner-only screens.
 *
 * The real enforcement is in RLS — this only keeps a helper or CA from landing
 * on a screen whose every action would be rejected.
 */
export function RequireOwner({ children }: { children: ReactNode }) {
  const isOwner = useIsOwner()

  if (!isOwner) {
    return (
      <EmptyState
        icon="🔒"
        title="Owner access only"
        description="This section is limited to the business owner."
      />
    )
  }

  return <>{children}</>
}
