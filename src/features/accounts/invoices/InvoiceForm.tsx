import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { controlClass } from '@/components/ui/control'
import { Sheet } from '@/components/ui/Sheet'
import { formatCurrencyPrecise, todayInput } from '@/lib/format'
import {
  GST_RATES,
  GST_STATES,
  computeGst,
  isIntraState,
  stateCodeFromGstin,
} from '@/lib/gst'
import type { Business, Client, BillType, PartyType, Trip } from '@/types'
import type { InvoiceInput } from '@/lib/queries/invoices'

interface BillableTrip extends Trip {
  vehicle: { id: string; reg_no: string } | null
}

interface InvoiceFormProps {
  open: boolean
  business: Business
  billableTrips: BillableTrip[]
  clients: Client[]
  brokers: Array<{ id: string; name: string; gstin: string | null }>
  saving: boolean
  onClose: () => void
  onSubmit: (values: Omit<InvoiceInput, 'invoice_number'>) => void
}

/**
 * Builds an invoice from a trip.
 *
 * Freight is the taxable value, and the trip already carries the party and
 * whether it was agreed GST or non-GST — so picking the trip fills nearly the
 * whole form, and the operator only confirms rate and place of supply.
 *
 * The invoice number is deliberately not shown or editable: it is allocated by
 * Postgres on save, so two people billing at once cannot collide.
 */
export function InvoiceForm({
  open,
  business,
  billableTrips,
  clients,
  brokers,
  saving,
  onClose,
  onSubmit,
}: InvoiceFormProps) {
  const [tripId, setTripId] = useState('')
  const [invoiceType, setInvoiceType] = useState<BillType>('gst')
  const [partyType, setPartyType] = useState<PartyType>('client')
  const [partyId, setPartyId] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(todayInput())
  const [taxableValue, setTaxableValue] = useState('')
  const [gstRate, setGstRate] = useState<number>(5)
  const [isRcm, setIsRcm] = useState(false)
  const [placeOfSupply, setPlaceOfSupply] = useState(
    stateCodeFromGstin(business.gstin) ?? '',
  )
  const [creditDays, setCreditDays] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  const selectedTrip = useMemo(
    () => billableTrips.find((trip) => trip.id === tripId) ?? null,
    [billableTrips, tripId],
  )

  // Picking a trip carries its party, freight and agreed bill type across, and
  // defaults the place of supply to the client's own state.
  useEffect(() => {
    if (!selectedTrip) return
    setPartyType(selectedTrip.party_type)
    setPartyId(selectedTrip.party_id)
    setTaxableValue(String(selectedTrip.freight_amount))
    setInvoiceType(selectedTrip.bill_type)
    if (selectedTrip.bill_type === 'non_gst') setGstRate(0)

    const party =
      selectedTrip.party_type === 'client'
        ? clients.find((client) => client.id === selectedTrip.party_id)
        : brokers.find((broker) => broker.id === selectedTrip.party_id)
    const code = stateCodeFromGstin(party?.gstin)
    if (code) setPlaceOfSupply(code)

    if (selectedTrip.party_type === 'client') {
      const client = clients.find((item) => item.id === selectedTrip.party_id)
      if (client?.credit_period_days != null) setCreditDays(String(client.credit_period_days))
    }
  }, [selectedTrip, clients, brokers])

  const intraState = isIntraState(business.gstin, placeOfSupply)
  const effectiveRate = invoiceType === 'non_gst' ? 0 : gstRate

  const tax = useMemo(
    () =>
      computeGst({
        taxableValue: Number(taxableValue || 0),
        rate: effectiveRate,
        intraState,
        isRcm: invoiceType === 'gst' && isRcm,
      }),
    [taxableValue, effectiveRate, intraState, isRcm, invoiceType],
  )

  const dueDate = useMemo(() => {
    const days = Number(creditDays || 0)
    if (!invoiceDate || days <= 0) return null
    const date = new Date(invoiceDate)
    date.setDate(date.getDate() + days)
    return date.toISOString().slice(0, 10)
  }, [invoiceDate, creditDays])

  const parties = partyType === 'client' ? clients : brokers

  function submit() {
    setError(null)

    if (!partyId) {
      setError('Choose the client or broker being billed.')
      return
    }
    if (Number(taxableValue || 0) <= 0) {
      setError('Enter the freight amount being billed.')
      return
    }

    onSubmit({
      trip_id: tripId || null,
      party_type: partyType,
      party_id: partyId,
      invoice_type: invoiceType,
      invoice_date: invoiceDate,
      due_date: dueDate,
      taxable_value: tax.taxable_value,
      tax_amount: tax.total_tax,
      amount: tax.total,
      gst_rate: effectiveRate,
      is_rcm: invoiceType === 'gst' && isRcm,
      place_of_supply: invoiceType === 'gst' ? placeOfSupply || null : null,
      tax_breakup: {
        taxable_value: tax.taxable_value,
        cgst_rate: tax.cgst_rate,
        cgst_amount: tax.cgst_amount,
        sgst_rate: tax.sgst_rate,
        sgst_amount: tax.sgst_amount,
        igst_rate: tax.igst_rate,
        igst_amount: tax.igst_amount,
        total_tax: tax.total_tax,
        rcm: tax.rcm,
      },
      status: 'unpaid',
      notes: notes.trim() || null,
    })
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="New invoice"
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" fullWidth onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button fullWidth onClick={submit} loading={saving}>
            Create invoice
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field
          label="Bill for trip"
          htmlFor="trip"
          hint={
            billableTrips.length === 0
              ? 'Every trip is already billed. You can still raise a standalone invoice.'
              : 'Picking a trip fills in the party, freight and bill type.'
          }
        >
          <select
            id="trip"
            value={tripId}
            onChange={(event) => setTripId(event.target.value)}
            className={controlClass()}
          >
            <option value="">Standalone invoice (no trip)</option>
            {billableTrips.map((trip) => (
              <option key={trip.id} value={trip.id}>
                {trip.trip_date} · {trip.pickup} → {trip.drop_location}
                {trip.vehicle ? ` · ${trip.vehicle.reg_no}` : ''}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Invoice type" htmlFor="invoice_type">
            <select
              id="invoice_type"
              value={invoiceType}
              onChange={(event) => {
                const next = event.target.value as BillType
                setInvoiceType(next)
                if (next === 'non_gst') setIsRcm(false)
              }}
              className={controlClass()}
            >
              <option value="gst">GST</option>
              <option value="non_gst">Non-GST</option>
            </select>
          </Field>

          <Field label="Invoice date" htmlFor="invoice_date" required>
            <input
              id="invoice_date"
              type="date"
              value={invoiceDate}
              onChange={(event) => setInvoiceDate(event.target.value)}
              className={controlClass()}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Party type" htmlFor="party_type">
            <select
              id="party_type"
              value={partyType}
              onChange={(event) => {
                setPartyType(event.target.value as PartyType)
                setPartyId('')
              }}
              className={controlClass()}
              disabled={Boolean(selectedTrip)}
            >
              <option value="client">Client</option>
              <option value="broker">Broker</option>
            </select>
          </Field>

          <Field label={partyType === 'client' ? 'Client' : 'Broker'} htmlFor="party" required>
            <select
              id="party"
              value={partyId}
              onChange={(event) => setPartyId(event.target.value)}
              className={controlClass()}
              disabled={Boolean(selectedTrip)}
            >
              <option value="">Select {partyType}</option>
              {parties.map((party) => (
                <option key={party.id} value={party.id}>
                  {party.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Taxable value — freight (₹)" htmlFor="taxable_value" required>
          <input
            id="taxable_value"
            inputMode="decimal"
            value={taxableValue}
            onChange={(event) => setTaxableValue(event.target.value)}
            className={`${controlClass()} text-lg font-semibold`}
          />
        </Field>

        {invoiceType === 'gst' && (
          <div className="space-y-3 rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              GST
            </p>

            <Field label="Rate" htmlFor="gst_rate">
              <select
                id="gst_rate"
                value={gstRate}
                onChange={(event) => setGstRate(Number(event.target.value))}
                className={controlClass()}
              >
                {GST_RATES.map((rate) => (
                  <option key={rate.value} value={rate.value}>
                    {rate.label} — {rate.note}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="Place of supply"
              htmlFor="place_of_supply"
              hint={
                intraState
                  ? 'Same state as your GSTIN — CGST + SGST.'
                  : 'Different state — IGST.'
              }
            >
              <select
                id="place_of_supply"
                value={placeOfSupply}
                onChange={(event) => setPlaceOfSupply(event.target.value)}
                className={controlClass()}
              >
                <option value="">Not specified</option>
                {GST_STATES.map((state) => (
                  <option key={state.code} value={state.code}>
                    {state.code} — {state.name}
                  </option>
                ))}
              </select>
            </Field>

            <label className="flex items-start gap-2.5 rounded-lg bg-white p-3">
              <input
                type="checkbox"
                checked={isRcm}
                onChange={(event) => setIsRcm(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300"
              />
              <span className="text-sm text-slate-700">
                Reverse charge
                <span className="mt-0.5 block text-xs text-slate-500">
                  The client pays the GST directly. The rate still shows on the invoice,
                  but nothing is collected from them.
                </span>
              </span>
            </label>
          </div>
        )}

        <Field
          label="Credit period (days)"
          htmlFor="credit_days"
          hint={dueDate ? `Due on ${dueDate}` : 'Leave blank for no due date.'}
        >
          <input
            id="credit_days"
            inputMode="numeric"
            value={creditDays}
            onChange={(event) => setCreditDays(event.target.value)}
            className={controlClass()}
          />
        </Field>

        <Field label="Notes" htmlFor="notes">
          <input
            id="notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className={controlClass()}
            placeholder="Appears on the invoice"
          />
        </Field>

        <div className="space-y-1.5 rounded-lg border border-slate-200 bg-white p-4">
          <Row label="Taxable value" value={formatCurrencyPrecise(tax.taxable_value)} />
          {tax.cgst_amount !== undefined && (
            <>
              <Row
                label={`CGST @ ${tax.cgst_rate}%`}
                value={formatCurrencyPrecise(tax.cgst_amount)}
              />
              <Row
                label={`SGST @ ${tax.sgst_rate}%`}
                value={formatCurrencyPrecise(tax.sgst_amount ?? 0)}
              />
            </>
          )}
          {tax.igst_amount !== undefined && (
            <Row
              label={`IGST @ ${tax.igst_rate}%`}
              value={formatCurrencyPrecise(tax.igst_amount)}
            />
          )}
          {tax.rcm && (
            <p className="pt-1 text-xs text-amber-600">
              Reverse charge — tax payable by the recipient.
            </p>
          )}
          <div className="flex items-center justify-between border-t border-slate-100 pt-2">
            <span className="text-sm font-medium text-slate-900">Invoice total</span>
            <span className="text-base font-semibold text-slate-900">
              {formatCurrencyPrecise(tax.total)}
            </span>
          </div>
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <p className="text-xs text-slate-400">
          The invoice number is allocated when you save, so the series never has a gap
          or a duplicate.
        </p>
      </div>
    </Sheet>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-900">{value}</span>
    </div>
  )
}
