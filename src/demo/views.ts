/**
 * The Postgres views, reimplemented for the demo build.
 *
 * Deliberately derived from the same base rows the real views read, with the
 * same rules — a trip contributes either its invoice total or its unbilled
 * freight but never both; cancelled invoices drop out; net profit counts a
 * salary run and excludes the salary expense head. So adding a trip in the
 * demo moves the dashboard, the ledger and the P&L consistently, and what is
 * shown is arithmetically true rather than decorative.
 */

import type { Row, Tables } from './seed'

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0) || 0)
const str = (v: unknown): string => (v == null ? '' : String(v))
const monthOf = (date: unknown): string => `${str(date).slice(0, 7)}-01`
const today = () => new Date().toISOString().slice(0, 10)
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000)

function sum(rows: Row[], key: string): number {
  return rows.reduce((t, r) => t + num(r[key]), 0)
}

/** Trips that have a live invoice; used to avoid double-counting freight. */
function invoicedTripIds(t: Tables): Set<string> {
  return new Set(
    (t.invoices ?? [])
      .filter((i) => i.status !== 'cancelled' && i.trip_id)
      .map((i) => str(i.trip_id)),
  )
}

const liveTrips = (t: Tables) => (t.trips ?? []).filter((x) => x.status !== 'cancelled')
const liveInvoices = (t: Tables) =>
  (t.invoices ?? []).filter((x) => x.status !== 'cancelled')

// --- trip_financials ---------------------------------------------------------

export function tripFinancials(t: Tables): Row[] {
  const byTrip = new Map<string, number>()
  for (const e of t.expenses ?? []) {
    if (!e.trip_id) continue
    byTrip.set(str(e.trip_id), (byTrip.get(str(e.trip_id)) ?? 0) + num(e.amount))
  }

  return (t.trips ?? []).map((trip) => {
    const spend = byTrip.get(str(trip.id)) ?? 0
    const start = trip.odometer_start
    const end = trip.odometer_end
    return {
      trip_id: trip.id,
      business_id: trip.business_id,
      vehicle_id: trip.vehicle_id,
      driver_id: trip.driver_id,
      party_type: trip.party_type,
      party_id: trip.party_id,
      trip_date: trip.trip_date,
      status: trip.status,
      bill_type: trip.bill_type,
      freight_amount: num(trip.freight_amount),
      broker_commission: num(trip.broker_commission),
      advance_received: num(trip.advance_received),
      tds_deducted: num(trip.tds_deducted),
      trip_expenses: spend,
      distance_km: start != null && end != null ? num(end) - num(start) : null,
      net_margin: num(trip.freight_amount) - num(trip.broker_commission) - spend,
      balance_due:
        num(trip.freight_amount) - num(trip.advance_received) - num(trip.tds_deducted),
    }
  })
}

// --- ledgers -----------------------------------------------------------------

function opening(t: Tables, partyType: string, partyId: string): number {
  const row = (t.opening_balances ?? []).find(
    (o) => o.party_type === partyType && o.party_id === partyId,
  )
  return num(row?.amount)
}

export function clientLedger(t: Tables): Row[] {
  const billed = invoicedTripIds(t)

  return (t.clients ?? []).map((client) => {
    const id = str(client.id)
    const trips = liveTrips(t).filter(
      (x) => x.party_type === 'client' && x.party_id === id,
    )
    const invs = liveInvoices(t).filter(
      (i) => i.party_type === 'client' && i.party_id === id,
    )
    const notes = (t.credit_debit_notes ?? []).filter(
      (n) => n.party_type === 'client' && n.party_id === id,
    )
    const receipts = (t.payments ?? []).filter(
      (p) => p.party_type === 'client' && p.party_id === id && p.direction === 'in',
    )

    const unbilled = trips
      .filter((x) => !billed.has(str(x.id)))
      .reduce((s, x) => s + num(x.freight_amount), 0)
    const invoiced = sum(invs, 'amount')
    const debit = sum(
      notes.filter((n) => n.type === 'debit'),
      'amount',
    )
    const credit = sum(
      notes.filter((n) => n.type === 'credit'),
      'amount',
    )
    const advances = sum(trips, 'advance_received')
    const tds = sum(trips, 'tds_deducted')
    const received = sum(receipts, 'amount')
    const open = opening(t, 'client', id)

    return {
      business_id: client.business_id,
      client_id: id,
      client_name: client.name,
      credit_limit: client.credit_limit,
      credit_period_days: client.credit_period_days,
      opening_balance: open,
      invoiced,
      unbilled_freight: unbilled,
      debit_notes: debit,
      credit_notes: credit,
      advances_received: advances,
      tds_deducted: tds,
      receipts: received,
      trip_count: trips.length,
      invoice_count: invs.length,
      balance: open + invoiced + unbilled + debit - credit - advances - tds - received,
    }
  })
}

export function brokerLedger(t: Tables): Row[] {
  const billed = invoicedTripIds(t)

  return (t.brokers ?? []).map((broker) => {
    const id = str(broker.id)
    const trips = liveTrips(t).filter(
      (x) => x.party_type === 'broker' && x.party_id === id,
    )
    const invs = liveInvoices(t).filter(
      (i) => i.party_type === 'broker' && i.party_id === id,
    )
    const notes = (t.credit_debit_notes ?? []).filter(
      (n) => n.party_type === 'broker' && n.party_id === id,
    )
    const money = (t.payments ?? []).filter(
      (p) => p.party_type === 'broker' && p.party_id === id,
    )

    const unbilled = trips
      .filter((x) => !billed.has(str(x.id)))
      .reduce((s, x) => s + num(x.freight_amount), 0)
    const invoiced = sum(invs, 'amount')
    const debit = sum(
      notes.filter((n) => n.type === 'debit'),
      'amount',
    )
    const credit = sum(
      notes.filter((n) => n.type === 'credit'),
      'amount',
    )
    const advances = sum(trips, 'advance_received')
    const tds = sum(trips, 'tds_deducted')
    const receipts = sum(
      money.filter((p) => p.direction === 'in'),
      'amount',
    )
    const paidOut = sum(
      money.filter((p) => p.direction === 'out'),
      'amount',
    )
    const earned = sum(trips, 'broker_commission')
    const open = opening(t, 'broker', id)

    const freightReceivable =
      open + invoiced + unbilled + debit - credit - advances - tds - receipts
    const payable = earned - paidOut

    return {
      business_id: broker.business_id,
      broker_id: id,
      broker_name: broker.name,
      commission_type: broker.commission_type,
      commission_rate: broker.commission_rate,
      opening_balance: open,
      invoiced,
      unbilled_freight: unbilled,
      advances_received: advances,
      tds_deducted: tds,
      receipts,
      debit_notes: debit,
      credit_notes: credit,
      trip_count: trips.length,
      freight_receivable: freightReceivable,
      commission_earned: earned,
      commission_paid: paidOut,
      commission_payable: payable,
      net_balance: freightReceivable - payable,
    }
  })
}

export function driverLedger(t: Tables): Row[] {
  return (t.drivers ?? []).map((driver) => {
    const id = str(driver.id)
    const advances = (t.driver_advances ?? []).filter((a) => a.driver_id === id)
    const salaries = (t.driver_salary_payments ?? []).filter((s) => s.driver_id === id)
    const trips = liveTrips(t).filter((x) => x.driver_id === id)

    // What the driver earned, and what is still to hand over. The two differ
    // by any advance a salary run recovered — see 20250101000900_driver_cost.
    const earned = sum(salaries, 'salary_earned')
    const paid = sum(salaries, 'amount_paid')
    const due = sum(salaries, 'net_payable') - paid
    const open = opening(t, 'driver', id)

    return {
      business_id: driver.business_id,
      driver_id: id,
      driver_name: driver.name,
      salary_type: driver.salary_type,
      fixed_salary_amount: driver.fixed_salary_amount,
      opening_balance: open,
      advances_outstanding: sum(
        advances.filter((a) => !a.adjusted),
        'amount',
      ),
      advances_total: sum(advances, 'amount'),
      salary_earned: earned,
      salary_paid: paid,
      salary_due: due,
      trip_count: trips.length,
      net_payable: due - open,
    }
  })
}

// --- reports -----------------------------------------------------------------

const EXPENSE_HEADS: Record<string, string[]> = {
  fuel: ['fuel'],
  toll: ['toll'],
  maintenance: ['maintenance', 'tyre', 'repair'],
  driver_batta: ['driver_batta'],
  compliance: ['insurance', 'permit'],
  loan_emi: ['loan_emi'],
  office: ['office'],
  salary_expense: ['salary'],
}

export function monthlyPl(t: Tables): Row[] {
  const months = new Set<string>()
  for (const x of liveTrips(t)) months.add(monthOf(x.trip_date))
  for (const e of t.expenses ?? []) months.add(monthOf(e.date))
  for (const s of t.driver_salary_payments ?? []) months.add(monthOf(s.period_month))
  for (const i of liveInvoices(t)) months.add(monthOf(i.invoice_date))

  const businessId = str((t.businesses ?? [])[0]?.id)

  return [...months].sort().map((month) => {
    const trips = liveTrips(t).filter((x) => monthOf(x.trip_date) === month)
    const exps = (t.expenses ?? []).filter((e) => monthOf(e.date) === month)
    const sal = (t.driver_salary_payments ?? []).filter(
      (s) => monthOf(s.period_month) === month,
    )

    const head = (name: string) =>
      sum(
        exps.filter((e) => EXPENSE_HEADS[name]?.includes(str(e.category))),
        'amount',
      )
    const known = Object.values(EXPENSE_HEADS).flat()
    const other = sum(
      exps.filter((e) => !known.includes(str(e.category))),
      'amount',
    )

    const freight = sum(trips, 'freight_amount')
    const commission = sum(trips, 'broker_commission')
    const total = sum(exps, 'amount')
    const salaryExpense = head('salary_expense')
    // The cost of the work, not what was left after advances were recovered.
    const salaries = sum(sal, 'salary_earned')

    return {
      business_id: businessId,
      month,
      trip_count: trips.length,
      freight,
      broker_commission: commission,
      tds_deducted: sum(trips, 'tds_deducted'),
      distance_km: trips.reduce((s, x) => {
        const a = x.odometer_start
        const b = x.odometer_end
        return s + (a != null && b != null ? num(b) - num(a) : 0)
      }, 0),
      expenses_total: total,
      fuel: head('fuel'),
      toll: head('toll'),
      maintenance: head('maintenance'),
      driver_batta: head('driver_batta'),
      compliance: head('compliance'),
      loan_emi: head('loan_emi'),
      office: head('office'),
      salary_expense: salaryExpense,
      other_expenses: other,
      driver_salaries: salaries,
      // Salary counted once: the run is deducted, the expense head added back.
      net_profit: freight - commission - total + salaryExpense - salaries,
    }
  })
}

export function gstSummary(t: Tables): Row[] {
  const groups = new Map<string, Row[]>()
  for (const i of liveInvoices(t).filter((x) => x.invoice_type === 'gst')) {
    const key = [monthOf(i.invoice_date), i.gst_rate, i.is_rcm, i.place_of_supply].join(
      '|',
    )
    const list = groups.get(key)
    if (list) list.push(i)
    else groups.set(key, [i])
  }

  return [...groups.entries()]
    .map(([key, rows]) => {
      const [month, rate, rcm, pos] = key.split('|')
      const part = (field: string) =>
        rows.reduce((s, r) => {
          const breakup = (r.tax_breakup ?? {}) as Record<string, unknown>
          return s + num(breakup[field])
        }, 0)

      return {
        business_id: rows[0]?.business_id,
        month,
        gst_rate: Number(rate),
        is_rcm: rcm === 'true',
        place_of_supply: pos === 'null' || pos === '' ? null : pos,
        invoice_count: rows.length,
        taxable_value: sum(rows, 'taxable_value'),
        cgst: part('cgst_amount'),
        sgst: part('sgst_amount'),
        igst: part('igst_amount'),
        total_tax: sum(rows, 'tax_amount'),
        invoice_total: sum(rows, 'amount'),
      }
    })
    .sort((a, b) => str(a.month).localeCompare(str(b.month)))
}

export function vehicleMonthly(t: Tables): Row[] {
  const keys = new Set<string>()
  for (const x of liveTrips(t))
    if (x.vehicle_id) keys.add(`${x.vehicle_id}|${monthOf(x.trip_date)}`)
  for (const e of t.expenses ?? [])
    if (e.vehicle_id) keys.add(`${e.vehicle_id}|${monthOf(e.date)}`)

  const round2 = (n: number) => Math.round(n * 100) / 100

  return [...keys].map((key) => {
    const [vehicleId, month] = key.split('|')
    const vehicle = (t.vehicles ?? []).find((v) => str(v.id) === vehicleId)
    const trips = liveTrips(t).filter(
      (x) => str(x.vehicle_id) === vehicleId && monthOf(x.trip_date) === month,
    )
    const exps = (t.expenses ?? []).filter(
      (e) => str(e.vehicle_id) === vehicleId && monthOf(e.date) === month,
    )

    const distance = trips.reduce((s, x) => {
      const a = x.odometer_start
      const b = x.odometer_end
      return s + (a != null && b != null ? num(b) - num(a) : 0)
    }, 0)
    const freight = sum(trips, 'freight_amount')
    const commission = sum(trips, 'broker_commission')
    const spend = sum(exps, 'amount')

    return {
      business_id: vehicle?.business_id,
      vehicle_id: vehicleId,
      reg_no: vehicle?.reg_no ?? '',
      month,
      trip_count: trips.length,
      freight,
      broker_commission: commission,
      distance_km: distance,
      expenses: spend,
      fuel: sum(
        exps.filter((e) => e.category === 'fuel'),
        'amount',
      ),
      margin: freight - commission - spend,
      cost_per_km: distance > 0 ? round2(spend / distance) : null,
      revenue_per_km: distance > 0 ? round2(freight / distance) : null,
    }
  })
}

export function complianceGaps(t: Tables): Row[] {
  const billed = invoicedTripIds(t)
  const blank = (v: unknown) => v == null || str(v).trim() === ''

  return liveTrips(t)
    .map((trip) => {
      const missingLr = blank(trip.lr_number)
      const missingEway = trip.bill_type === 'gst' && blank(trip.eway_bill_no)
      const missingPod = trip.pod_file_url == null
      const notInvoiced = !billed.has(str(trip.id))
      return {
        business_id: trip.business_id,
        trip_id: trip.id,
        trip_date: trip.trip_date,
        pickup: trip.pickup,
        drop_location: trip.drop_location,
        freight_amount: num(trip.freight_amount),
        bill_type: trip.bill_type,
        lr_number: trip.lr_number,
        eway_bill_no: trip.eway_bill_no,
        pod_file_url: trip.pod_file_url,
        status: trip.status,
        missing_lr: missingLr,
        missing_eway: missingEway,
        missing_pod: missingPod,
        not_invoiced: notInvoiced,
        _any: missingLr || missingEway || missingPod || notInvoiced,
      }
    })
    .filter((r) => r._any)
    .map(({ _any, ...rest }) => rest)
}

// --- asset care, distribution, audit ----------------------------------------

export function serviceDue(t: Tables): Row[] {
  const now = today()
  const out: Row[] = []

  for (const s of t.service_schedules ?? []) {
    if (!s.active) continue
    {
      const vehicle = (t.vehicles ?? []).find((v) => v.id === s.vehicle_id)
      // A sold truck has no schedule worth showing.
      if (!vehicle || vehicle.status === 'sold') continue

      const odo = num(vehicle.current_odometer)
      const dueAtOdo =
        s.interval_km != null && s.last_done_odometer != null
          ? num(s.last_done_odometer) + num(s.interval_km)
          : null
      const dueOn =
        s.interval_days != null && s.last_done_date != null
          ? new Date(
              Date.parse(str(s.last_done_date)) + num(s.interval_days) * 86_400_000,
            )
              .toISOString()
              .slice(0, 10)
          : null

      const kmLeft = dueAtOdo != null ? dueAtOdo - odo : null
      const daysLeft = dueOn != null ? daysBetween(dueOn, now) : null

      let status: string
      if ((dueAtOdo != null && odo >= dueAtOdo) || (dueOn != null && now >= dueOn)) {
        status = 'overdue'
      } else if (
        (kmLeft != null && kmLeft <= 1000) ||
        (daysLeft != null && daysLeft <= 15)
      ) {
        status = 'due_soon'
      } else if (dueAtOdo == null && dueOn == null) {
        status = 'not_started'
      } else {
        status = 'ok'
      }

      out.push({
        id: s.id,
        business_id: s.business_id,
        vehicle_id: s.vehicle_id,
        reg_no: vehicle.reg_no,
        current_odometer: odo,
        service_type: s.service_type,
        interval_km: s.interval_km,
        interval_days: s.interval_days,
        last_done_odometer: s.last_done_odometer,
        last_done_date: s.last_done_date,
        note: s.note,
        due_at_odometer: dueAtOdo,
        due_on_date: dueOn,
        km_remaining: kmLeft,
        days_remaining: daysLeft,
        status,
      })
    }
  }

  return out
}

export function consignmentProgress(t: Tables): Row[] {
  return (t.consignments ?? []).map((c) => {
    const trips = liveTrips(t).filter((x) => x.consignment_id === c.id)
    const dispatched = sum(trips, 'planned_quantity')
    const total = c.total_quantity == null ? null : num(c.total_quantity)

    return {
      ...c,
      trip_count: trips.length,
      dispatched_quantity: dispatched,
      pending_quantity:
        total == null || total === 0 ? null : Math.max(total - dispatched, 0),
      freight_total: sum(trips, 'freight_amount'),
      delivered_count: trips.filter((x) =>
        ['delivered', 'payment_pending', 'closed'].includes(str(x.status)),
      ).length,
    }
  })
}

export function vehicleUtilisation(t: Tables): Row[] {
  const groups = new Map<string, Row[]>()
  for (const x of liveTrips(t)) {
    if (!x.vehicle_id) continue
    const key = `${x.vehicle_id}|${x.trip_date}`
    const list = groups.get(key)
    if (list) list.push(x)
    else groups.set(key, [x])
  }

  return [...groups.entries()].map(([key, rows]) => {
    const [vehicleId, date] = key.split('|')
    return {
      business_id: rows[0]?.business_id,
      vehicle_id: vehicleId,
      trip_date: date,
      trip_count: rows.length,
      freight_total: sum(rows, 'freight_amount'),
      has_open_trip: rows.some((x) => ['booked', 'in_transit'].includes(str(x.status))),
      routes: rows.map((x) => `${x.pickup} > ${x.drop_location}`).join(' | '),
    }
  })
}

export function auditFeed(t: Tables): Row[] {
  return (t.audit_log ?? [])
    .map((a): Row => {
      const user = (t.users ?? []).find((u) => u.id === a.user_id)
      return {
        ...a,
        user_name: user?.name ?? null,
        user_role: user?.role ?? null,
      }
    })
    .sort((a, b) => str(b.changed_at).localeCompare(str(a.changed_at)))
}

/** Views are computed on read, so a write to a base table moves all of them. */

// --- the driver's own app ----------------------------------------------------
//
// In Postgres these are SECURITY DEFINER views whose where clause filters on
// the signed-in driver. Here the same filter is applied explicitly, and the
// same columns are absent: no freight, no commission, no other driver.

function myTrips(t: Tables, driverId: string): Row[] {
  const vehicles = new Map((t.vehicles ?? []).map((v) => [str(v.id), v]))
  const clients = new Map((t.clients ?? []).map((c) => [str(c.id), c]))
  const brokers = new Map((t.brokers ?? []).map((b) => [str(b.id), b]))

  return (t.trips ?? [])
    .filter((trip) => str(trip.driver_id) === driverId && trip.status !== 'cancelled')
    .map((trip) => {
      const vehicle = vehicles.get(str(trip.vehicle_id))
      const party =
        trip.party_type === 'client'
          ? clients.get(str(trip.party_id))
          : brokers.get(str(trip.party_id))

      return {
        id: trip.id,
        trip_date: trip.trip_date,
        status: trip.status,
        pickup: trip.pickup,
        drop_location: trip.drop_location,
        goods_description: trip.goods_description ?? null,
        lr_number: trip.lr_number ?? null,
        odometer_start: trip.odometer_start ?? null,
        odometer_end: trip.odometer_end ?? null,
        pod_file_url: trip.pod_file_url ?? null,
        notes: trip.notes ?? null,
        vehicle_id: trip.vehicle_id ?? null,
        vehicle_reg_no: vehicle?.reg_no ?? null,
        vehicle_type: vehicle?.type ?? null,
        party_name: party?.name ?? null,
      }
    })
    .sort((a, b) => str(b.trip_date).localeCompare(str(a.trip_date)))
}

function myTripExpenses(t: Tables, driverId: string): Row[] {
  const mine = new Set(
    (t.trips ?? []).filter((trip) => str(trip.driver_id) === driverId).map((trip) => str(trip.id)),
  )

  return (t.expenses ?? [])
    .filter((expense) => expense.trip_id && mine.has(str(expense.trip_id)))
    .map((expense) => ({
      id: expense.id,
      trip_id: expense.trip_id,
      date: expense.date,
      category: expense.category,
      amount: expense.amount,
      payment_mode: expense.payment_mode,
      note: expense.note ?? null,
    }))
}

function myMoney(t: Tables, driverId: string): Row[] {
  const driver = (t.drivers ?? []).find((d) => str(d.id) === driverId)
  if (!driver) return []

  const advances = (t.driver_advances ?? []).filter((a) => str(a.driver_id) === driverId)
  const runs = (t.driver_salary_payments ?? []).filter((r) => str(r.driver_id) === driverId)
  const trips = (t.trips ?? []).filter(
    (trip) => str(trip.driver_id) === driverId && trip.status !== 'cancelled',
  )

  return [
    {
      driver_id: driver.id,
      driver_name: driver.name,
      salary_type: driver.salary_type,
      fixed_salary_amount: driver.fixed_salary_amount ?? null,
      advances_outstanding: sum(
        advances.filter((a) => !a.adjusted),
        'amount',
      ),
      salary_earned: sum(runs, 'salary_earned'),
      salary_paid: sum(runs, 'amount_paid'),
      salary_due: sum(runs, 'net_payable') - sum(runs, 'amount_paid'),
      trip_count: trips.length,
    },
  ]
}

function myAdvances(t: Tables, driverId: string): Row[] {
  return (t.driver_advances ?? [])
    .filter((a) => str(a.driver_id) === driverId)
    .map((a) => ({
      id: a.id,
      date: a.date,
      amount: a.amount,
      reason: a.reason ?? null,
      adjusted: a.adjusted ?? false,
    }))
    .sort((a, b) => str(b.date).localeCompare(str(a.date)))
}

function mySalaryRuns(t: Tables, driverId: string): Row[] {
  return (t.driver_salary_payments ?? [])
    .filter((r) => str(r.driver_id) === driverId)
    .map((r) => ({
      id: r.id,
      period_month: r.period_month,
      salary_earned: r.salary_earned,
      advances_deducted: r.advances_deducted,
      other_deductions: r.other_deductions,
      net_payable: r.net_payable,
      amount_paid: r.amount_paid,
      paid_date: r.paid_date ?? null,
    }))
    .sort((a, b) => str(b.period_month).localeCompare(str(a.period_month)))
}

/** Keyed separately from VIEWS because each one needs to know who is asking. */
export const DRIVER_VIEWS: Record<string, (t: Tables, driverId: string) => Row[]> = {
  my_trips: myTrips,
  my_trip_expenses: myTripExpenses,
  my_money: myMoney,
  my_advances: myAdvances,
  my_salary_runs: mySalaryRuns,
}

export const VIEWS: Record<string, (t: Tables) => Row[]> = {
  trip_financials: tripFinancials,
  client_ledger: clientLedger,
  broker_ledger: brokerLedger,
  driver_ledger: driverLedger,
  monthly_pl: monthlyPl,
  gst_summary: gstSummary,
  vehicle_monthly: vehicleMonthly,
  compliance_gaps: complianceGaps,
  service_due: serviceDue,
  consignment_progress: consignmentProgress,
  vehicle_utilisation: vehicleUtilisation,
  audit_feed: auditFeed,
}
