import type { GstRate, TaxBreakup } from '@/types'

/**
 * GST rates that apply to goods transport agency (GTA) services.
 *
 * 5% is the usual GTA rate with no input tax credit; 12% is the with-ITC
 * option. 0% covers exempt consignments (agricultural produce, milk, and the
 * small-consignment thresholds). 18% is here for non-GTA work such as
 * equipment hire billed on the same books.
 */
export const GST_RATES: Array<{ value: GstRate; label: string; note: string }> = [
  { value: 5, label: '5%', note: 'GTA, without input tax credit' },
  { value: 12, label: '12%', note: 'GTA, with input tax credit' },
  { value: 0, label: 'Exempt (0%)', note: 'Exempt consignment' },
  { value: 18, label: '18%', note: 'Non-GTA services' },
]

/**
 * The state code is the first two digits of a GSTIN — 36 is Telangana,
 * 27 Maharashtra. It decides whether a supply is intra-state (CGST + SGST) or
 * inter-state (IGST), which is the one GST decision that cannot be got wrong
 * without refiling.
 */
export function stateCodeFromGstin(gstin: string | null | undefined): string | null {
  if (!gstin) return null
  const code = gstin.trim().slice(0, 2)
  return /^\d{2}$/.test(code) ? code : null
}

export function isIntraState(
  businessGstin: string | null | undefined,
  placeOfSupply: string | null | undefined,
): boolean {
  const home = stateCodeFromGstin(businessGstin)
  const supply = placeOfSupply?.trim() ?? null
  // With no state code on either side there is nothing to compare, so the
  // safer assumption is intra-state — it is the common case, and the operator
  // can override the place of supply on the invoice.
  if (!home || !supply) return true
  return home === supply
}

export interface GstComputation extends TaxBreakup {
  total: number
}

/**
 * Splits a taxable value into its tax components.
 *
 * Intra-state splits the rate in half across CGST and SGST; inter-state puts
 * the whole rate on IGST. Under reverse charge the rate is still shown on the
 * invoice but nothing is collected, so the total equals the taxable value.
 */
export function computeGst({
  taxableValue,
  rate,
  intraState,
  isRcm = false,
}: {
  taxableValue: number
  rate: number
  intraState: boolean
  isRcm?: boolean
}): GstComputation {
  const base = round2(taxableValue)

  if (isRcm || rate === 0) {
    return {
      taxable_value: base,
      total_tax: 0,
      rcm: isRcm,
      ...(rate > 0 && isRcm
        ? intraState
          ? { cgst_rate: rate / 2, cgst_amount: 0, sgst_rate: rate / 2, sgst_amount: 0 }
          : { igst_rate: rate, igst_amount: 0 }
        : {}),
      total: base,
    }
  }

  if (intraState) {
    const half = rate / 2
    // Each half is rounded on its own so CGST and SGST match what a portal
    // computes line by line; summing then halving can leave a paisa adrift.
    const cgst = round2((base * half) / 100)
    const sgst = round2((base * half) / 100)
    return {
      taxable_value: base,
      cgst_rate: half,
      cgst_amount: cgst,
      sgst_rate: half,
      sgst_amount: sgst,
      total_tax: round2(cgst + sgst),
      rcm: false,
      total: round2(base + cgst + sgst),
    }
  }

  const igst = round2((base * rate) / 100)
  return {
    taxable_value: base,
    igst_rate: rate,
    igst_amount: igst,
    total_tax: igst,
    rcm: false,
    total: round2(base + igst),
  }
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** GST state codes, for the place-of-supply picker. */
export const GST_STATES: Array<{ code: string; name: string }> = [
  { code: '01', name: 'Jammu & Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' },
  { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' },
  { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '26', name: 'Dadra & Nagar Haveli and Daman & Diu' },
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' },
  { code: '35', name: 'Andaman & Nicobar Islands' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '38', name: 'Ladakh' },
]

export function stateName(code: string | null | undefined): string {
  if (!code) return '—'
  return GST_STATES.find((state) => state.code === code)?.name ?? code
}
