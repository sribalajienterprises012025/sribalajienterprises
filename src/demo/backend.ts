/**
 * A PostgREST-shaped backend that lives in the browser, for the demo build.
 *
 * The app is not modified to accommodate it: this patches `fetch`, so every
 * query, insert, update and RPC goes through the same supabase-js code paths as
 * production. Only the answer comes from localStorage instead of Postgres.
 *
 * Writes persist, and views are recomputed on read, so logging a trip really
 * does move the dashboard, the client ledger and the P&L.
 *
 * Compiled in only when VITE_DEMO=1, so none of this reaches a real build.
 */

import {
  buildSeed,
  BUSINESS_ID,
  DRIVER_USER_ID,
  OWNER_ID,
  type Row,
  type Tables,
} from './seed'
import { DRIVER_VIEWS, VIEWS } from './views'

const STORE_KEY = 'balaji-demo-data-v1'
const SESSION_KEY = 'sb-demo-auth-token'

// --- persistence -------------------------------------------------------------

function load(): Tables {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) return JSON.parse(raw) as Tables
  } catch {
    // A blocked or full store just means starting from the seed each time.
  }
  const seed = buildSeed()
  save(seed)
  return seed
}

function save(tables: Tables): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(tables))
  } catch {
    // Non-fatal: the demo keeps working for this page load.
  }
}

let db: Tables = {}

/** Starts the demo over from the seed. Exposed on window for the reset button. */
export function resetDemo(): void {
  try {
    localStorage.removeItem(STORE_KEY)
  } catch {
    /* ignore */
  }
  db = load()
}

// --- PostgREST filter parsing ------------------------------------------------

type Cmp = (row: Row) => boolean

function valueOf(raw: string): unknown {
  if (raw === 'null') return null
  if (raw === 'true') return true
  if (raw === 'false') return false
  return raw
}

/** `eq.5`, `gte.2025-01-01`, `is.null`, `in.("a","b")` against one column. */
function makeCmp(column: string, expr: string): Cmp {
  const dot = expr.indexOf('.')
  const op = dot === -1 ? 'eq' : expr.slice(0, dot)
  const rawValue = dot === -1 ? expr : expr.slice(dot + 1)
  const value = valueOf(rawValue)

  const get = (row: Row) => row[column]
  const comparable = (v: unknown) =>
    typeof v === 'string' || typeof v === 'number' ? v : ''

  switch (op) {
    case 'eq':
      return (r) => String(get(r) ?? '') === String(value ?? '')
    case 'neq':
      return (r) => String(get(r) ?? '') !== String(value ?? '')
    case 'gt':
      return (r) => comparable(get(r)) > comparable(value)
    case 'gte':
      return (r) => comparable(get(r)) >= comparable(value)
    case 'lt':
      return (r) => comparable(get(r)) < comparable(value)
    case 'lte':
      return (r) => comparable(get(r)) <= comparable(value)
    case 'is':
      return (r) => (value === null ? get(r) == null : get(r) === value)
    case 'like':
    case 'ilike': {
      const pattern = String(rawValue).replace(/%/g, '').toLowerCase()
      return (r) =>
        String(get(r) ?? '')
          .toLowerCase()
          .includes(pattern)
    }
    case 'in': {
      const items = String(rawValue)
        .replace(/^\(|\)$/g, '')
        .split(',')
        .map((x) => x.replace(/^"|"$/g, ''))
      return (r) => items.includes(String(get(r) ?? ''))
    }
    case 'not': {
      // Arrives as `not.in.(...)` or `not.is.null`.
      const inner = makeCmp(column, rawValue)
      return (r) => !inner(r)
    }
    default:
      return () => true
  }
}

interface Query {
  filters: Cmp[]
  order: Array<{ column: string; asc: boolean }>
  limit: number | null
  select: string
}

function parseQuery(params: URLSearchParams): Query {
  const filters: Cmp[] = []
  const order: Array<{ column: string; asc: boolean }> = []
  let limit: number | null = null
  let select = '*'

  for (const [key, raw] of params.entries()) {
    if (key === 'select') {
      select = raw
      continue
    }
    if (key === 'limit') {
      limit = Number(raw)
      continue
    }
    if (key === 'offset') continue
    if (key === 'order') {
      for (const part of raw.split(',')) {
        const pieces = part.split('.')
        const column = pieces[0]
        if (!column) continue
        order.push({ column, asc: !pieces.slice(1).includes('desc') })
      }
      continue
    }
    if (key === 'or') {
      // or=(a.ilike.%x%,b.ilike.%x%)
      const branches = raw.replace(/^\(|\)$/g, '').split(',')
      const cmps = branches.map((branch) => {
        const first = branch.indexOf('.')
        return makeCmp(branch.slice(0, first), branch.slice(first + 1))
      })
      filters.push((row) => cmps.some((c) => c(row)))
      continue
    }
    filters.push(makeCmp(key, raw))
  }

  return { filters, order, limit, select }
}

/** Resolves `vehicle:vehicles ( id, reg_no )` style embeds in a select. */
function applyEmbeds(rows: Row[], select: string): Row[] {
  const embeds = [...select.matchAll(/(\w+)\s*:\s*(\w+)\s*\(([^)]*)\)/g)]
  if (embeds.length === 0) return rows

  return rows.map((row) => {
    const out: Row = { ...row }
    for (const match of embeds) {
      const alias = match[1]
      const table = match[2]
      const fieldList = match[3]
      if (!alias || !table || fieldList === undefined) continue
      const fields = fieldList
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean)
      // Convention throughout this schema: <alias>_id points at <table>.id.
      const fk = `${alias}_id`
      const target = (db[table] ?? []).find(
        (candidate: Row) => String(candidate.id) === String(row[fk]),
      )
      out[alias] = target ? Object.fromEntries(fields.map((f) => [f, target[f]])) : null
    }
    return out
  })
}

function runSelect(table: string, params: URSearchParamsLike): Row[] {
  const query = parseQuery(params as URLSearchParams)
  // The driver's own views need to know who is asking, the way the real ones
  // take it from the session rather than from anything the caller sends.
  const source = DRIVER_VIEWS[table]
    ? DRIVER_VIEWS[table](db, currentDriverId() ?? '')
    : VIEWS[table]
      ? VIEWS[table](db)
      : (db[table] ?? [])

  let rows = source.filter((row) => query.filters.every((f) => f(row)))

  for (const { column, asc } of [...query.order].reverse()) {
    rows = [...rows].sort((a, b) => {
      const av = a[column]
      const bv = b[column]
      if (av == null && bv == null) return 0
      if (av == null) return asc ? -1 : 1
      if (bv == null) return asc ? 1 : -1
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return asc ? cmp : -cmp
    })
  }

  if (query.limit != null) rows = rows.slice(0, query.limit)
  return applyEmbeds(rows, query.select)
}

type URSearchParamsLike = URLSearchParams

// --- failures ----------------------------------------------------------------

/** Mirrors a PostgREST error body, so `describeError` reads it as it would live. */
class DemoError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message)
  }
}

/**
 * The write side of RLS, reproduced.
 *
 * Worth doing rather than letting every write through: the whole point of the
 * three roles is that a helper cannot touch master data and a CA cannot touch
 * anything, and a demo that ignores that would teach the wrong thing. The two
 * lists below are copied from the policies in
 * `20250101000100_rls_policies.sql` and the per-table policies that follow it.
 */
const HELPER_WRITABLE = new Set([
  'trips',
  'expenses',
  'invoices',
  'credit_debit_notes',
  'payments',
  'trip_stops',
  'documents',
])

/** The driver record the signed-in demo user is, or null for everyone else. */
function currentDriverId(): string | null {
  const id = currentDemoUserId()
  const row = (db.users ?? []).find((user) => user.id === id)
  return row?.driver_id ? String(row.driver_id) : null
}

/** The trip is the caller's, or the call fails the way the real function does. */
function ownTrip(tripId: string): Row {
  const driverId = currentDriverId()
  if (!driverId) {
    throw new DemoError('Only a driver can do that', '42501', 403)
  }
  const trip = (db.trips ?? []).find(
    (row) => row.id === tripId && String(row.driver_id) === driverId,
  )
  if (!trip) throw new DemoError('That trip is not yours', '42501', 403)
  return trip
}

/**
 * Writes a trip from inside a driver function.
 *
 * Direct rather than through update(), because update() runs the write checks
 * that would — correctly — refuse a driver. The real functions are SECURITY
 * DEFINER for exactly the same reason.
 */
function patchTrip(trip: Row, changes: Row): void {
  db.trips = (db.trips ?? []).map((row) => {
    if (row.id !== trip.id) return row
    const next = { ...row, ...changes, updated_at: new Date().toISOString() }
    audit('trips', 'update', next, row)
    return next
  })
  save(db)
}

function assertCanWrite(table: string, method: string): void {
  const role = demoUser(currentDemoUserId()).role
  if (role === 'owner') return

  const denied = new DemoError(
    'new row violates row-level security policy',
    '42501',
    403,
  )

  // A CA reads and exports; a driver writes only through the driver functions.
  // Every direct write from either is refused, as the restrictive policies in
  // the driver migration refuse it in Postgres.
  if (role !== 'helper') throw denied
  if (!HELPER_WRITABLE.has(table)) throw denied
  // A helper may attach a proof of delivery but never delete one.
  if (table === 'documents' && method === 'DELETE') throw denied
}

// --- writes ------------------------------------------------------------------

function uuid(): string {
  if (crypto?.randomUUID) return crypto.randomUUID()
  return `x${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`
}

function stampNow(): Row {
  const now = new Date().toISOString()
  return { created_at: now, updated_at: now }
}

/**
 * Tables carrying an audit trigger in production. Taken from the triggers in
 * `20250101000800_staff_and_audit.sql`, so the Activity screen in the demo
 * lists exactly what it would list against Postgres — no more, no less.
 */
const AUDITED = new Set([
  'brokers',
  'businesses',
  'clients',
  'consignments',
  'credit_debit_notes',
  'driver_advances',
  'driver_salary_payments',
  'drivers',
  'expenses',
  'insurance_claims',
  'invites',
  'invoices',
  'opening_balances',
  'payments',
  'service_schedules',
  'trips',
  'users',
  'vehicle_maintenance_log',
  'vehicles',
])

/**
 * What `record_audit()` writes: the whole row for an insert or a delete, and
 * from/to pairs for the columns an update actually changed. `updated_at` moves
 * on every write by definition, so it is not a change, and an update that
 * changed nothing earns no entry.
 */
function audit(
  table: string,
  action: 'insert' | 'update' | 'delete',
  row: Row,
  before?: Row,
) {
  if (!AUDITED.has(table)) return

  let diff: Row = row
  if (action === 'update' && before) {
    diff = {}
    for (const key of Object.keys(row)) {
      if (key === 'updated_at') continue
      if (JSON.stringify(row[key]) === JSON.stringify(before[key])) continue
      diff[key] = { from: before[key] ?? null, to: row[key] ?? null }
    }
    if (Object.keys(diff).length === 0) return
  }

  db.audit_log = [
    ...(db.audit_log ?? []),
    {
      id: uuid(),
      business_id: BUSINESS_ID,
      user_id: currentDemoUserId(),
      table_name: table,
      record_id: row.id ?? null,
      action,
      changed_at: new Date().toISOString(),
      diff,
    },
  ]
}

function insert(table: string, body: unknown): Row[] {
  const rows = (Array.isArray(body) ? body : [body]) as Row[]
  const created = rows.map((row) => ({
    id: row.id ?? uuid(),
    ...stampNow(),
    ...row,
  }))
  db[table] = [...(db[table] ?? []), ...created]
  for (const row of created) audit(table, 'insert', row)
  save(db)
  return created
}

function update(table: string, params: URLSearchParams, body: Row): Row[] {
  const query = parseQuery(params)
  const touched: Row[] = []
  db[table] = (db[table] ?? []).map((row) => {
    if (!query.filters.every((f) => f(row))) return row
    const next = { ...row, ...body, updated_at: new Date().toISOString() }
    touched.push(next)
    audit(table, 'update', next, row)
    return next
  })
  save(db)
  return touched
}

function remove(table: string, params: URLSearchParams): Row[] {
  const query = parseQuery(params)
  const kept: Row[] = []
  const removed: Row[] = []
  for (const row of db[table] ?? []) {
    if (query.filters.every((f) => f(row))) removed.push(row)
    else kept.push(row)
  }
  db[table] = kept
  for (const row of removed) audit(table, 'delete', row)
  save(db)
  return removed
}

// --- RPC ---------------------------------------------------------------------

function fyLabel(date: string): string {
  const d = new Date(date)
  const startMonth = 4
  const year = d.getMonth() + 1 >= startMonth ? d.getFullYear() : d.getFullYear() - 1
  return `${year}-${String((year + 1) % 100).padStart(2, '0')}`
}

function rpc(name: string, body: Row): unknown {
  switch (name) {
    case 'next_invoice_number': {
      const type = String(body.p_invoice_type ?? 'gst')
      const fy = fyLabel(String(body.p_date ?? new Date().toISOString()))
      const prefix = type === 'gst' ? 'GST' : 'NG'
      const existing = (db.invoices ?? []).filter((i) =>
        String(i.invoice_number ?? '').startsWith(`${prefix}/${fy}/`),
      )
      const next =
        existing.reduce((max, i) => {
          const n = Number(String(i.invoice_number).split('/').pop())
          return Number.isFinite(n) ? Math.max(max, n) : max
        }, 0) + 1
      return `${prefix}/${fy}/${String(next).padStart(4, '0')}`
    }

    case 'complete_service': {
      // The real `complete_service` is SECURITY DEFINER and does its own role
      // check, allowing owner and helper — so the owner-only rule on
      // vehicle_maintenance_log does not apply through this path.
      if (!['owner', 'helper'].includes(demoUser(currentDemoUserId()).role)) {
        throw new DemoError('your role cannot complete a service', '42501', 403)
      }
      const id = String(body.p_schedule_id)
      const schedule = (db.service_schedules ?? []).find((s) => s.id === id)
      if (!schedule) throw new Error('service schedule not found')
      const odo = Number(body.p_odometer)

      insert('vehicle_maintenance_log', {
        business_id: BUSINESS_ID,
        vehicle_id: schedule.vehicle_id,
        service_schedule_id: id,
        type: 'service',
        date: body.p_date,
        cost: Number(body.p_cost ?? 0),
        odometer_reading: odo,
        vendor: body.p_vendor ?? null,
        note: body.p_note ?? null,
      })

      // Written directly rather than through update(), so the audit entries
      // the triggers would write are recorded here by hand.
      db.service_schedules = (db.service_schedules ?? []).map((s) => {
        if (s.id !== id) return s
        const next = { ...s, last_done_odometer: odo, last_done_date: body.p_date }
        audit('service_schedules', 'update', next, s)
        return next
      })
      db.vehicles = (db.vehicles ?? []).map((v) => {
        if (v.id !== schedule.vehicle_id || odo <= Number(v.current_odometer)) return v
        const next = { ...v, current_odometer: odo }
        audit('vehicles', 'update', next, v)
        return next
      })
      save(db)
      return uuid()
    }

    // --- the driver's own app ------------------------------------------------
    //
    // In Postgres these are SECURITY DEFINER functions, which exist because a
    // policy cannot say "these two columns and no others". Each one starts by
    // proving the trip belongs to the caller; so does each one here.

    case 'driver_log_odometer': {
      const trip = ownTrip(String(body.p_trip_id))
      if (['closed', 'cancelled'].includes(String(trip.status))) {
        throw new DemoError('That trip is closed', '42501', 403)
      }
      const start = body.p_start == null ? trip.odometer_start : Number(body.p_start)
      const end = body.p_end == null ? trip.odometer_end : Number(body.p_end)
      if (start != null && end != null && Number(end) < Number(start)) {
        throw new DemoError('The closing reading is below the opening one', '22023', 400)
      }
      patchTrip(trip, { odometer_start: start ?? null, odometer_end: end ?? null })
      return null
    }

    case 'driver_set_trip_status': {
      const trip = ownTrip(String(body.p_trip_id))
      const next = String(body.p_status)
      if (!['in_transit', 'delivered'].includes(next)) {
        throw new DemoError(`A driver cannot set a trip to ${next}`, '42501', 403)
      }
      if (['closed', 'cancelled'].includes(String(trip.status))) {
        throw new DemoError('That trip is closed', '42501', 403)
      }
      patchTrip(trip, { status: next })
      return null
    }

    case 'driver_log_expense': {
      const trip = ownTrip(String(body.p_trip_id))
      const category = String(body.p_category)
      if (!['fuel', 'toll', 'other'].includes(category)) {
        throw new DemoError(`A driver cannot log a ${category} expense`, '42501', 403)
      }
      const amount = Number(body.p_amount)
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new DemoError('An amount is needed', '23514', 400)
      }
      const note = String(body.p_note ?? '').trim()
      if (category === 'other' && note === '') {
        throw new DemoError('Say what the expense was for', '23514', 400)
      }
      insert('expenses', {
        business_id: BUSINESS_ID,
        category,
        vehicle_id: trip.vehicle_id ?? null,
        trip_id: trip.id,
        date: body.p_date ?? new Date().toISOString().slice(0, 10),
        amount,
        payment_mode: body.p_payment_mode ?? 'cash',
        note: note === '' ? null : note,
      })
      return null
    }

    case 'driver_attach_pod': {
      const trip = ownTrip(String(body.p_trip_id))
      const path = String(body.p_file_url ?? '').trim()
      if (path === '') throw new DemoError('No file was given', '23514', 400)
      if (path.split('/')[0] !== BUSINESS_ID) {
        throw new DemoError('That file does not belong to this business', '42501', 403)
      }
      patchTrip(trip, { pod_file_url: path })
      insert('documents', {
        business_id: BUSINESS_ID,
        owner_type: 'trip',
        owner_id: trip.id,
        file_url: path,
        doc_type: 'pod',
      })
      return null
    }

    case 'bootstrap_business':
      throw new Error('This demo already has a business set up.')

    case 'claim_invite':
      throw new Error('No pending invitation for this account in the demo.')

    default:
      throw new Error(`${name} is not available in the demo`)
  }
}

// --- auth --------------------------------------------------------------------

/**
 * Who the demo can sign in as, so the role gates can actually be seen working
 * rather than described. A helper loses Reports and Settings; a CA can read
 * everything and export, but every save is refused.
 */
export const DEMO_USERS = [
  {
    id: OWNER_ID,
    name: 'Jashwanth Goud Alvala',
    role: 'owner',
    email: 'owner@balaji.demo',
  },
  {
    id: 'u0000000-0000-4000-8000-000000000002',
    name: 'Office \u2014 Sridevi',
    role: 'helper',
    email: 'office@balaji.demo',
  },
  {
    id: DRIVER_USER_ID,
    name: 'Ramesh Yadav',
    role: 'driver',
    email: 'ramesh@balaji.demo',
  },
  {
    id: 'u0000000-0000-4000-8000-000000000003',
    name: 'Rao & Associates',
    role: 'ca',
    email: 'ca@balaji.demo',
  },
] as const

function demoUser(id: string) {
  return DEMO_USERS.find((u) => u.id === id) ?? DEMO_USERS[0]
}

function authUser(id: string): Row {
  const who = demoUser(id)
  return {
    id: who.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: who.email,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { name: who.name },
    created_at: new Date().toISOString(),
  }
}

/** Reads back whoever the stored session names, falling back to the owner. */
export function currentDemoUserId(): string {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { user?: { id?: string } }
      if (parsed.user?.id) return parsed.user.id
    }
  } catch {
    /* fall through */
  }
  return OWNER_ID
}

/** A session far enough in the future that no refresh is ever attempted. */
function writeSession(userId: string): void {
  try {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        access_token: 'demo.access.token',
        token_type: 'bearer',
        expires_in: 31_536_000,
        expires_at: Math.floor(Date.now() / 1000) + 31_536_000,
        refresh_token: 'demo.refresh.token',
        user: authUser(userId),
      }),
    )
  } catch {
    /* ignore */
  }
}

function seedSession(): void {
  try {
    if (localStorage.getItem(SESSION_KEY)) return
  } catch {
    return
  }
  writeSession(OWNER_ID)
}

/**
 * Signs the demo in as someone else.
 *
 * Reloads rather than pushing the new session through the client, because role
 * changes what the navigation, the routes and the query cache all contain —
 * a fresh start is both simpler and closer to what really signing in does.
 */
export function switchDemoUser(userId: string): void {
  writeSession(userId)
  window.location.reload()
}

// --- the fetch patch ---------------------------------------------------------

function reply(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export function installDemoBackend(): void {
  db = load()
  seedSession()

  const passthrough = window.fetch.bind(window)

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase()

    // Anything that is not a Supabase call still goes to the network.
    if (
      !url.includes('/rest/v1/') &&
      !url.includes('/auth/v1/') &&
      !url.includes('/storage/v1/')
    ) {
      return passthrough(input as RequestInfo, init)
    }

    const parsed = new URL(url, window.location.origin)
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    )
    const wantsSingle = (headers.get('accept') ?? '').includes('pgrst.object')

    let body: Row = {}
    if (init?.body && typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body) as Row
      } catch {
        body = {}
      }
    }

    try {
      // --- auth -------------------------------------------------------------
      if (parsed.pathname.includes('/auth/v1/')) {
        if (parsed.pathname.endsWith('/logout')) {
          try {
            localStorage.removeItem(SESSION_KEY)
          } catch {
            /* ignore */
          }
          return reply({}, 204)
        }
        if (parsed.pathname.endsWith('/user')) {
          return reply(authUser(currentDemoUserId()))
        }
        return reply({})
      }

      // --- storage ----------------------------------------------------------
      if (parsed.pathname.includes('/storage/v1/')) {
        if (method === 'POST') return reply({ Key: 'demo/file' })
        // A signed URL for a file nobody uploaded has nothing to point at.
        return reply({ signedUrl: 'about:blank', signedURL: 'about:blank' })
      }

      // --- rpc --------------------------------------------------------------
      const rpcMatch = parsed.pathname.match(/\/rest\/v1\/rpc\/(\w+)/)
      if (rpcMatch?.[1]) {
        return reply(rpc(rpcMatch[1], body))
      }

      // --- tables and views -------------------------------------------------
      const table = parsed.pathname.split('/rest/v1/')[1]?.split('?')[0] ?? ''
      if (!table) return reply([], 404)

      if (method === 'GET') {
        const rows = runSelect(table, parsed.searchParams)
        if (wantsSingle) {
          return rows.length
            ? reply(rows[0])
            : reply(
                {
                  code: 'PGRST116',
                  message: 'JSON object requested, multiple (or no) rows returned',
                },
                406,
              )
        }
        return reply(rows)
      }

      if (method === 'POST') {
        assertCanWrite(table, method)
        const created = insert(table, body)
        const withEmbeds = applyEmbeds(
          created,
          parsed.searchParams.get('select') ?? '*',
        )
        return reply(wantsSingle ? withEmbeds[0] : withEmbeds, 201)
      }

      if (method === 'PATCH') {
        assertCanWrite(table, method)
        const touched = update(table, parsed.searchParams, body)
        const withEmbeds = applyEmbeds(
          touched,
          parsed.searchParams.get('select') ?? '*',
        )
        return reply(wantsSingle ? (withEmbeds[0] ?? null) : withEmbeds)
      }

      if (method === 'DELETE') {
        assertCanWrite(table, method)
        const removed = remove(table, parsed.searchParams)
        return reply(wantsSingle ? (removed[0] ?? null) : removed)
      }

      return reply([], 405)
    } catch (error) {
      if (error instanceof DemoError) {
        return reply(
          { code: error.code, message: error.message, details: null, hint: null },
          error.status,
        )
      }
      return reply(
        { message: error instanceof Error ? error.message : 'Demo backend error' },
        400,
      )
    }
  }
}
