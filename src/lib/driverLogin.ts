/**
 * How a driver signs in.
 *
 * With the phone number the business already has for them, because a driver
 * with an email address is the exception rather than the rule. Supabase Auth
 * needs an identifier it understands, and its phone sign-in means an SMS
 * provider and a cost per message — for a login the owner hands over in
 * person, that is a bill for nothing.
 *
 * So the number becomes an address in a domain that can never exist: RFC 2606
 * reserves `.invalid` precisely so that nothing routes to it. No mail is sent
 * there and none can be. The owner's side of this lives in
 * supabase/functions/create-staff/index.ts, which must build the same address
 * from the same number — there is a CI check that both files still name this
 * domain.
 */
export const DRIVER_EMAIL_DOMAIN = 'drivers.invalid'

/** Digits only: a number typed with spaces or +91 must reach the same login. */
export function normalisePhone(phone: string): string {
  return phone.replace(/\D/g, '')
}

export function driverEmail(phone: string): string {
  return `${normalisePhone(phone)}@${DRIVER_EMAIL_DOMAIN}`
}
