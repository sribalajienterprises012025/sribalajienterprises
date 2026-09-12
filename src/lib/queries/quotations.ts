import { supabase } from '@/lib/supabase'
import type { Quotation, QuotationStatus } from '@/types'

export type QuotationInput = Omit<
  Quotation,
  'id' | 'business_id' | 'created_at' | 'updated_at'
>

export async function listQuotations(
  businessId: string,
  status?: QuotationStatus | 'all',
): Promise<Quotation[]> {
  let query = supabase
    .from('quotations')
    .select('*')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })

  if (status && status !== 'all') query = query.eq('status', status)

  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

export async function createQuotation(
  businessId: string,
  input: QuotationInput,
): Promise<Quotation> {
  const { data, error } = await supabase
    .from('quotations')
    .insert({ ...input, business_id: businessId })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateQuotation(
  id: string,
  input: Partial<QuotationInput>,
): Promise<Quotation> {
  const { data, error } = await supabase
    .from('quotations')
    .update(input)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteQuotation(id: string): Promise<void> {
  const { error } = await supabase.from('quotations').delete().eq('id', id)
  if (error) throw error
}
