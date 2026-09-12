import { supabase } from '@/lib/supabase'
import type {
  CreditDebitNote,
  FullInvoice,
  InvoiceStatus,
  InvoiceWithRelations,
  NoteType,
  PartyType,
  BillType,
} from '@/types'

export type InvoiceInput = Omit<
  FullInvoice,
  'id' | 'business_id' | 'created_at' | 'updated_at'
>

export interface InvoiceFilters {
  status?: InvoiceStatus | 'all'
  invoiceType?: BillType | 'all'
  partyId?: string
  from?: string
  to?: string
}

const INVOICE_SELECT = `
  *,
  trip:trips ( id, pickup, drop_location, trip_date, lr_number )
`

export async function listInvoices(
  businessId: string,
  filters: InvoiceFilters = {},
): Promise<InvoiceWithRelations[]> {
  let query = supabase
    .from('invoices')
    .select(INVOICE_SELECT)
    .eq('business_id', businessId)
    .order('invoice_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (filters.status && filters.status !== 'all') query = query.eq('status', filters.status)
  if (filters.invoiceType && filters.invoiceType !== 'all') {
    query = query.eq('invoice_type', filters.invoiceType)
  }
  if (filters.partyId) query = query.eq('party_id', filters.partyId)
  if (filters.from) query = query.gte('invoice_date', filters.from)
  if (filters.to) query = query.lte('invoice_date', filters.to)

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as unknown as InvoiceWithRelations[]
}

export async function getInvoice(id: string): Promise<InvoiceWithRelations> {
  const { data, error } = await supabase
    .from('invoices')
    .select(INVOICE_SELECT)
    .eq('id', id)
    .single()

  if (error) throw error
  return data as unknown as InvoiceWithRelations
}

/**
 * Asks Postgres for the next number in the series.
 *
 * Allocated server-side, not by counting rows here, so two people billing at
 * the same moment cannot be handed the same invoice number.
 */
export async function allocateInvoiceNumber(
  businessId: string,
  invoiceType: BillType,
  invoiceDate: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('next_invoice_number', {
    p_business_id: businessId,
    p_invoice_type: invoiceType,
    p_date: invoiceDate,
  })

  if (error) throw error
  return data as string
}

export async function createInvoice(
  businessId: string,
  input: InvoiceInput,
): Promise<FullInvoice> {
  const { data, error } = await supabase
    .from('invoices')
    .insert({ ...input, business_id: businessId })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateInvoice(
  id: string,
  input: Partial<InvoiceInput>,
): Promise<FullInvoice> {
  const { data, error } = await supabase
    .from('invoices')
    .update(input)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Invoices are cancelled, never deleted.
 *
 * A GST invoice number that has been issued must stay accounted for — a gap in
 * the series is a filing question nobody wants to answer. Cancelled invoices
 * drop out of the ledgers, so the numbers stay right either way.
 */
export async function cancelInvoice(id: string): Promise<FullInvoice> {
  return updateInvoice(id, { status: 'cancelled' })
}

/** Trips that have been run but not yet billed — the invoice form's worklist. */
export async function listBillableTrips(businessId: string) {
  const { data, error } = await supabase
    .from('trips')
    .select('*, vehicle:vehicles ( id, reg_no )')
    .eq('business_id', businessId)
    .not('status', 'in', '("cancelled")')
    .order('trip_date', { ascending: false })

  if (error) throw error

  const { data: invoiced, error: invoiceError } = await supabase
    .from('invoices')
    .select('trip_id')
    .eq('business_id', businessId)
    .neq('status', 'cancelled')
    .not('trip_id', 'is', null)

  if (invoiceError) throw invoiceError

  const billed = new Set((invoiced ?? []).map((row) => row.trip_id as string))
  return (data ?? []).filter((trip) => !billed.has(trip.id))
}

// --- credit and debit notes --------------------------------------------------

export type NoteInput = {
  invoice_id: string
  party_type: PartyType
  party_id: string
  type: NoteType
  amount: number
  reason: string | null
  date: string
}

export async function listNotes(
  businessId: string,
  invoiceId?: string,
): Promise<CreditDebitNote[]> {
  let query = supabase
    .from('credit_debit_notes')
    .select('*')
    .eq('business_id', businessId)
    .order('date', { ascending: false })

  if (invoiceId) query = query.eq('invoice_id', invoiceId)

  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

export async function createNote(
  businessId: string,
  input: NoteInput,
): Promise<CreditDebitNote> {
  const { data, error } = await supabase
    .from('credit_debit_notes')
    .insert({ ...input, business_id: businessId })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteNote(id: string): Promise<void> {
  const { error } = await supabase.from('credit_debit_notes').delete().eq('id', id)
  if (error) throw error
}
