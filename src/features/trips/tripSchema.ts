import { z } from 'zod'

const optionalText = z
  .string()
  .optional()
  .transform((value) => value?.trim() || null)

const optionalInt = z
  .string()
  .optional()
  .transform((value) => (value && value.length > 0 ? Number(value) : null))
  .refine(
    (value) => value === null || (Number.isInteger(value) && value >= 0),
    'Enter a whole number',
  )

const amount = z
  .string()
  .optional()
  .transform((value) => (value && value.length > 0 ? Number(value) : 0))
  .refine((value) => !Number.isNaN(value) && value >= 0, 'Enter a valid amount')

export const tripSchema = z
  .object({
    trip_date: z.string().min(1, 'Trip date is required'),
    vehicle_id: z
      .string()
      .optional()
      .transform((value) => (value && value.length > 0 ? value : null)),
    driver_id: z
      .string()
      .optional()
      .transform((value) => (value && value.length > 0 ? value : null)),
    party_type: z.enum(['client', 'broker']),
    party_id: z.string().min(1, 'Select a client or broker'),
    pickup: z.string().min(1, 'Pickup is required').transform((value) => value.trim()),
    drop_location: z.string().min(1, 'Drop is required').transform((value) => value.trim()),
    goods_description: optionalText,
    odometer_start: optionalInt,
    odometer_end: optionalInt,
    freight_amount: amount,
    broker_commission: amount,
    advance_received: amount,
    bill_type: z.enum(['gst', 'non_gst']),
    lr_number: optionalText,
    eway_bill_no: optionalText,
    tds_deducted: amount,
    status: z.enum([
      'booked',
      'in_transit',
      'delivered',
      'payment_pending',
      'closed',
      'cancelled',
    ]),
    notes: optionalText,
  })
  // Mirrors the trips_odometer_order CHECK constraint, so the mistake is caught
  // in the form rather than coming back as a Postgres error.
  .refine(
    (values) =>
      values.odometer_start === null ||
      values.odometer_end === null ||
      values.odometer_end >= values.odometer_start,
    { message: 'Closing reading cannot be lower than opening', path: ['odometer_end'] },
  )
  .refine((values) => values.advance_received <= values.freight_amount, {
    message: 'Advance cannot exceed the freight amount',
    path: ['advance_received'],
  })

export type TripFormValues = z.input<typeof tripSchema>
export type TripFormOutput = z.output<typeof tripSchema>

/** What is still owed on a trip once advance and TDS are accounted for. */
export function balanceDue(trip: {
  freight_amount: number
  advance_received: number
  tds_deducted: number
}): number {
  return trip.freight_amount - trip.advance_received - trip.tds_deducted
}

/** Distance covered, when both odometer readings are recorded. */
export function tripDistance(trip: {
  odometer_start: number | null
  odometer_end: number | null
}): number | null {
  if (trip.odometer_start === null || trip.odometer_end === null) return null
  return trip.odometer_end - trip.odometer_start
}
