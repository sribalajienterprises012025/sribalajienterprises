/**
 * Central React Query key factory.
 *
 * Keys are built here rather than inline so that invalidating after a mutation
 * cannot silently miss a cache entry because of a typo'd key somewhere else.
 */
export const queryKeys = {
  session: ['session'] as const,
  currentUser: ['current-user'] as const,
  business: (id: string) => ['business', id] as const,

  vehicles: (businessId: string) => ['vehicles', businessId] as const,
  vehicle: (id: string) => ['vehicle', id] as const,

  drivers: (businessId: string) => ['drivers', businessId] as const,
  driver: (id: string) => ['driver', id] as const,

  clients: (businessId: string) => ['clients', businessId] as const,
  client: (id: string) => ['client', id] as const,

  brokers: (businessId: string) => ['brokers', businessId] as const,
  broker: (id: string) => ['broker', id] as const,

  trips: (businessId: string, filters?: unknown) =>
    ['trips', businessId, filters ?? null] as const,
  trip: (id: string) => ['trip', id] as const,

  expenses: (businessId: string, filters?: unknown) =>
    ['expenses', businessId, filters ?? null] as const,
  expense: (id: string) => ['expense', id] as const,

  dashboard: (businessId: string) => ['dashboard', businessId] as const,
} as const
