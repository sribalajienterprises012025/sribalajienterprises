/**
 * Database types.
 *
 * Hand-maintained to match `supabase/migrations/`. Once the Supabase project
 * exists, regenerate instead of editing:
 *
 *   supabase gen types typescript --project-id <ref> > src/types/database.ts
 */

export type Role = 'owner' | 'helper' | 'ca'
export type PartyType = 'client' | 'broker'
export type BillType = 'gst' | 'non_gst'

export type TripStatus =
  | 'booked'
  | 'in_transit'
  | 'delivered'
  | 'payment_pending'
  | 'closed'
  | 'cancelled'

export type VehicleStatus = 'active' | 'in_maintenance' | 'idle' | 'sold'
export type SalaryType = 'fixed' | 'per_trip' | 'percentage'
export type CommissionType = 'percentage' | 'fixed'
export type ActiveStatus = 'active' | 'inactive'

export type ExpenseCategory =
  | 'fuel'
  | 'toll'
  | 'driver_batta'
  | 'maintenance'
  | 'tyre'
  | 'insurance'
  | 'permit'
  | 'office'
  | 'salary'
  | 'loan_emi'
  | 'other'

export type PaymentMode = 'cash' | 'upi' | 'bank' | 'card' | 'credit'

export type InvoiceStatus = 'draft' | 'unpaid' | 'part_paid' | 'paid' | 'cancelled'

interface Timestamps {
  created_at: string
  updated_at: string
}

export interface Business extends Timestamps {
  id: string
  name: string
  gstin: string | null
  pan: string | null
  address: string | null
  bank_details: Record<string, unknown>
  fy_start_month: number
}

export interface AppUser extends Timestamps {
  id: string
  business_id: string
  name: string
  role: Role
}

export interface Vehicle extends Timestamps {
  id: string
  business_id: string
  reg_no: string
  type: string | null
  capacity: number | null
  purchase_date: string | null
  insurance_expiry: string | null
  permit_expiry: string | null
  fitness_expiry: string | null
  current_odometer: number
  status: VehicleStatus
  assigned_driver_id: string | null
}

export interface Driver extends Timestamps {
  id: string
  business_id: string
  name: string
  phone: string | null
  license_no: string | null
  license_expiry: string | null
  assigned_vehicle_id: string | null
  salary_type: SalaryType
  fixed_salary_amount: number | null
  joining_date: string | null
  status: ActiveStatus
}

export interface Client extends Timestamps {
  id: string
  business_id: string
  name: string
  gstin: string | null
  contact: string | null
  address: string | null
  credit_limit: number | null
  credit_period_days: number | null
  status: ActiveStatus
}

export interface Broker extends Timestamps {
  id: string
  business_id: string
  name: string
  contact: string | null
  gstin: string | null
  commission_type: CommissionType
  commission_rate: number | null
  status: ActiveStatus
}

export interface Trip extends Timestamps {
  id: string
  business_id: string
  vehicle_id: string | null
  driver_id: string | null
  party_type: PartyType
  party_id: string
  pickup: string
  drop_location: string
  goods_description: string | null
  odometer_start: number | null
  odometer_end: number | null
  trip_date: string
  freight_amount: number
  broker_commission: number
  advance_received: number
  bill_type: BillType
  lr_number: string | null
  eway_bill_no: string | null
  tds_deducted: number
  pod_file_url: string | null
  status: TripStatus
  notes: string | null
}

export interface Expense extends Timestamps {
  id: string
  business_id: string
  category: ExpenseCategory
  vehicle_id: string | null
  trip_id: string | null
  date: string
  amount: number
  payment_mode: PaymentMode
  note: string | null
}

export interface Invoice extends Timestamps {
  id: string
  business_id: string
  trip_id: string | null
  invoice_type: BillType
  invoice_number: string
  invoice_date: string
  amount: number
  tax_breakup: Record<string, unknown>
  status: InvoiceStatus
}

/** A trip with its vehicle, driver and party names resolved for list display. */
export interface TripWithRelations extends Trip {
  vehicle: Pick<Vehicle, 'id' | 'reg_no'> | null
  driver: Pick<Driver, 'id' | 'name'> | null
  /** Resolved client-side — party_id is polymorphic, so it cannot be joined. */
  party_name?: string
}

export interface ExpenseWithRelations extends Expense {
  vehicle: Pick<Vehicle, 'id' | 'reg_no'> | null
}
