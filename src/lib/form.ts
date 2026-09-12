import { zodResolver } from '@hookform/resolvers/zod'
import type { FieldValues, Resolver } from 'react-hook-form'
import type { z } from 'zod'

/**
 * `zodResolver`, typed the way it actually behaves.
 *
 * At runtime it hands react-hook-form the schema's **output** — every
 * `.transform()` has already run, so `''` has become `null` and `'40'` has
 * become `40`. Its own types claim the input type instead, and trusting that
 * claim is a trap: it invites a second `schema.parse(values)` in the submit
 * handler, which feeds the output back through the input schema and throws
 * `Expected string, received null` on the first optional field it meets.
 *
 * So the real contract is stated once, here. `handleSubmit` then receives a
 * correctly typed, already-parsed value and nothing needs re-parsing.
 */
export function zodForm<Input extends FieldValues, Output extends FieldValues>(
  schema: z.ZodType<Output, z.ZodTypeDef, Input>,
): Resolver<Input, unknown, Output> {
  return zodResolver(schema) as unknown as Resolver<Input, unknown, Output>
}
