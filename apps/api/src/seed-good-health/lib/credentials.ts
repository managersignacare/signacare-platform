import * as bcrypt from 'bcryptjs';

// Phase 0.8 credential helpers. Every seeded persona gets:
//
//   - email:    firstname.lastname@goodhealth.demo (lowercased, spaces → dots)
//   - password: a deterministic plaintext that lives ONLY in the master
//               login file at docs/demo/good-health-logins.md — never
//               persisted in the DB, never returned by any API
//   - hash:     bcrypt(password, 10) — cost 10 not 12 to keep seed
//               wall-clock under 30s for ~100 staff. The demo tenant
//               is fictional so a slightly weaker cost is the right
//               trade vs. faster reseed.
//
// Plain-text passwords follow the pattern "<Role>!<Slug>2026" so the
// operator can reset any account from the master login file by
// re-deriving the password from public data. Example:
//   CEO     → "Ceo!Whitfield2026"
//   Clinic  → "Psychiatrist!Hart2026"
//
// The '2026' suffix is the session year, not a reveal. Changing the
// year does NOT invalidate existing hashes — only regenerating the
// seed would.

const PASSWORD_YEAR = '2026';

export function buildEmail(
  givenName: string,
  familyName: string,
  clinicSlug: string,
): string {
  const given = givenName.toLowerCase().replace(/[^a-z]/g, '');
  const family = familyName.toLowerCase().replace(/[^a-z]/g, '');
  return `${given}.${family}@${clinicSlug}.goodhealth.demo`;
}

export function buildPlainPassword(
  roleLabel: string,
  familyName: string,
): string {
  // Capitalise first letter of each seed component so the resulting
  // password has a mix of upper/lower/digit/symbol and passes the
  // common "3 of 4 character classes" rule.
  const role = roleLabel[0].toUpperCase() + roleLabel.slice(1).toLowerCase();
  const family = familyName[0].toUpperCase() + familyName.slice(1).toLowerCase();
  return `${role}!${family}${PASSWORD_YEAR}`;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

// Test-only sync stub: returns a fixed non-empty string that passes
// the "looks like a bcrypt hash" shape check but never runs the real
// bcrypt. Used by unit tests so row-shape assertions don't need to
// wait for the real KDF.
export function stubHash(plain: string): string {
  return `$2b$10$stub.${plain.length.toString().padStart(3, '0')}.ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef`;
}
