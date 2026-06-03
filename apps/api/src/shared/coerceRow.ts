// apps/api/src/shared/coerceRow.ts
//
// Knex returns Date objects for both `timestamptz` and `date` columns.
// Zod response schemas expect:
//   - timestamptz → ISO 8601 string (e.g. "2023-11-04T10:30:00.000Z")
//   - date        → YYYY-MM-DD string (e.g. "2023-11-04")
//
// This utility detects which format to use and coerces before Zod parse,
// so we keep strict runtime validation without weakening schemas.

import type { ZodType, ZodTypeDef } from 'zod';

/**
 * Detect if a Date represents a pure date vs a timestamp.
 * PostgreSQL `date` columns come back as Date objects at midnight LOCAL timezone.
 * In AU (UTC+10/+11), midnight AEST = 13:00 or 14:00 UTC the previous day.
 * We check LOCAL midnight as well as UTC midnight.
 */
function isDateOnly(d: Date): boolean {
  // UTC midnight (when DB timezone is UTC)
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0) {
    return true;
  }
  // Local midnight (when DB timezone is e.g. Australia/Melbourne)
  if (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0) {
    return true;
  }
  return false;
}

/**
 * Coerce Date values in a plain object to strings, then parse
 * through the given Zod schema. Keeps strict validation intact.
 *
 * - `date` columns → "YYYY-MM-DD"
 * - `timestamptz` columns → full ISO 8601
 */
export function parseRow<T>(obj: Record<string, unknown>, schema: ZodType<T, ZodTypeDef, unknown>): T {
  const coerced: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value instanceof Date) {
      if (isDateOnly(value)) {
        // Format as YYYY-MM-DD using local date (not UTC) to avoid timezone shift
        const y = value.getFullYear();
        const m = String(value.getMonth() + 1).padStart(2, '0');
        const d = String(value.getDate()).padStart(2, '0');
        coerced[key] = `${y}-${m}-${d}`;
      } else {
        coerced[key] = value.toISOString();
      }
    } else {
      coerced[key] = value;
    }
  }
  return schema.parse(coerced);
}
