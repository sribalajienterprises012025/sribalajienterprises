import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useBusinessId } from '@/hooks/useAuth'
import { queryKeys } from '@/lib/queries/keys'
import { listVehicles } from '@/lib/queries/vehicles'
import { listDrivers } from '@/lib/queries/drivers'
import { listBrokers, listClients } from '@/lib/queries/parties'

/**
 * Vehicles, drivers, clients and brokers together.
 *
 * Trip entry, expense entry and the dashboard all need the same four lists to
 * resolve names and fill dropdowns. React Query dedupes them by key, so each
 * list is fetched once per session and shared.
 */
export function useMasterData() {
  const businessId = useBusinessId()

  const vehicles = useQuery({
    queryKey: queryKeys.vehicles(businessId),
    queryFn: () => listVehicles(businessId),
  })
  const drivers = useQuery({
    queryKey: queryKeys.drivers(businessId),
    queryFn: () => listDrivers(businessId),
  })
  const clients = useQuery({
    queryKey: queryKeys.clients(businessId),
    queryFn: () => listClients(businessId),
  })
  const brokers = useQuery({
    queryKey: queryKeys.brokers(businessId),
    queryFn: () => listBrokers(businessId),
  })

  /** party_id is polymorphic, so names are resolved from one merged lookup. */
  const partyNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const client of clients.data ?? []) map.set(client.id, client.name)
    for (const broker of brokers.data ?? []) map.set(broker.id, broker.name)
    return map
  }, [clients.data, brokers.data])

  return {
    vehicles: vehicles.data ?? [],
    drivers: drivers.data ?? [],
    clients: clients.data ?? [],
    brokers: brokers.data ?? [],
    partyNames,
    isLoading:
      vehicles.isPending || drivers.isPending || clients.isPending || brokers.isPending,
    /** True when no party exists yet — trip entry needs at least one. */
    hasNoParties:
      !clients.isPending &&
      !brokers.isPending &&
      (clients.data?.length ?? 0) === 0 &&
      (brokers.data?.length ?? 0) === 0,
  }
}
