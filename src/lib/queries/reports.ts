import { supabase } from '@/lib/supabase'
import type {
  ComplianceGapRow,
  GstSummaryRow,
  MonthlyPlRow,
  VehicleMonthlyRow,
} from '@/types'

export interface DateRange {
  from: string
  to: string
}

/**
 * The report views are grouped by month, so a range filter compares against
 * the month start. `from` is snapped back to the first of its month, otherwise
 * a range beginning mid-month would drop that month entirely.
 */
function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`
}

export async function getMonthlyPl(
  businessId: string,
  range: DateRange,
): Promise<MonthlyPlRow[]> {
  const { data, error } = await supabase
    .from('monthly_pl')
    .select('*')
    .eq('business_id', businessId)
    .gte('month', monthStart(range.from))
    .lte('month', range.to)
    .order('month')

  if (error) throw error
  return data ?? []
}

export async function getGstSummary(
  businessId: string,
  range: DateRange,
): Promise<GstSummaryRow[]> {
  const { data, error } = await supabase
    .from('gst_summary')
    .select('*')
    .eq('business_id', businessId)
    .gte('month', monthStart(range.from))
    .lte('month', range.to)
    .order('month')
    .order('gst_rate')

  if (error) throw error
  return data ?? []
}

export async function getVehicleMonthly(
  businessId: string,
  range: DateRange,
): Promise<VehicleMonthlyRow[]> {
  const { data, error } = await supabase
    .from('vehicle_monthly')
    .select('*')
    .eq('business_id', businessId)
    .gte('month', monthStart(range.from))
    .lte('month', range.to)
    .order('month')

  if (error) throw error
  return data ?? []
}

export async function getComplianceGaps(
  businessId: string,
  range: DateRange,
): Promise<ComplianceGapRow[]> {
  const { data, error } = await supabase
    .from('compliance_gaps')
    .select('*')
    .eq('business_id', businessId)
    .gte('trip_date', range.from)
    .lte('trip_date', range.to)
    .order('trip_date', { ascending: false })

  if (error) throw error
  return data ?? []
}

/** Sums a set of monthly rows into one total for the chosen range. */
export function totalPl(rows: MonthlyPlRow[]) {
  return rows.reduce(
    (total, row) => ({
      trip_count: total.trip_count + row.trip_count,
      freight: total.freight + row.freight,
      broker_commission: total.broker_commission + row.broker_commission,
      tds_deducted: total.tds_deducted + row.tds_deducted,
      distance_km: total.distance_km + row.distance_km,
      expenses_total: total.expenses_total + row.expenses_total,
      fuel: total.fuel + row.fuel,
      toll: total.toll + row.toll,
      maintenance: total.maintenance + row.maintenance,
      driver_batta: total.driver_batta + row.driver_batta,
      compliance: total.compliance + row.compliance,
      loan_emi: total.loan_emi + row.loan_emi,
      office: total.office + row.office,
      salary_expense: total.salary_expense + row.salary_expense,
      other_expenses: total.other_expenses + row.other_expenses,
      driver_salaries: total.driver_salaries + row.driver_salaries,
      net_profit: total.net_profit + row.net_profit,
    }),
    {
      trip_count: 0,
      freight: 0,
      broker_commission: 0,
      tds_deducted: 0,
      distance_km: 0,
      expenses_total: 0,
      fuel: 0,
      toll: 0,
      maintenance: 0,
      driver_batta: 0,
      compliance: 0,
      loan_emi: 0,
      office: 0,
      salary_expense: 0,
      other_expenses: 0,
      driver_salaries: 0,
      net_profit: 0,
    },
  )
}

/** Collapses vehicle-month rows into one row per vehicle for the range. */
export function totalByVehicle(rows: VehicleMonthlyRow[]) {
  const map = new Map<
    string,
    {
      vehicle_id: string
      reg_no: string
      trip_count: number
      freight: number
      broker_commission: number
      distance_km: number
      expenses: number
      fuel: number
      margin: number
      cost_per_km: number | null
      revenue_per_km: number | null
    }
  >()

  for (const row of rows) {
    const existing = map.get(row.vehicle_id)
    if (existing) {
      existing.trip_count += row.trip_count
      existing.freight += row.freight
      existing.broker_commission += row.broker_commission
      existing.distance_km += row.distance_km
      existing.expenses += row.expenses
      existing.fuel += row.fuel
      existing.margin += row.margin
    } else {
      map.set(row.vehicle_id, {
        vehicle_id: row.vehicle_id,
        reg_no: row.reg_no,
        trip_count: row.trip_count,
        freight: row.freight,
        broker_commission: row.broker_commission,
        distance_km: row.distance_km,
        expenses: row.expenses,
        fuel: row.fuel,
        margin: row.margin,
        cost_per_km: null,
        revenue_per_km: null,
      })
    }
  }

  // Per-km figures are recomputed from the range totals. Averaging the monthly
  // per-km values would weight a 200 km month the same as a 12,000 km one.
  for (const vehicle of map.values()) {
    if (vehicle.distance_km > 0) {
      vehicle.cost_per_km = Math.round((vehicle.expenses / vehicle.distance_km) * 100) / 100
      vehicle.revenue_per_km =
        Math.round((vehicle.freight / vehicle.distance_km) * 100) / 100
    }
  }

  return [...map.values()].sort((a, b) => b.margin - a.margin)
}
