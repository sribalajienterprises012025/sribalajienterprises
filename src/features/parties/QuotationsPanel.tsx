import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { controlClass } from '@/components/ui/control'
import { Sheet } from '@/components/ui/Sheet'
import { Pill } from '@/components/ui/StatusPill'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useBusinessId, useIsOwner } from '@/hooks/useAuth'
import { useMasterData } from '@/hooks/useMasterData'
import { useToast } from '@/hooks/useToast'
import { describeError } from '@/lib/supabase'
import { daysUntil, formatCurrency, formatDate, humanize, todayInput } from '@/lib/format'
import { queryKeys } from '@/lib/queries/keys'
import {
  createQuotation,
  deleteQuotation,
  listQuotations,
  updateQuotation,
  type QuotationInput,
} from '@/lib/queries/quotations'
import type { PartyType, Quotation, QuotationStatus } from '@/types'

const STATUS_TONES: Record<QuotationStatus, 'neutral' | 'success' | 'danger' | 'warning'> = {
  open: 'neutral',
  accepted: 'success',
  rejected: 'danger',
  expired: 'warning',
}

/**
 * Rate quotes given to a client or broker before a load is agreed.
 *
 * In the schema from the start but never claimed by a build phase; a quote that
 * is accepted is the thing a trip then gets entered against, so the two belong
 * next to each other.
 */
export function QuotationsPanel() {
  const businessId = useBusinessId()
  const isOwner = useIsOwner()
  const toast = useToast()
  const queryClient = useQueryClient()
  const master = useMasterData()

  const [status, setStatus] = useState<QuotationStatus | 'all'>('all')
  const [formOpen, setFormOpen] = useState(false)
  const [deleting, setDeleting] = useState<Quotation | null>(null)

  const quotationsQuery = useQuery({
    queryKey: queryKeys.quotations(businessId, status),
    queryFn: () => listQuotations(businessId, status),
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['quotations'] })

  const saveMutation = useMutation({
    mutationFn: (input: QuotationInput) => createQuotation(businessId, input),
    onSuccess: async () => {
      await refresh()
      toast.success('Quotation saved')
      setFormOpen(false)
    },
    onError: (error) => toast.error(describeError(error)),
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, next }: { id: string; next: QuotationStatus }) =>
      updateQuotation(id, { status: next }),
    onSuccess: refresh,
    onError: (error) => toast.error(describeError(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteQuotation(id),
    onSuccess: async () => {
      await refresh()
      toast.success('Quotation removed')
      setDeleting(null)
    },
    onError: (error) => toast.error(describeError(error)),
  })

  if (quotationsQuery.isPending) return <LoadingState label="Loading quotations…" />
  if (quotationsQuery.isError) {
    return (
      <ErrorState
        error={quotationsQuery.error}
        onRetry={() => void quotationsQuery.refetch()}
      />
    )
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {isOwner && (
          <Button size="sm" onClick={() => setFormOpen(true)} disabled={master.hasNoParties}>
            New quotation
          </Button>
        )}
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as QuotationStatus | 'all')}
          aria-label="Filter quotations by status"
          className="min-h-[36px] rounded-lg border border-slate-300 bg-white px-2 text-sm"
        >
          <option value="all">All</option>
          <option value="open">Open</option>
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
          <option value="expired">Expired</option>
        </select>
      </div>

      {quotationsQuery.data.length === 0 ? (
        <EmptyState
          icon="📝"
          title={status === 'all' ? 'No quotations yet' : 'None with this status'}
          description="Record the rate you quoted for a route, so you can hold the line when the load is confirmed."
          action={
            isOwner && status === 'all' && !master.hasNoParties ? (
              <Button onClick={() => setFormOpen(true)}>Add a quotation</Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-2.5 pb-4">
          {quotationsQuery.data.map((quotation) => {
            const daysLeft = daysUntil(quotation.validity_date)
            const lapsed =
              daysLeft !== null && daysLeft < 0 && quotation.status === 'open'

            return (
              <div
                key={quotation.id}
                className="rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900">
                      {quotation.route ?? 'Route not set'}
                    </p>
                    <p className="mt-0.5 truncate text-sm text-slate-500">
                      {master.partyNames.get(quotation.party_id) ?? 'Party'}
                      {quotation.expected_goods && ` · ${quotation.expected_goods}`}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <Pill
                      label={humanize(quotation.status)}
                      tone={STATUS_TONES[quotation.status]}
                    />
                    <p className="mt-1 font-semibold text-slate-900">
                      {formatCurrency(quotation.quoted_rate)}
                    </p>
                  </div>
                </div>

                {quotation.validity_date && (
                  <p
                    className={[
                      'mt-2 text-xs',
                      lapsed ? 'font-medium text-amber-600' : 'text-slate-400',
                    ].join(' ')}
                  >
                    {lapsed
                      ? `Validity lapsed ${Math.abs(daysLeft)} days ago`
                      : `Valid until ${formatDate(quotation.validity_date)}`}
                  </p>
                )}

                {isOwner && quotation.status === 'open' && (
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                    <Button
                      size="sm"
                      loading={
                        statusMutation.isPending &&
                        statusMutation.variables?.id === quotation.id
                      }
                      onClick={() =>
                        statusMutation.mutate({ id: quotation.id, next: 'accepted' })
                      }
                    >
                      Accepted
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        statusMutation.mutate({ id: quotation.id, next: 'rejected' })
                      }
                    >
                      Rejected
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleting(quotation)}
                    >
                      Remove
                    </Button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {formOpen && (
        <QuotationForm
          saving={saveMutation.isPending}
          onClose={() => setFormOpen(false)}
          onSubmit={(values) => saveMutation.mutate(values)}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Remove quotation"
        message={deleting ? `Remove the quote for ${deleting.route ?? 'this route'}?` : ''}
        confirmLabel="Remove"
        loading={deleteMutation.isPending}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        onCancel={() => setDeleting(null)}
      />
    </>
  )
}

function QuotationForm({
  saving,
  onClose,
  onSubmit,
}: {
  saving: boolean
  onClose: () => void
  onSubmit: (values: QuotationInput) => void
}) {
  const { clients, brokers } = useMasterData()

  const [partyType, setPartyType] = useState<PartyType>('client')
  const [partyId, setPartyId] = useState('')
  const [route, setRoute] = useState('')
  const [goods, setGoods] = useState('')
  const [rate, setRate] = useState('')
  const [validity, setValidity] = useState('')
  const [error, setError] = useState<string | null>(null)

  const parties = partyType === 'client' ? clients : brokers

  function submit() {
    setError(null)
    if (!partyId) {
      setError('Choose who the quote is for.')
      return
    }
    if (!route.trim()) {
      setError('Enter the route being quoted.')
      return
    }
    onSubmit({
      party_type: partyType,
      party_id: partyId,
      route: route.trim(),
      expected_goods: goods.trim() || null,
      quoted_rate: rate ? Number(rate) : null,
      validity_date: validity || null,
      status: 'open',
    })
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="New quotation"
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" fullWidth onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button fullWidth onClick={submit} loading={saving}>
            Save quotation
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Party type" htmlFor="quote_party_type">
            <select
              id="quote_party_type"
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

          <Field label={partyType === 'client' ? 'Client' : 'Broker'} htmlFor="quote_party" required>
            <select
              id="quote_party"
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

        <Field label="Route" htmlFor="quote_route" required>
          <input
            id="quote_route"
            value={route}
            onChange={(event) => setRoute(event.target.value)}
            className={controlClass()}
            placeholder="e.g. Hyderabad to Nagpur"
          />
        </Field>

        <Field label="Expected goods" htmlFor="quote_goods">
          <input
            id="quote_goods"
            value={goods}
            onChange={(event) => setGoods(event.target.value)}
            className={controlClass()}
            placeholder="e.g. Cement, 16T loads"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Quoted rate (₹)" htmlFor="quote_rate">
            <input
              id="quote_rate"
              inputMode="decimal"
              value={rate}
              onChange={(event) => setRate(event.target.value)}
              className={controlClass()}
            />
          </Field>

          <Field label="Valid until" htmlFor="quote_validity">
            <input
              id="quote_validity"
              type="date"
              min={todayInput()}
              value={validity}
              onChange={(event) => setValidity(event.target.value)}
              className={controlClass()}
            />
          </Field>
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}
      </div>
    </Sheet>
  )
}
