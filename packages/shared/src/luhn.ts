// packages/shared/src/luhn.ts
//
// BUG-A5.0 — shared Luhn validator for Australian Healthcare Identifiers
// (HI Service: IHI, HPI-I, HPI-O — all 16-digit, prefix + Luhn).
//
// SSoT for Luhn checking across:
//   - Backend Zod schemas (apps/api validates request DTOs)
//   - Shared schemas (packages/shared — patient.schemas.ts ihi.refine())
//   - Frontend forms (defence-in-depth client-side validation)
//   - apps/api/src/shared/hiNumbers.ts (existing prefix-aware HI helper
//     should delegate to this; kept as a back-compat re-export below).
//
// Standard: HI Service policy — all three identifiers are Luhn-valid
// 16-digit strings; any deviation is a malformed submission. AHPRA
// ADHA-A5.0 requires Luhn enforcement at every write boundary
// (patientService.create / update + CSV import).

/**
 * Luhn mod-10 check on a numeric string. Accepts any length; callers
 * must separately enforce length + prefix where applicable. Returns
 * false on empty / non-numeric input.
 */
export function luhnCheck(digits: string): boolean {
  if (!digits || !/^\d+$/.test(digits)) return false;
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

/**
 * IHI prefix per HI Service policy. Individual Healthcare Identifier
 * starts with `800360`.
 */
export const IHI_PREFIX = '800360' as const;

/**
 * Validate an Individual Healthcare Identifier (IHI). Strips whitespace,
 * enforces 16-digit length + 800360 prefix + Luhn. Returns false on
 * empty / null / undefined input — callers MUST treat optional vs
 * required separately (Zod schema `.optional()` semantics).
 */
export function isValidIhi(value: string | null | undefined): boolean {
  if (value == null) return false;
  const cleaned = value.replace(/\s/g, '');
  if (!/^800360\d{10}$/.test(cleaned)) return false;
  return luhnCheck(cleaned);
}
