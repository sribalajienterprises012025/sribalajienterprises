import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { controlClass } from '@/components/ui/control'
import { Sheet } from '@/components/ui/Sheet'
import { useBusinessId } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import { describeError } from '@/lib/supabase'
import { todayInput } from '@/lib/format'
import { createClaim } from '@/lib/queries/assetCare'
import type { ClaimStatus, Vehicle } from '@/types'

export function ClaimForm({
  vehicles,
  onClose,
  onSaved,
}: {
  vehicles: Vehicle[]
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const businessId = useBusinessId()
  const toast = useToast()

  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? '')
  const [claimDate, setClaimDate] = useState(todayInput())
  const [amount, setAmount] = useState('')
  const [settlement, setSettlement] = useState('')
  const [status, setStatus] = useState<ClaimStatus>('filed')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const saveMutation = useMutation({
    mutationFn: () =>
      createClaim(businessId, {
        vehicle_id: vehicleId,
        claim_date: claimDate,
        incident_note: note.trim() || null,
        claim_amount: Number(amount || 0),
        settlement_amount: settlement ? Number(settlement) : null,
        status,
      }),
    onSuccess: async () => {
      toast.success('Claim filed')
      await onSaved()
    },
    onError: (err) => toast.error(describeError(err)),
  })

  function submit() {
    setError(null)
    if (!vehicleId) {
      setError('Choose the vehicle involved.')
      return
    }
    if (Number(amount || 0) <= 0) {
      setError('Enter the amount being claimed.')
      return
    }
    if (settlement && Number(settlement) > Number(amount)) {
      setError('A settlement above the claimed amount is unlikely — check the figures.')
      return
    }
    saveMutation.mutate()
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="File an insurance claim"
      footer={
        <div className="flex gap-3">
          <Button
            variant="secondary"
            fullWidth
            onClick={onClose}
            disabled={saveMutation.isPending}
          >
            Cancel
          </Button>
          <Button fullWidth onClick={submit} loading={saveMutation.isPending}>
            File claim
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Vehicle" htmlFor="claim_vehicle" required>
            <select
              id="claim_vehicle"
              value={vehicleId}
              onChange={(event) => setVehicleId(event.target.value)}
              className={controlClass()}
            >
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.reg_no}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Claim date" htmlFor="claim_date" required>
            <input
              id="claim_date"
              type="date"
              value={claimDate}
              onChange={(event) => setClaimDate(event.target.value)}
              className={controlClass()}
            />
          </Field>
        </div>

        <Field label="Amount claimed (₹)" htmlFor="claim_amount" required>
          <input
            id="claim_amount"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className={controlClass()}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Status" htmlFor="claim_status">
            <select
              id="claim_status"
              value={status}
              onChange={(event) => setStatus(event.target.value as ClaimStatus)}
              className={controlClass()}
            >
              <option value="filed">Filed</option>
              <option value="under_review">Under review</option>
              <option value="settled">Settled</option>
              <option value="rejected">Rejected</option>
            </select>
          </Field>

          <Field
            label="Settled for (₹)"
            htmlFor="claim_settlement"
            hint="Fill in once the insurer pays."
          >
            <input
              id="claim_settlement"
              inputMode="decimal"
              value={settlement}
              onChange={(event) => setSettlement(event.target.value)}
              className={controlClass()}
            />
          </Field>
        </div>

        <Field label="What happened" htmlFor="claim_note">
          <textarea
            id="claim_note"
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className={`${controlClass()} min-h-[88px]`}
            placeholder="Date, place, damage, FIR number if any"
          />
        </Field>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}
      </div>
    </Sheet>
  )
}
