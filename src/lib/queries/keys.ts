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

  invoices: (businessId: string, filters?: unknown) =>
    ['invoices', businessId, filters ?? null] as const,
  invoice: (id: string) => ['invoice', id] as const,
  billableTrips: (businessId: string) => ['billable-trips', businessId] as const,
  notes: (businessId: string, invoiceId?: string) =>
    ['notes', businessId, invoiceId ?? null] as const,

  clientLedger: (businessId: string) => ['client-ledger', businessId] as const,
  brokerLedger: (businessId: string) => ['broker-ledger', businessId] as const,
  driverLedger: (businessId: string) => ['driver-ledger', businessId] as const,
  tripFinancials: (businessId: string, filters?: unknown) =>
    ['trip-financials', businessId, filters ?? null] as const,

  payments: (businessId: string, filters?: unknown) =>
    ['payments', businessId, filters ?? null] as const,
  advances: (businessId: string, driverId?: string) =>
    ['advances', businessId, driverId ?? null] as const,
  salaryPayments: (businessId: string, driverId?: string) =>
    ['salary-payments', businessId, driverId ?? null] as const,

  consignments: (businessId: string, filters?: unknown) =>
    ['consignments', businessId, filters ?? null] as const,
  utilisation: (businessId: string, from: string, to: string) =>
    ['utilisation', businessId, from, to] as const,
  tripsInRange: (businessId: string, from: string, to: string) =>
    ['trips-in-range', businessId, from, to] as const,
  stops: (tripId: string) => ['stops', tripId] as const,

  monthlyPl: (businessId: string, range: unknown) =>
    ['monthly-pl', businessId, range] as const,
  gstSummary: (businessId: string, range: unknown) =>
    ['gst-summary', businessId, range] as const,
  vehicleMonthly: (businessId: string, range: unknown) =>
    ['vehicle-monthly', businessId, range] as const,
  complianceGaps: (businessId: string, range: unknown) =>
    ['compliance-gaps', businessId, range] as const,
} as const
