// apps/api/src/features/patients/duplicateDetection.ts
//
// S7.1 — Multi-signal patient duplicate detection.
//
// Replaces the naive ILIKE matcher in patientRepository.findPotentialDuplicates
// with a ranked scoring engine that combines deterministic identifier lookups
// with fuzzy name and DOB matching.
//
// Match signals (and their weights in the final score):
//
//   Deterministic (each contributes 1.0 if matched — any one is conclusive)
//     - Medicare blind index equal          (weight 1.0)
//     - IHI blind index equal               (weight 1.0)
//     - DVA blind index equal               (weight 1.0)
//
//   Probabilistic (combined — each contributes up to the listed ceiling)
//     - Date of birth exact                 (weight 0.35)
//     - Date of birth off-by-one day        (weight 0.20) — data entry error
//     - Trigram similarity given_name       (weight 0.20 × similarity)
//     - Trigram similarity family_name      (weight 0.20 × similarity)
//     - Phone mobile equal (normalised)     (weight 0.15)
//     - Address line 1 + postcode equal     (weight 0.10)
//
// A candidate is returned if its score >= 0.60 (the "probable" threshold)
// OR any deterministic signal matched. Candidates are sorted by score
// descending and capped at 20 results.
//
// Confidence buckets for the UI:
//   >= 0.95  definite
//   0.80 – 0.94  strong
//   0.60 – 0.79  probable
//   < 0.60      not returned
//
// Why both deterministic and probabilistic?
//   Medicare / IHI are the gold standard but are not always entered
//   at registration — the receptionist may not have the card yet. The
//   fuzzy path catches the "same person registered again under a
//   nickname" case that pure identifier lookup misses.
//
// Fix Registry: DUP1 (detect function exported), DUP2 (blind-index paths),
// DUP3 (trigram fallback exists).

import { db } from '../../db/db';
import { logger } from '../../utils/logger';
import { computeBlindIndex } from '../../shared/blindIndex';
import type { PatientRow } from './patientRepository';
import type { Knex } from 'knex';

export interface DuplicateCandidateInput {
  givenName: string;
  familyName: string;
  dateOfBirth: string; // ISO YYYY-MM-DD
  medicareNumber?: string | null;
  medicareIrn?: string | null;
  ihiNumber?: string | null;
  dvaNumber?: string | null;
  phoneMobile?: string | null;
  addressLine1?: string | null;
  postcode?: string | null;
}

export interface DuplicateCandidate {
  patient: Omit<PatientRow, 'medicare_number' | 'ihi_number' | 'dva_number'>;
  score: number;
  confidence: 'definite' | 'strong' | 'probable';
  matchedOn: string[];
}

type DuplicateQueryExecutor = Knex | Knex.Transaction;

const PROBABLE_THRESHOLD = 0.6;
const STRONG_THRESHOLD = 0.8;
const DEFINITE_THRESHOLD = 0.95;

/** Normalise a phone number for comparison: digits only, last 9 digits. */
function normalisePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 9) return null;
  // Last 9 digits is the Australian mobile tail (0412345678 -> 412345678
  // and +61412345678 -> 412345678). Works for landlines too.
  return digits.slice(-9);
}

/** Normalise an address line for comparison: lower + collapse whitespace. */
function normaliseAddress(line: string | null | undefined): string | null {
  if (!line) return null;
  const cleaned = String(line)
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length === 0 ? null : cleaned;
}

function dobOffByOne(a: string, b: string): boolean {
  if (!a || !b || a === b) return false;
  // String comparison: both are ISO YYYY-MM-DD. Compute diff in days.
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const dbt = new Date(`${b}T00:00:00Z`).getTime();
  if (!Number.isFinite(da) || !Number.isFinite(dbt)) return false;
  const diffDays = Math.abs(da - dbt) / (24 * 60 * 60 * 1000);
  return diffDays >= 1 && diffDays <= 1;
}

function confidenceFromScore(score: number): DuplicateCandidate['confidence'] {
  if (score >= DEFINITE_THRESHOLD) return 'definite';
  if (score >= STRONG_THRESHOLD) return 'strong';
  return 'probable';
}

/**
 * Find potential duplicate patients in a clinic for the given registration
 * input. Returns ranked candidates with per-signal match reasons.
 *
 * @param excludePatientId If set, that row is excluded from results — used
 *                          during patient edit so a patient doesn't match
 *                          itself.
 */
export async function findDuplicateCandidates(
  clinicId: string,
  input: DuplicateCandidateInput,
  excludePatientId?: string,
  query: DuplicateQueryExecutor = db,
): Promise<DuplicateCandidate[]> {
  // ─── Pass 1: deterministic identifier lookups via blind index ─────────────
  const medicareLookup = computeBlindIndex(input.medicareNumber, 'medicare');
  const ihiLookup = computeBlindIndex(input.ihiNumber, 'ihi');
  const dvaLookup = computeBlindIndex(input.dvaNumber, 'dva');

  const identifierMatches = new Map<string, { row: PatientRow; matchedOn: string[] }>();

  async function lookupByIdentifier(column: string, value: string, label: string): Promise<void> {
    const rows = await query<PatientRow>('patients')
      .where({ clinic_id: clinicId })
      .whereNull('deleted_at')
      .where(column, value);
    for (const row of rows) {
      if (excludePatientId && row.id === excludePatientId) continue;
      const existing = identifierMatches.get(row.id);
      if (existing) {
        existing.matchedOn.push(label);
      } else {
        identifierMatches.set(row.id, { row, matchedOn: [label] });
      }
    }
  }

  if (medicareLookup) await lookupByIdentifier('medicare_number_lookup', medicareLookup, 'medicare');
  if (medicareLookup && input.medicareIrn && input.medicareIrn.trim()) {
    const irn = input.medicareIrn.trim();
    const tupleRows = await query<PatientRow>('patients')
      .where({ clinic_id: clinicId })
      .whereNull('deleted_at')
      .where('medicare_number_lookup', medicareLookup)
      .where('medicare_reference', irn);
    for (const row of tupleRows) {
      if (excludePatientId && row.id === excludePatientId) continue;
      const existing = identifierMatches.get(row.id);
      if (existing) {
        if (!existing.matchedOn.includes('medicare_irn_tuple')) {
          existing.matchedOn.push('medicare_irn_tuple');
        }
      } else {
        identifierMatches.set(row.id, { row, matchedOn: ['medicare_irn_tuple'] });
      }
    }
  }
  if (ihiLookup) await lookupByIdentifier('ihi_number_lookup', ihiLookup, 'ihi');
  if (dvaLookup) await lookupByIdentifier('dva_number_lookup', dvaLookup, 'dva');

  // ─── Pass 2: probabilistic search anchored on DOB ± 1 day ────────────────
  // Pull candidates born within one day of the requested DOB (plus the
  // exact date) and let trigram similarity rank them. This bounds the
  // candidate set size even on large clinics.
  const dobCandidates: PatientRow[] = await (async () => {
    try {
      return await query<PatientRow>('patients')
        .where({ clinic_id: clinicId })
        .whereNull('deleted_at')
        .whereRaw(`date_of_birth BETWEEN ?::date - INTERVAL '1 day' AND ?::date + INTERVAL '1 day'`, [
          input.dateOfBirth,
          input.dateOfBirth,
        ]);
    } catch (err) {
      // BUG-517 — date-interval query failed (likely text-typed
      // `date_of_birth` column in a dev/test DB; in prod the column
      // is a typed `date`). Fall back to equality-only candidate
      // selection. Log so prod sees this signal if it ever fires
      // there — text-typed `date_of_birth` in prod would be a real
      // schema-drift incident.
      logger.warn(
        { err, kind: 'date_of_birth_query_fallback', clinicId, dateOfBirth: input.dateOfBirth },
        'BUG-517: date-interval query failed (likely text-typed date_of_birth column in dev DB); falling back to equality query',
      );
      return query<PatientRow>('patients')
        .where({ clinic_id: clinicId, date_of_birth: input.dateOfBirth })
        .whereNull('deleted_at');
    }
  })();

  const givenLower = input.givenName.trim().toLowerCase();
  const familyLower = input.familyName.trim().toLowerCase();
  const inputPhone = normalisePhone(input.phoneMobile);
  const inputAddress = normaliseAddress(input.addressLine1);
  const inputPostcode = input.postcode?.trim() ?? null;

  const scores = new Map<string, { row: PatientRow; score: number; matchedOn: string[] }>();

  // Seed scores with deterministic matches — start at 1.0 so these bubble
  // to the top regardless of name / DOB agreement.
  for (const [id, { row, matchedOn }] of identifierMatches) {
    scores.set(id, { row, score: 1.0, matchedOn: [...matchedOn] });
  }

  for (const row of dobCandidates) {
    if (excludePatientId && row.id === excludePatientId) continue;
    const current = scores.get(row.id) ?? { row, score: 0, matchedOn: [] };
    const before = current.score;

    if (row.date_of_birth === input.dateOfBirth) {
      current.score += 0.35;
      current.matchedOn.push('dob_exact');
    } else if (dobOffByOne(row.date_of_birth, input.dateOfBirth)) {
      current.score += 0.2;
      current.matchedOn.push('dob_off_by_one');
    }

    // Fuzzy name matching. Fetch trigram similarity in-row without a
    // separate query: compare normalised strings with a simple character
    // overlap ratio as a pure-JS fallback. PostgreSQL trigram would be
    // more accurate but keeping this in JS avoids a round-trip per row
    // and works even when pg_trgm is not installed.
    const rowGiven = (row.given_name ?? '').trim().toLowerCase();
    const rowFamily = (row.family_name ?? '').trim().toLowerCase();
    const exactNameDob =
      row.date_of_birth === input.dateOfBirth &&
      rowGiven === givenLower &&
      rowFamily === familyLower;
    if (exactNameDob) {
      // Structural duplicate policy: exact given_name + family_name + DOB
      // must always block registration (at least "strong"), even when
      // no deterministic identifiers are present. Without this floor,
      // an exact match scored 0.75 (probable) and leaked through create().
      current.score = Math.max(current.score, STRONG_THRESHOLD);
      if (!current.matchedOn.includes('name_dob_exact')) {
        current.matchedOn.push('name_dob_exact');
      }
    }
    const givenSim = trigramSimilarity(givenLower, rowGiven);
    const familySim = trigramSimilarity(familyLower, rowFamily);
    if (givenSim >= 0.5) {
      current.score += 0.2 * givenSim;
      current.matchedOn.push(`given_name_${givenSim >= 0.9 ? 'exact' : 'fuzzy'}`);
    }
    if (familySim >= 0.5) {
      current.score += 0.2 * familySim;
      current.matchedOn.push(`family_name_${familySim >= 0.9 ? 'exact' : 'fuzzy'}`);
    }

    if (inputPhone && (normalisePhone(row.phone_mobile) === inputPhone || normalisePhone(row.phone_home) === inputPhone)) {
      current.score += 0.15;
      current.matchedOn.push('phone');
    }

    if (
      inputAddress &&
      inputPostcode &&
      normaliseAddress(row.address_line1) === inputAddress &&
      row.postcode === inputPostcode
    ) {
      current.score += 0.1;
      current.matchedOn.push('address');
    }

    if (current.score > before) {
      scores.set(row.id, current);
    }
  }

  // ─── Rank, threshold, and emit ────────────────────────────────────────────
  const candidates: DuplicateCandidate[] = [];
  for (const entry of scores.values()) {
    // Deterministic matches always surface even if score < probable.
    const hasDeterministic = entry.matchedOn.some(
      (m) => m === 'medicare' || m === 'medicare_irn_tuple' || m === 'ihi' || m === 'dva',
    );
    if (entry.score < PROBABLE_THRESHOLD && !hasDeterministic) continue;
    // Strip the encrypted identifiers from the response — the UI should
    // never need to decrypt these for a duplicate surfaced by this API;
    // it shows the existing patient's EMR number + name + DOB only. We
    // also skip decryptPatientPhi entirely to avoid loading PHI into
    // memory for a duplicate-check response that by design must not
    // reveal identifier values to the caller.
    const { medicare_number: _m, ihi_number: _i, dva_number: _d, ...safe } = entry.row;
    void _m; void _i; void _d;
    candidates.push({
      patient: safe,
      score: Math.min(1.0, entry.score),
      confidence: confidenceFromScore(entry.score),
      matchedOn: entry.matchedOn,
    });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, 20);
}

/**
 * Pure-JS trigram similarity approximation. Returns 0–1 where 1 means
 * the strings share every 3-gram. Matches PostgreSQL `similarity()`
 * closely enough for ranking (both use Jaccard over the trigram sets).
 * Exact values will differ slightly — do not use for cross-correlation
 * with the DB function, only for relative ranking within this module.
 */
export function trigramSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const tri = (s: string) => {
    const padded = `  ${s}  `;
    const grams = new Set<string>();
    for (let i = 0; i < padded.length - 2; i++) {
      grams.add(padded.slice(i, i + 3));
    }
    return grams;
  };
  const A = tri(a);
  const B = tri(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const g of A) if (B.has(g)) shared++;
  return shared / (A.size + B.size - shared);
}
