import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Pill } from '@/components/ui/StatusPill'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useBusinessId, useCanEdit } from '@/hooks/useAuth'
import { useMasterData } from '@/hooks/useMasterData'
import { useToast } from '@/hooks/useToast'
import { describeError } from '@/lib/supabase'
import { daysUntil, formatCurrency, formatDate, humanize } from '@/lib/format'
import { stateName } from '@/lib/gst'
import { queryKeys } from '@/lib/queries/keys'
import { getBusiness } from '@/lib/queries/business'
import {
  allocateInvoiceNumber,
  cancelInvoice,
  createInvoice,
  listBillableTrips,
  listInvoices,
  updateInvoice,
  type InvoiceFilters,
  type InvoiceInput,
} from '@/lib/queries/invoices'
import type { InvoiceStatus, InvoiceWithRelations } from '@/types'
import { InvoiceForm } from './InvoiceForm'
import { NoteForm } from './NoteForm'

const STATUS_FILTERS: Array<{ value: InvoiceStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'part_paid', label: 'Part paid' },
  { value: 'paid', label: 'Paid' },
  { value: 'cancelled', label: 'Cancelled' },
]

const STATUS_TONES: Record<InvoiceStatus, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  draft: 'neutral',
  unpaid: 'warning',
  part_paid: 'info',
  paid: 'success',
  cancelled: 'danger',
}

export function InvoicesPage() {
  const businessId = useBusinessId()
  const canEdit = useCanEdit()
  const toast = useToast()
  const queryClient = useQueryClient()
  const master = useMasterData()

  const [status, setStatus] = useState<InvoiceStatus | 'all'>('all')
  const [formOpen, setFormOpen] = useState(false)
  const [noteFor, setNoteFor] = useState<InvoiceWithRelations | null>(null)
  const [cancelling, setCancelling] = useState<InvoiceWithRelations | null>(null)

  const filters = useMemo<InvoiceFilters>(() => ({ status }), [status])

  const businessQuery = useQuery({
    queryKey: queryKeys.business(businessId),
    queryFn: () => getBusiness(businessId),
  })

  const invoicesQuery = useQuery({
    queryKey: queryKeys.invoices(businessId, filters),
    queryFn: () => listInvoices(businessId, filters),
  })

  const billableQuery = useQuery({
    queryKey: queryKeys.billableTrips(businessId),
    queryFn: () => listBillableTrips(businessId),
  })

  /** An invoice moves ledgers, billable trips and the dashboard all at once. */
  const invalidateAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['invoices'] }),
      queryClient.invalidateQueries({ queryKey: ['billable-trips'] }),
      queryClient.invalidateQueries({ queryKey: ['client-ledger'] }),
      queryClient.invalidateQueries({ queryKey: ['broker-ledger'] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(businessId) }),
    ])
  }

  const createMutation = useMutation({
    mutationFn: async (values: Omit<InvoiceInput, 'invoice_number'>) => {
      // Allocated as late as possible, so an abandoned form does not burn a
      // number out of the GST series.
      const invoiceNumber = await allocateInvoiceNumber(
        businessId,
        values.invoice_type,
        values.invoice_date,
      )
      return createInvoice(businessId, { ...values, invoice_number: invoiceNumber })
    },
    onSuccess: async (invoice) => {
      await invalidateAll()
      toast.success(`Invoice ${invoice.invoice_number} created`)
      setFormOpen(false)
    },
    onError: (error) => toast.error(describeError(error)),
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, next }: { id: string; next: InvoiceStatus }) =>
      updateInvoice(id, { status: next }),
    onSuccess: async () => {
      await invalidateAll()
    },
    onError: (error) => toast.error(describeError(error)),
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelInvoice(id),
    onSuccess: async () => {
      await invalidateAll()
      toast.success('Invoice cancelled')
      setCancelling(null)
    },
    onError: (error) => toast.error(describeError(error)),
  })

  const outstanding = useMemo(
    () =>
      (invoicesQuery.data ?? [])
        .filter((invoice) => invoice.status === 'unpaid' || invoice.status === 'part_paid')
        .reduce((sum, invoice) => sum + invoice.amount, 0),
    [invoicesQuery.data],
  )

  return (
    <>
      <PageHeader
        title="Invoices"
        subtitle={`${formatCurrency(outstanding)} unpaid`}
        action={
          canEdit ? (
            <Button
              size="sm"
              onClick={() => setFormOpen(true)}
              disabled={!businessQuery.data || master.hasNoParties}
            >
              New
            </Button>
          ) : undefined
        }
      />

      <div className="space-y-3 px-4 lg:px-6">
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:px-0">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => setStatus(filter.value)}
              className={[
                'shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors',
                status === filter.value
                  ? 'bg-brand-600 text-white'
                  : 'bg-white text-slate-600 ring-1 ring-slate-200',
              ].join(' ')}
            >
              {filter.label}
            </button>
          ))}
        </div>

        {invoicesQuery.isPending ? (
          <LoadingState label="Loading invoices…" />
        ) : invoicesQuery.isError ? (
          <ErrorState error={invoicesQuery.error} onRetry={() => void invoicesQuery.refetch()} />
        ) : invoicesQuery.data.length === 0 ? (
          <EmptyState
            icon="🧾"
            title={status === 'all' ? 'No invoices yet' : 'None with this status'}
            description={
              status === 'all'
                ? 'Raise an invoice against a completed trip to start billing.'
                : 'Try a different status filter.'
            }
            action={
              canEdit && status === 'all' ? (
                <Button onClick={() => setFormOpen(true)}>Create an invoice</Button>
              ) : undefined
            }
          />
        ) : (
          <div className="space-y-2.5 pb-4">
            {invoicesQuery.data.map((invoice) => (
              <InvoiceCard
                key={invoice.id}
                invoice={invoice}
                partyName={
                  invoice.party_id ? master.partyNames.get(invoice.party_id) : undefined
                }
                canEdit={canEdit}
                busy={statusMutation.isPending && statusMutation.variables?.id === invoice.id}
                onMarkPaid={() => statusMutation.mutate({ id: invoice.id, next: 'paid' })}
                onMarkPartPaid={() =>
                  statusMutation.mutate({ id: invoice.id, next: 'part_paid' })
                }
                onAddNote={() => setNoteFor(invoice)}
                onCancel={() => setCancelling(invoice)}
              />
            ))}
          </div>
        )}
      </div>

      {formOpen && businessQuery.data && (
        <InvoiceForm
          open={formOpen}
          business={businessQuery.data}
          billableTrips={billableQuery.data ?? []}
          clients={master.clients}
          brokers={master.brokers}
          saving={createMutation.isPending}
          onClose={() => setFormOpen(false)}
          onSubmit={(values) => createMutation.mutate(values)}
        />
      )}

      {noteFor && (
        <NoteForm
          invoice={noteFor}
          onClose={() => setNoteFor(null)}
          onSaved={async () => {
            await invalidateAll()
            setNoteFor(null)
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(cancelling)}
        title="Cancel invoice"
        message={
          cancelling
            ? `Cancel ${cancelling.invoice_number}? The number stays in the series — a GST invoice is never deleted — and the amount drops out of the ledger.`
            : ''
        }
        confirmLabel="Cancel invoice"
        loading={cancelMutation.isPending}
        onConfirm={() => cancelling && cancelMutation.mutate(cancelling.id)}
        onCancel={() => setCancelling(null)}
      />
    </>
  )
}

function InvoiceCard({
  invoice,
  partyName,
  canEdit,
  busy,
  onMarkPaid,
  onMarkPartPaid,
  onAddNote,
  onCancel,
}: {
  invoice: InvoiceWithRelations
  partyName?: string
  canEdit: boolean
  busy: boolean
  onMarkPaid: () => void
  onMarkPartPaid: () => void
  onAddNote: () => void
  onCancel: () => void
}) {
  const overdueDays = daysUntil(invoice.due_date)
  const isOverdue =
    overdueDays !== null &&
    overdueDays < 0 &&
    invoice.status !== 'paid' &&
    invoice.status !== 'cancelled'

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-slate-900">{invoice.invoice_number}</p>
          <p className="mt-0.5 truncate text-sm text-slate-500">
            {formatDate(invoice.invoice_date)}
            {partyName && ` · ${partyName}`}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <Pill label={humanize(invoice.status)} tone={STATUS_TONES[invoice.status]} />
          <p className="mt-1 font-semibold text-slate-900">
            {formatCurrency(invoice.amount)}
          </p>
        </div>
      </div>

      <p className="mt-2 truncate text-xs text-slate-400">
        {[
          invoice.invoice_type === 'gst'
            ? `GST ${invoice.gst_rate}%${invoice.is_rcm ? ' · RCM' : ''}`
            : 'Non-GST',
          invoice.place_of_supply ? stateName(invoice.place_of_supply) : null,
          invoice.trip ? `${invoice.trip.pickup} → ${invoice.trip.drop_location}` : null,
          invoice.trip?.lr_number ? `LR ${invoice.trip.lr_number}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>

      {isOverdue && (
        <p className="mt-2 text-xs font-medium text-red-600">
          Overdue by {Math.abs(overdueDays)} days
        </p>
      )}
      {!isOverdue && invoice.due_date && invoice.status !== 'paid' && (
        <p className="mt-2 text-xs text-slate-400">Due {formatDate(invoice.due_date)}</p>
      )}

      {canEdit && invoice.status !== 'cancelled' && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
          {invoice.status !== 'paid' && (
            <Button size="sm" loading={busy} onClick={onMarkPaid}>
              Mark paid
            </Button>
          )}
          {invoice.status === 'unpaid' && (
            <Button variant="secondary" size="sm" loading={busy} onClick={onMarkPartPaid}>
              Part paid
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={onAddNote}>
            Credit / debit note
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  )
}
