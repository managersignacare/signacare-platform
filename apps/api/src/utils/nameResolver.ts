/**
 * Shared Name Resolver
 *
 * Resolves UUIDs to human-readable names for teams, staff, and patients.
 * Uses in-memory caching for org units (rarely change) and per-request
 * batch loading for staff/patients.
 */

import { db } from '../db/db';
import { logger } from './logger';

// ── Org Unit (team) name cache ────────────────────────────────────────────

let _orgUnitCache: Record<string, string> | null = null;
let _orgUnitCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getOrgUnitMap(): Promise<Record<string, string>> {
  if (_orgUnitCache && Date.now() - _orgUnitCacheTime < CACHE_TTL) return _orgUnitCache;
  const rows = await db('org_units').select('id', 'name').catch((err) => { logger.warn({ err }, 'nameResolver: org_units lookup failed — falling back to UUIDs'); return []; });
  _orgUnitCache = {};
  for (const r of rows) _orgUnitCache[r.id] = r.name;
  _orgUnitCacheTime = Date.now();
  return _orgUnitCache;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve a team value — if it's a UUID, look up org unit name.
 */
export async function resolveTeamName(team: string | null | undefined): Promise<string> {
  if (!team) return 'Unassigned';
  if (!UUID_RE.test(team)) return team; // Already a name
  const map = await getOrgUnitMap();
  return map[team] ?? team;
}

/**
 * Resolve team names in an array of rows (mutates rows in place).
 * Pass the field name(s) to resolve.
 */
export async function resolveTeamNames<T extends Record<string, unknown>>(
  rows: T[],
  ...fields: string[]
): Promise<T[]> {
  const map = await getOrgUnitMap();
  for (const row of rows) {
    const r = row as Record<string, unknown>;
    for (const field of fields) {
      const val = r[field];
      if (typeof val === 'string' && UUID_RE.test(val) && map[val]) {
        r[field] = map[val];
      }
    }
  }
  return rows;
}

/**
 * Resolve staff UUID to "Given Family" name.
 */
export async function resolveStaffName(staffId: string | null | undefined): Promise<string> {
  if (!staffId) return 'Unassigned';
  if (!UUID_RE.test(staffId)) return staffId;
  const row = await db('staff').where({ id: staffId }).select('given_name', 'family_name').first().catch((err) => { logger.warn({ err: err?.message, staffId }, 'Failed to resolve staff name'); return null; });
  return row ? `${row.given_name} ${row.family_name}` : staffId;
}

/**
 * Resolve staff names in an array of rows.
 */
export async function resolveStaffNames<T extends Record<string, unknown>>(
  rows: T[],
  ...fields: string[]
): Promise<T[]> {
  // Collect all unique staff IDs
  const ids = new Set<string>();
  for (const row of rows) {
    for (const field of fields) {
      const val = row[field];
      if (typeof val === 'string' && UUID_RE.test(val)) ids.add(val);
    }
  }
  if (!ids.size) return rows;

  // Batch load
  const staffRows = await db('staff').whereIn('id', Array.from(ids)).select('id', 'given_name', 'family_name').catch((err) => { logger.warn({ err: err?.message }, 'Failed to batch-resolve staff names'); return []; });
  const map: Record<string, string> = {};
  for (const s of staffRows) map[s.id] = `${s.given_name} ${s.family_name}`;

  // Apply
  for (const row of rows) {
    const r = row as Record<string, unknown>;
    for (const field of fields) {
      const val = r[field];
      if (typeof val === 'string' && map[val]) r[field] = map[val];
    }
  }
  return rows;
}

/**
 * Resolve patient UUID to "Given Family (MRN)".
 */
export async function resolvePatientName(patientId: string | null | undefined): Promise<string> {
  if (!patientId) return 'Unknown';
  if (!UUID_RE.test(patientId)) return patientId;
  const row = await db('patients').where({ id: patientId }).select('given_name', 'family_name', 'emr_number').first().catch((err) => { logger.warn({ err: err?.message, patientId }, 'Failed to resolve patient name'); return null; });
  return row ? `${row.given_name} ${row.family_name} (${row.emr_number})` : patientId;
}
