import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Pill } from '@/components/ui/StatusPill'
import { useBusinessId, useIsOwner } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import { describeError } from '@/lib/supabase'
import { formatCurrency } from '@/lib/format'
import { queryKeys } from '@/lib/queries/keys'
import {
  createBroker,
  createClient,
  deleteBroker,
  deleteClient,
  listBrokers,
  listClients,
  updateBroker,
  updateClient,
  type BrokerInput,
  type ClientInput,
} from '@/lib/queries/parties'
import type { Broker, Client } from '@/types'
import { BrokerForm, ClientForm } from './PartyForms'
import { OpeningBalanceSheet } from './OpeningBalanceSheet'
import { QuotationsPanel } from './QuotationsPanel'

type Tab = 'clients' | 'brokers' | 'quotations'

export function PartiesPage() {
  const [tab, setTab] = useState<Tab>('clients')

  return (
    <>
      <PageHeader title="Parties" subtitle="Clients you bill and brokers you work through" />

      <div className="px-4 lg:px-6">
        <div className="mb-4 inline-flex rounded-lg bg-slate-100 p-1">
          <TabButton active={tab === 'clients'} onClick={() => setTab('clients')}>
            Clients
          </TabButton>
          <TabButton active={tab === 'brokers'} onClick={() => setTab('brokers')}>
            Brokers
          </TabButton>
          <TabButton active={tab === 'quotations'} onClick={() => setTab('quotations')}>
            Quotations
          </TabButton>
        </div>

        {tab === 'clients' && <ClientsList />}
        {tab === 'brokers' && <BrokersList />}
        {tab === 'quotations' && <QuotationsPanel />}
      </div>
    </>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'inline-flex min-h-[40px] items-center justify-center rounded-md px-4 text-sm font-medium transition-colors',
        active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function ClientsList() {
  const businessId = useBusinessId()
  const isOwner = useIsOwner()
  const toast = useToast()
  const queryClient = useQueryClient()

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Client | null>(null)
  const [deleting, setDeleting] = useState<Client | null>(null)
  const [openingFor, setOpeningFor] = useState<Client | null>(null)

  const clientsQuery = useQuery({
    queryKey: queryKeys.clients(businessId),
    queryFn: () => listClients(businessId),
  })

  const saveMutation = useMutation({
    mutationFn: (input: ClientInput) =>
      editing ? updateClient(editing.id, input) : createClient(businessId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.clients(businessId) })
      toast.success(editing ? 'Client updated' : 'Client added')
      setFormOpen(false)
      setEditing(null)
    },
    onError: (error) => toast.error(describeError(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteClient(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.clients(businessId) })
      toast.success('Client removed')
      setDeleting(null)
    },
    onError: (error) => toast.error(describeError(error)),
  })

  if (clientsQuery.isPending) return <LoadingState label="Loading clients…" />
  if (clientsQuery.isError) {
    return <ErrorState error={clientsQuery.error} onRetry={() => void clientsQuery.refetch()} />
  }

  const openCreate = () => {
    setEditing(null)
    setFormOpen(true)
  }

  return (
    <>
      {isOwner && (
        <div className="mb-3">
          <Button size="sm" onClick={openCreate}>
            Add client
          </Button>
        </div>
      )}

      {clientsQuery.data.length === 0 ? (
        <EmptyState
          icon="🏢"
          title="No clients yet"
          description="Clients are the parties you raise invoices to."
          action={isOwner ? <Button onClick={openCreate}>Add your first client</Button> : undefined}
        />
      ) : (
        <div className="space-y-2.5">
          {clientsQuery.data.map((client) => (
            <div key={client.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">{client.name}</p>
                  <p className="mt-0.5 truncate text-sm text-slate-500">
                    {client.gstin ?? client.contact ?? 'No GSTIN on record'}
                  </p>
                </div>
                {client.status === 'inactive' && <Pill label="Inactive" tone="neutral" />}
              </div>

              {(client.credit_limit != null || client.credit_period_days != null) && (
                <p className="mt-2 text-xs text-slate-500">
                  {client.credit_limit != null &&
                    `Limit ${formatCurrency(client.credit_limit)}`}
                  {client.credit_limit != null && client.credit_period_days != null && ' · '}
                  {client.credit_period_days != null && `${client.credit_period_days} days`}
                </p>
              )}

              {isOwner && (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setEditing(client)
                      setFormOpen(true)
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setOpeningFor(client)}
                  >
                    Opening balance
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setDeleting(client)}>
                    Remove
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {formOpen && (
        <ClientForm
          key={editing?.id ?? 'new'}
          open={formOpen}
          client={editing}
          saving={saveMutation.isPending}
          onClose={() => {
            setFormOpen(false)
            setEditing(null)
          }}
          onSubmit={(values) => saveMutation.mutate(values)}
        />
      )}

      {openingFor && (
        <OpeningBalanceSheet
          partyType="client"
          partyId={openingFor.id}
          partyName={openingFor.name}
          onClose={() => setOpeningFor(null)}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Remove client"
        message={`Remove ${deleting?.name}? Trips and invoices already recorded are kept.`}
        confirmLabel="Remove"
        loading={deleteMutation.isPending}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        onCancel={() => setDeleting(null)}
      />
    </>
  )
}

function BrokersList() {
  const businessId = useBusinessId()
  const isOwner = useIsOwner()
  const toast = useToast()
  const queryClient = useQueryClient()

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Broker | null>(null)
  const [deleting, setDeleting] = useState<Broker | null>(null)
  const [openingFor, setOpeningFor] = useState<Broker | null>(null)

  const brokersQuery = useQuery({
    queryKey: queryKeys.brokers(businessId),
    queryFn: () => listBrokers(businessId),
  })

  const saveMutation = useMutation({
    mutationFn: (input: BrokerInput) =>
      editing ? updateBroker(editing.id, input) : createBroker(businessId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.brokers(businessId) })
      toast.success(editing ? 'Broker updated' : 'Broker added')
      setFormOpen(false)
      setEditing(null)
    },
    onError: (error) => toast.error(describeError(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteBroker(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.brokers(businessId) })
      toast.success('Broker removed')
      setDeleting(null)
    },
    onError: (error) => toast.error(describeError(error)),
  })

  if (brokersQuery.isPending) return <LoadingState label="Loading brokers…" />
  if (brokersQuery.isError) {
    return <ErrorState error={brokersQuery.error} onRetry={() => void brokersQuery.refetch()} />
  }

  const openCreate = () => {
    setEditing(null)
    setFormOpen(true)
  }

  return (
    <>
      {isOwner && (
        <div className="mb-3">
          <Button size="sm" onClick={openCreate}>
            Add broker
          </Button>
        </div>
      )}

      {brokersQuery.data.length === 0 ? (
        <EmptyState
          icon="🤝"
          title="No brokers yet"
          description="Brokers bring you loads and take a commission on the freight."
          action={isOwner ? <Button onClick={openCreate}>Add your first broker</Button> : undefined}
        />
      ) : (
        <div className="space-y-2.5">
          {brokersQuery.data.map((broker) => (
            <div key={broker.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">{broker.name}</p>
                  <p className="mt-0.5 truncate text-sm text-slate-500">
                    {broker.contact ?? 'No contact on record'}
                  </p>
                </div>
                {broker.status === 'inactive' && <Pill label="Inactive" tone="neutral" />}
              </div>

              {broker.commission_rate != null && (
                <p className="mt-2 text-xs text-slate-500">
                  Commission:{' '}
                  {broker.commission_type === 'percentage'
                    ? `${broker.commission_rate}% of freight`
                    : `${formatCurrency(broker.commission_rate)} per trip`}
                </p>
              )}

              {isOwner && (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setEditing(broker)
                      setFormOpen(true)
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setOpeningFor(broker)}
                  >
                    Opening balance
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setDeleting(broker)}>
                    Remove
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {formOpen && (
        <BrokerForm
          key={editing?.id ?? 'new'}
          open={formOpen}
          broker={editing}
          saving={saveMutation.isPending}
          onClose={() => {
            setFormOpen(false)
            setEditing(null)
          }}
          onSubmit={(values) => saveMutation.mutate(values)}
        />
      )}

      {openingFor && (
        <OpeningBalanceSheet
          partyType="broker"
          partyId={openingFor.id}
          partyName={openingFor.name}
          onClose={() => setOpeningFor(null)}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Remove broker"
        message={`Remove ${deleting?.name}? Trips already recorded are kept.`}
        confirmLabel="Remove"
        loading={deleteMutation.isPending}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        onCancel={() => setDeleting(null)}
      />
    </>
  )
}
