import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { controlClass } from '@/components/ui/control'
import { Sheet } from '@/components/ui/Sheet'
import { toDateInput, todayInput } from '@/lib/format'
import type { Broker, Client, ConsignmentProgressRow, PartyType, QuantityUnit } from '@/types'
import type { ConsignmentInput } from '@/lib/queries/distribution'

const UNITS: Array<{ value: QuantityUnit; label: string }> = [
  { value: 'tonnes', label: 'Tonnes' },
  { value: 'kg', label: 'Kilograms' },
  { value: 'bags', label: 'Bags' },
  { value: 'nos', label: 'Numbers' },
  { value: 'litres', label: 'Litres' },
  { value: 'cbm', label: 'Cubic metres' },
]

export function ConsignmentForm({
  consignment,
  clients,
  brokers,
  saving,
  onClose,
  onSubmit,
}: {
  consignment: ConsignmentProgressRow | null
  clients: Client[]
  brokers: Broker[]
  saving: boolean
  onClose: () => void
  onSubmit: (values: ConsignmentInput) => void
}) {
  const [reference, setReference] = useState(consignment?.reference ?? '')
  const [partyType, setPartyType] = useState<PartyType>(consignment?.party_type ?? 'client')
  const [partyId, setPartyId] = useState(consignment?.party_id ?? '')
  const [goods, setGoods] = useState(consignment?.goods_description ?? '')
  const [quantity, setQuantity] = useState(
    consignment?.total_quantity != null ? String(consignment.total_quantity) : '',
  )
  const [unit, setUnit] = useState<QuantityUnit>(consignment?.unit ?? 'tonnes')
  const [pickup, setPickup] = useState(consignment?.pickup ?? '')
  const [drop, setDrop] = useState(consignment?.drop_location ?? '')
  const [plannedDate, setPlannedDate] = useState(
    consignment ? toDateInput(consignment.planned_date) : todayInput(),
  )
  const [note, setNote] = useState(consignment?.note ?? '')
  const [error, setError] = useState<string | null>(null)

  const parties = partyType === 'client' ? clients : brokers

  function submit() {
    setError(null)
    if (!partyId) {
      setError('Choose the client or broker this consignment is for.')
      return
    }
    if (!pickup.trim() || !drop.trim()) {
      setError('Pickup and drop are both needed.')
      return
    }

    onSubmit({
      reference: reference.trim() || null,
      party_type: partyType,
      party_id: partyId,
      goods_description: goods.trim() || null,
      total_quantity: quantity ? Number(quantity) : null,
      unit,
      pickup: pickup.trim(),
      drop_location: drop.trim(),
      planned_date: plannedDate,
      status: consignment?.status ?? 'planned',
      note: note.trim() || null,
    })
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={consignment ? 'Edit consignment' : 'New consignment'}
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" fullWidth onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button fullWidth onClick={submit} loading={saving}>
            {consignment ? 'Save changes' : 'Create consignment'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
          A consignment is one customer order. Dispatch as many trips against it as it
          takes — the planner tracks how much is still to go.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Reference" htmlFor="cons_ref" hint="Their PO or your own number.">
            <input
              id="cons_ref"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              className={controlClass()}
              placeholder="CON-001"
            />
          </Field>

          <Field label="Planned date" htmlFor="cons_date" required>
            <input
              id="cons_date"
              type="date"
              value={plannedDate}
              onChange={(event) => setPlannedDate(event.target.value)}
              className={controlClass()}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Party type" htmlFor="cons_party_type">
            <select
              id="cons_party_type"
              value={partyType}
              onChange={(event) => {
                setPartyType(event.target.value as PartyType)
                setPartyId('')
              }}
              className={controlClass()}
            >
              <option value="client">Client</option>
              <option value="broker">Broker</option>
            </select>
          </Field>

          <Field
            label={partyType === 'client' ? 'Client' : 'Broker'}
            htmlFor="cons_party"
            required
          >
            <select
              id="cons_party"
              value={partyId}
              onChange={(event) => setPartyId(event.target.value)}
              className={controlClass()}
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

        <Field label="Pickup" htmlFor="cons_pickup" required>
          <input
            id="cons_pickup"
            value={pickup}
            onChange={(event) => setPickup(event.target.value)}
            className={controlClass()}
            placeholder="e.g. Mattapalli plant"
          />
        </Field>

        <Field label="Drop" htmlFor="cons_drop" required>
          <input
            id="cons_drop"
            value={drop}
            onChange={(event) => setDrop(event.target.value)}
            className={controlClass()}
            placeholder="e.g. Nagpur yard"
          />
        </Field>

        <Field label="Goods" htmlFor="cons_goods">
          <input
            id="cons_goods"
            value={goods}
            onChange={(event) => setGoods(event.target.value)}
            className={controlClass()}
            placeholder="e.g. OPC 53 grade cement"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Total quantity" htmlFor="cons_qty">
            <input
              id="cons_qty"
              inputMode="decimal"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              className={controlClass()}
              placeholder="60"
            />
          </Field>

          <Field label="Unit" htmlFor="cons_unit">
            <select
              id="cons_unit"
              value={unit}
              onChange={(event) => setUnit(event.target.value as QuantityUnit)}
              className={controlClass()}
            >
              {UNITS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Note" htmlFor="cons_note">
          <input
            id="cons_note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className={controlClass()}
          />
        </Field>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}
      </div>
    </Sheet>
  )
}
