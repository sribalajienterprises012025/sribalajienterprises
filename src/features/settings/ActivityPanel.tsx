import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Pill } from '@/components/ui/StatusPill'
import { LoadingState } from '@/components/ui/States'
import { controlClass } from '@/components/ui/control'
import { useBusinessId } from '@/hooks/useAuth'
import { humanize } from '@/lib/format'
import { queryKeys } from '@/lib/queries/keys'
import { listAudit } from '@/lib/queries/staff'
import type { AuditAction, AuditEntry } from '@/types'

/**
 * What each audited table is called on screen.
 *
 * The table name cannot be shown directly: a row is one record, so "Created
 * payments" is wrong, and `credit_debit_notes` and `vehicle_maintenance_log`
 * are not phrases anyone says. One name for a single record, one for the
 * filter, which is naming a category.
 *
 * Every table with an audit trigger in 20250101000800_staff_and_audit.sql
 * appears here, so nothing recorded can turn up on screen unnamed.
 */
const RECORD_LABELS: Record<string, { one: string; many: string }> = {
  trips: { one: 'Trip', many: 'Trips' },
  invoices: { one: 'Invoice', many: 'Invoices' },
  expenses: { one: 'Expense', many: 'Expenses' },
  payments: { one: 'Payment', many: 'Payments' },
  credit_debit_notes: { one: 'Credit / debit note', many: 'Credit & debit notes' },
  vehicles: { one: 'Vehicle', many: 'Vehicles' },
  drivers: { one: 'Driver', many: 'Drivers' },
  clients: { one: 'Client', many: 'Clients' },
  brokers: { one: 'Broker', many: 'Brokers' },
  driver_advances: { one: 'Driver advance', many: 'Driver advances' },
  driver_salary_payments: { one: 'Salary payment', many: 'Salary payments' },
  consignments: { one: 'Consignment', many: 'Consignments' },
  service_schedules: { one: 'Service schedule', many: 'Service schedules' },
  vehicle_maintenance_log: { one: 'Workshop entry', many: 'Workshop history' },
  insurance_claims: { one: 'Insurance claim', many: 'Insurance claims' },
  opening_balances: { one: 'Opening balance', many: 'Opening balances' },
  quotations: { one: 'Quotation', many: 'Quotations' },
  users: { one: 'Staff member', many: 'Staff' },
  invites: { one: 'Invitation', many: 'Invitations' },
  businesses: { one: 'Business details', many: 'Business details' },
}

const TABLES = ['all', ...Object.keys(RECORD_LABELS)]

/** Falls back to the raw name, so an unmapped table is still readable. */
function recordLabel(table: string, form: 'one' | 'many'): string {
  return RECORD_LABELS[table]?.[form] ?? humanize(table)
}

const ACTION_TONES: Record<AuditAction, 'success' | 'info' | 'danger'> = {
  insert: 'success',
  update: 'info',
  delete: 'danger',
}

const ACTION_LABELS: Record<AuditAction, string> = {
  insert: 'Created',
  update: 'Changed',
  delete: 'Deleted',
}

/** Owner-only view of the audit trail. */
export function ActivityPanel() {
  const businessId = useBusinessId()
  const [tableName, setTableName] = useState('all')

  const auditQuery = useQuery({
    queryKey: queryKeys.audit(businessId, { tableName }),
    queryFn: () => listAudit(businessId, { tableName, limit: 150 }),
  })

  return (
    <Card>
      <CardHeader title="Activity" />
      <CardBody className="space-y-3">
        <select
          value={tableName}
          onChange={(event) => setTableName(event.target.value)}
          aria-label="Filter activity by record type"
          className={controlClass()}
        >
          {TABLES.map((table) => (
            <option key={table} value={table}>
              {table === 'all' ? 'Everything' : recordLabel(table, 'many')}
            </option>
          ))}
        </select>

        {auditQuery.isPending ? (
          <LoadingState label="Loading activity…" />
        ) : (auditQuery.data?.length ?? 0) === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">
            Nothing recorded yet.
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {auditQuery.data?.map((entry) => (
              <AuditRow key={entry.id} entry={entry} />
            ))}
          </div>
        )}

        <p className="text-xs text-slate-400">
          Written by database triggers, not by the app, so a change made outside the app
          is recorded too. Nobody can add to or alter this log — not even the owner.
        </p>
      </CardBody>
    </Card>
  )
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const [open, setOpen] = useState(false)

  const changedFields =
    entry.action === 'update' && entry.diff ? Object.keys(entry.diff) : []

  return (
    <div className="py-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-start justify-between gap-3 text-left"
      >
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-900">
            {recordLabel(entry.table_name, 'one')}
          </p>
          {/* Wraps rather than truncates: on a 390px screen a long name would
              otherwise clip the timestamp, which is the part being looked for. */}
          <p className="mt-0.5 text-xs text-slate-500">
            {entry.user_name ?? 'System'}
            {entry.user_role && ` (${entry.user_role})`}
            <span className="whitespace-nowrap">
              {' · '}
              {new Date(entry.changed_at).toLocaleString('en-IN', {
                day: '2-digit',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </p>
          {changedFields.length > 0 && (
            <p className="mt-1 truncate text-xs text-slate-400">
              {changedFields.slice(0, 4).map(humanize).join(', ')}
              {changedFields.length > 4 && ` +${changedFields.length - 4} more`}
            </p>
          )}
        </div>
        <Pill label={ACTION_LABELS[entry.action]} tone={ACTION_TONES[entry.action]} />
      </button>

      {open && entry.diff && (
        <div className="mt-2.5 space-y-1.5 rounded-lg bg-slate-50 p-3">
          {entry.action === 'update' ? (
            Object.entries(entry.diff).map(([field, change]) => {
              const pair = change as { from?: unknown; to?: unknown }
              return (
                <div key={field} className="text-xs">
                  <span className="font-medium text-slate-700">{humanize(field)}</span>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-700">
                      {renderValue(pair.from)}
                    </span>
                    <span className="text-slate-400">to</span>
                    <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">
                      {renderValue(pair.to)}
                    </span>
                  </div>
                </div>
              )
            })
          ) : (
            // Inserts and deletes keep the whole row; the noisy plumbing
            // columns are hidden so the meaningful fields stand out.
            <div className="space-y-1">
              {Object.entries(entry.diff)
                .filter(([field]) => !HIDDEN_FIELDS.has(field))
                .map(([field, value]) => (
                  <div key={field} className="flex justify-between gap-3 text-xs">
                    <span className="text-slate-500">{humanize(field)}</span>
                    <span className="truncate text-right text-slate-800">
                      {renderValue(value)}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const HIDDEN_FIELDS = new Set(['id', 'business_id', 'created_at', 'updated_at'])

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return 'empty'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'object') return JSON.stringify(value)
  const text = String(value)
  return text.length > 60 ? `${text.slice(0, 57)}...` : text
}
