import type { ServiceType } from '@/types'

/** Typical intervals for a goods vehicle, used as form defaults. */
export const SERVICE_TYPES: Array<{
  value: ServiceType
  label: string
  defaultKm: number | null
  defaultDays: number | null
}> = [
  { value: 'engine_oil', label: 'Engine oil', defaultKm: 15000, defaultDays: null },
  { value: 'gearbox_oil', label: 'Gearbox oil', defaultKm: 40000, defaultDays: null },
  { value: 'differential_oil', label: 'Differential oil', defaultKm: 40000, defaultDays: null },
  { value: 'air_filter', label: 'Air filter', defaultKm: 20000, defaultDays: null },
  { value: 'general_service', label: 'General service', defaultKm: 20000, defaultDays: null },
  { value: 'tyre_rotation', label: 'Tyre rotation', defaultKm: 10000, defaultDays: null },
  { value: 'tyre_change', label: 'Tyre change', defaultKm: 80000, defaultDays: null },
  { value: 'brake', label: 'Brake work', defaultKm: 30000, defaultDays: null },
  { value: 'clutch', label: 'Clutch', defaultKm: 60000, defaultDays: null },
  { value: 'battery', label: 'Battery', defaultKm: null, defaultDays: 730 },
  { value: 'greasing', label: 'Greasing', defaultKm: null, defaultDays: 30 },
  { value: 'other', label: 'Other', defaultKm: null, defaultDays: 90 },
]

export function serviceLabel(type: ServiceType): string {
  return SERVICE_TYPES.find((item) => item.value === type)?.label ?? type
}
