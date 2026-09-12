import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { ExpiryPill, VehicleStatusPill } from '@/components/ui/StatusPill'
import { useBusinessId, useIsOwner } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import { describeError } from '@/lib/supabase'
import { daysUntil, formatKm } from '@/lib/format'
import { queryKeys } from '@/lib/queries/keys'
import {
  createVehicle,
  deleteVehicle,
  listVehicles,
  updateVehicle,
  type VehicleInput,
} from '@/lib/queries/vehicles'
import type { Vehicle } from '@/types'
import { VehicleForm } from './VehicleForm'

export function VehiclesPage() {
  const businessId = useBusinessId()
  const isOwner = useIsOwner()
  const toast = useToast()
  const queryClient = useQueryClient()

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Vehicle | null>(null)
  const [deleting, setDeleting] = useState<Vehicle | null>(null)

  const vehiclesQuery = useQuery({
    queryKey: queryKeys.vehicles(businessId),
    queryFn: () => listVehicles(businessId),
  })

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.vehicles(businessId) })

  const saveMutation = useMutation({
    mutationFn: (input: VehicleInput) =>
      editing ? updateVehicle(editing.id, input) : createVehicle(businessId, input),
    onSuccess: async () => {
      await invalidate()
      toast.success(editing ? 'Vehicle updated' : 'Vehicle added')
      closeForm()
    },
    onError: (error) => toast.error(describeError(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteVehicle(id),
    onSuccess: async () => {
      await invalidate()
      toast.success('Vehicle removed')
      setDeleting(null)
    },
    onError: (error) => toast.error(describeError(error)),
  })

  function closeForm() {
    setFormOpen(false)
    setEditing(null)
  }

  function openCreate() {
    setEditing(null)
    setFormOpen(true)
  }

  function openEdit(vehicle: Vehicle) {
    setEditing(vehicle)
    setFormOpen(true)
  }

  return (
    <>
      <PageHeader
        title="Vehicles"
        subtitle={
          vehiclesQuery.data ? `${vehiclesQuery.data.length} in the fleet` : undefined
        }
        action={
          isOwner ? (
            <Button size="sm" onClick={openCreate}>
              Add
            </Button>
          ) : undefined
        }
      />

      <div className="px-4 lg:px-6">
        {vehiclesQuery.isPending ? (
          <LoadingState label="Loading vehicles…" />
        ) : vehiclesQuery.isError ? (
          <ErrorState error={vehiclesQuery.error} onRetry={() => void vehiclesQuery.refetch()} />
        ) : vehiclesQuery.data.length === 0 ? (
          <EmptyState
            icon="🚛"
            title="No vehicles yet"
            description="Add your trucks so trips, expenses and document expiry can be tracked against them."
            action={isOwner ? <Button onClick={openCreate}>Add your first vehicle</Button> : undefined}
          />
        ) : (
          <div className="space-y-2.5">
            {vehiclesQuery.data.map((vehicle) => (
              <VehicleRow
                key={vehicle.id}
                vehicle={vehicle}
                canEdit={isOwner}
                onEdit={() => openEdit(vehicle)}
                onDelete={() => setDeleting(vehicle)}
              />
            ))}
          </div>
        )}
      </div>

      {formOpen && (
        <VehicleForm
          // Remount per record so react-hook-form re-reads defaultValues.
          key={editing?.id ?? 'new'}
          open={formOpen}
          vehicle={editing}
          saving={saveMutation.isPending}
          onClose={closeForm}
          onSubmit={(values) => saveMutation.mutate(values)}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Remove vehicle"
        message={`Remove ${deleting?.reg_no}? Trips already logged against it are kept, but will no longer show a vehicle.`}
        confirmLabel="Remove"
        loading={deleteMutation.isPending}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        onCancel={() => setDeleting(null)}
      />
    </>
  )
}

function VehicleRow({
  vehicle,
  canEdit,
  onEdit,
  onDelete,
}: {
  vehicle: Vehicle
  canEdit: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-slate-900">{vehicle.reg_no}</p>
          <p className="mt-0.5 text-sm text-slate-500">
            {[vehicle.type, vehicle.capacity ? `${vehicle.capacity}T` : null]
              .filter(Boolean)
              .join(' · ') || 'No type set'}
          </p>
        </div>
        <VehicleStatusPill status={vehicle.status} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-slate-500">{formatKm(vehicle.current_odometer)}</span>
        <ExpiryPill days={daysUntil(vehicle.insurance_expiry)} label="Insurance" />
        <ExpiryPill days={daysUntil(vehicle.permit_expiry)} label="Permit" />
        <ExpiryPill days={daysUntil(vehicle.fitness_expiry)} label="Fitness" />
      </div>

      {canEdit && (
        <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3">
          <Button variant="secondary" size="sm" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete}>
            Remove
          </Button>
        </div>
      )}
    </div>
  )
}
