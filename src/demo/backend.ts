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

import { buildSeed, BUSINESS_ID, OWNER_ID, type Row, type Tables } from './seed'
import { VIEWS } from './views'

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
  const source = VIEWS[table] ? VIEWS[table](db) : (db[table] ?? [])

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

function assertCanWrite(table: string, method: string): void {
  const role = demoUser(currentDemoUserId()).role
  if (role === 'owner') return

  const denied = new DemoError(
    'new row violates row-level security policy',
    '42501',
    403,
  )

  // A CA reads and exports; every write is refused.
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

function insert(table: string, body: unknown): Row[] {
  const rows = (Array.isArray(body) ? body : [body]) as Row[]
  const created = rows.map((row) => ({
    id: row.id ?? uuid(),
    ...stampNow(),
    ...row,
  }))
  db[table] = [...(db[table] ?? []), ...created]
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
      assertCanWrite('vehicle_maintenance_log', 'POST')
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

      db.service_schedules = (db.service_schedules ?? []).map((s) =>
        s.id === id
          ? { ...s, last_done_odometer: odo, last_done_date: body.p_date }
          : s,
      )
      db.vehicles = (db.vehicles ?? []).map((v) =>
        v.id === schedule.vehicle_id && odo > Number(v.current_odometer)
          ? { ...v, current_odometer: odo }
          : v,
      )
      save(db)
      return uuid()
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
