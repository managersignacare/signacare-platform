/**
 * Date utilities — Australia/Melbourne timezone aware.
 *
 * Using new Date().toISOString().split('T')[0] produces a UTC date.
 * At 11pm AEST (1pm UTC), the UTC date is the NEXT day.
 * These utilities return the correct local date for AU deployments.
 */

const DEFAULT_TIMEZONE = process.env.TZ || 'Australia/Melbourne';

/**
 * Returns today's date as YYYY-MM-DD in the given timezone.
 * Pass the clinic's time_zone column value for per-org accuracy;
 * omit to use the system default.
 */
export function todayLocal(tz?: string): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: tz || DEFAULT_TIMEZONE });
  // en-CA locale returns YYYY-MM-DD format
}

/**
 * Returns the current date/time as an ISO string adjusted for the given timezone.
 */
export function nowLocalIso(tz?: string): string {
  return new Date().toLocaleString('sv-SE', { timeZone: tz || DEFAULT_TIMEZONE }).replace(' ', 'T');
}
