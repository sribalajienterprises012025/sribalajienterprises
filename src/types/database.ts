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

// =============================================================================
// Phase 2 — invoicing, payments and ledgers
// =============================================================================

export type PaymentDirection = 'in' | 'out'
export type PaymentMethod = 'cash' | 'upi' | 'bank' | 'cheque' | 'card' | 'adjustment'
export type NoteType = 'credit' | 'debit'

/** GST rates that apply to goods transport. 5% is the common GTA rate. */
export type GstRate = 0 | 5 | 12 | 18

export interface Payment extends Timestamps {
  id: string
  business_id: string
  party_type: PartyType
  party_id: string
  direction: PaymentDirection
  date: string
  amount: number
  mode: PaymentMethod
  reference: string | null
  invoice_id: string | null
  trip_id: string | null
  note: string | null
}

export interface CreditDebitNote extends Timestamps {
  id: string
  business_id: string
  invoice_id: string
  party_type: PartyType | null
  party_id: string | null
  type: NoteType
  amount: number
  reason: string | null
  date: string
}

/** The jsonb stored on invoices.tax_breakup. */
export interface TaxBreakup {
  taxable_value: number
  cgst_rate?: number
  cgst_amount?: number
  sgst_rate?: number
  sgst_amount?: number
  igst_rate?: number
  igst_amount?: number
  total_tax: number
  rcm: boolean
}

export interface FullInvoice extends Timestamps {
  id: string
  business_id: string
  trip_id: string | null
  party_type: PartyType | null
  party_id: string | null
  invoice_type: BillType
  invoice_number: string
  invoice_date: string
  due_date: string | null
  amount: number
  taxable_value: number
  tax_amount: number
  gst_rate: number
  is_rcm: boolean
  place_of_supply: string | null
  tax_breakup: TaxBreakup | Record<string, never>
  status: InvoiceStatus
  notes: string | null
}

export interface InvoiceWithRelations extends FullInvoice {
  trip: Pick<Trip, 'id' | 'pickup' | 'drop_location' | 'trip_date' | 'lr_number'> | null
}

export interface DriverAdvance extends Timestamps {
  id: string
  business_id: string
  driver_id: string
  date: string
  amount: number
  reason: string | null
  adjusted: boolean
}

export interface DriverSalaryPayment extends Timestamps {
  id: string
  business_id: string
  driver_id: string
  period_month: string
  salary_earned: number
  advances_deducted: number
  other_deductions: number
  net_payable: number
  amount_paid: number
  paid_date: string | null
}

// --- ledger views (read-only) ------------------------------------------------

export interface ClientLedgerRow {
  business_id: string
  client_id: string
  client_name: string
  credit_limit: number | null
  credit_period_days: number | null
  opening_balance: number
  invoiced: number
  unbilled_freight: number
  debit_notes: number
  credit_notes: number
  advances_received: number
  tds_deducted: number
  receipts: number
  trip_count: number
  invoice_count: number
  /** Positive means the client owes the business. */
  balance: number
}

export interface BrokerLedgerRow {
  business_id: string
  broker_id: string
  broker_name: string
  commission_type: CommissionType
  commission_rate: number | null
  opening_balance: number
  invoiced: number
  unbilled_freight: number
  advances_received: number
  tds_deducted: number
  receipts: number
  debit_notes: number
  credit_notes: number
  trip_count: number
  freight_receivable: number
  commission_earned: number
  commission_paid: number
  commission_payable: number
  /** Positive means the broker owes the business. */
  net_balance: number
}

export interface DriverLedgerRow {
  business_id: string
  driver_id: string
  driver_name: string
  salary_type: SalaryType
  fixed_salary_amount: number | null
  opening_balance: number
  advances_outstanding: number
  advances_total: number
  salary_earned: number
  salary_paid: number
  salary_due: number
  trip_count: number
  /** Positive means the business owes the driver. */
  net_payable: number
}

export interface TripFinancialsRow {
  trip_id: string
  business_id: string
  vehicle_id: string | null
  driver_id: string | null
  party_type: PartyType
  party_id: string
  trip_date: string
  status: TripStatus
  bill_type: BillType
  freight_amount: number
  broker_commission: number
  advance_received: number
  tds_deducted: number
  trip_expenses: number
  distance_km: number | null
  net_margin: number
  balance_due: number
}
