// apps/api/src/shared/hiNumbers.ts
//
// BUG-296 — generic validator for Australian Healthcare Identifier (HI)
// numbers. Unified after BUG-295 + BUG-296 landed three near-identical
// regex + Luhn implementations across the codebase:
//
//   IHI    (Individual Healthcare Identifier — patient)           800360
//   HPI-I  (Healthcare Provider Identifier - Individual)          800361
//   HPI-O  (Healthcare Provider Identifier - Organisation)        800362
//
// All three share the same 16-digit structure (6-digit prefix + 10
// digits) and the same Luhn checksum algorithm. Before this helper,
// hiServiceClient.ts:validateIhiFormat did the check for IHI only,
// erxRestPayloads.ts:HPIO_FORMAT (BUG-295) did format-only for HPI-O,
// and nothing validated HPI-I at all. This helper is the SSoT.
//
// CLAUDE.md §6 — fail loudly. CLAUDE.md §1.3 — defence in depth.
// Standard: HI Service policy — all three identifiers are Luhn-valid
// 16-digit strings; any deviation is a malformed submission.

export type HiPrefix = '800360' | '800361' | '800362';

export const HI_PREFIX = {
  IHI: '800360' as const,
  HPI_I: '800361' as const,
  HPI_O: '800362' as const,
};

/**
 * Validate a healthcare identifier number against its family prefix.
 *
 * - Strips whitespace first so human-typed values with spaces pass.
 * - Enforces 16-digit length + 6-digit prefix + 10-digit suffix.
 * - Runs the Luhn mod-10 check on the full 16-digit string.
 *
 * Returns true iff the identifier is structurally valid AND has a
 * valid Luhn checksum. Does NOT contact HI Service — that's a
 * separate live-lookup step (verifyIhi / verifyHpii) gated on
 * NASH mTLS (BUG-297).
 */
export function validateHiNumber(value: string | null | undefined, prefix: HiPrefix): boolean {
  if (!value) return false;
  const cleaned = value.replace(/\s/g, '');
  const re = new RegExp(`^${prefix}[0-9]{10}$`);
  if (!re.test(cleaned)) return false;
  return luhnCheck(cleaned);
}

/**
 * Standard Luhn mod-10 check. Used by all three HI-family identifiers
 * AND by every PBS prescriber number. Accepts any numeric string;
 * callers must separately enforce length + prefix.
 */
export function luhnCheck(digits: string): boolean {
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
