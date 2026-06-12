// apps/api/src/shared/recordingConsent.ts
//
// BUG-035 — shared recording-consent helper.
//
// Extracted to apps/api/src/shared/ (L5 review item 1) so the WebSocket
// scribe path (BUG-272) can reuse the identical contract. Inlining in
// llmRoutes.ts would guarantee divergence between the REST and WebSocket
// consent checks.
//
// The helper validates that a scribe_consents row exists for the given
// (consentId, clinicId, patientId) and that its attestation is fresh
// (within SCRIBE_CONSENT_TTL_MINUTES, default 60 per L4 review — matches
// typical psychiatric session duration). Throws HttpError 403 with a
// code distinguishing "not found" from "stale" so the UI can surface
// the correct remediation.

import type { Knex } from 'knex';
import { dbAdmin, rlsStore } from '../db/db';
import { HttpError } from './errors';
import { randomUUID } from 'crypto';
import {
  publishScribeConsentRevokedCacheInvalidation,
  startScribeConsentRevokeSubscriber,
  stopScribeConsentRevokeSubscriber,
} from './scribeConsentRevokePubSub';

// L5 review item 2 — validate at module load. A malformed env
// (`SCRIBE_CONSENT_TTL_MINUTES=abc`) previously produced NaN, making
// `ageMs > NaN` always false and silently disabling the TTL. Throwing
// at import surfaces the misconfiguration before a clinical-recording
// request can slip past the gate.
const RAW_TTL = process.env.SCRIBE_CONSENT_TTL_MINUTES ?? '60';
const CONSENT_TTL_MINUTES = parseInt(RAW_TTL, 10);
if (!Number.isFinite(CONSENT_TTL_MINUTES) || CONSENT_TTL_MINUTES <= 0) {
  throw new Error(
    `[BUG-035] SCRIBE_CONSENT_TTL_MINUTES must be a positive integer, ` +
      `got '${RAW_TTL}'. A malformed value silently disables recording-consent ` +
      `TTL enforcement, which is a privacy-live violation.`,
  );
}

export { CONSENT_TTL_MINUTES };

async function withConsentDbContext<T>(
  clinicId: string,
  work: (consentDb: Knex) => Promise<T>,
): Promise<T> {
  const activeRequestTx = rlsStore.getStore();
  if (activeRequestTx) {
    return work(dbAdmin);
  }

  return dbAdmin.transaction(async (trx) => {
    await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [clinicId]);
    return work(trx as unknown as Knex);
  });
}

/**
 * BUG-315 A2-2 contract tightening:
 * ensure clinical-note inserts always carry a non-null consent_id.
 *
 * Strategy:
 * 1) If caller supplies consentId, validate it belongs to (clinic, patient)
 *    and is not revoked.
 * 2) Else reuse latest active consent for that patient/clinic when available.
 * 3) Else create a clinician-attestation consent row and return its id.
 */
export async function ensureClinicalNoteConsent(args: {
  clinicId: string;
  patientId: string;
  clinicianId?: string | null;
  consentId?: string | null;
}): Promise<string> {
  const { clinicId, patientId, clinicianId, consentId } = args;

  if (consentId) {
    const explicit = await withConsentDbContext(clinicId, (consentDb) => (
      consentDb('scribe_consents')
        .where({ id: consentId, clinic_id: clinicId, patient_id: patientId })
        .first('id', 'revoked_at')
    ));
    if (!explicit || explicit.revoked_at) {
      throw new HttpError(
        403,
        'CONSENT_REQUIRED',
        'Provided consentId is missing, cross-tenant, cross-patient, or revoked.',
      );
    }
    return explicit.id as string;
  }

  const latest = await withConsentDbContext(clinicId, (consentDb) => (
    consentDb('scribe_consents')
      .where({ clinic_id: clinicId, patient_id: patientId })
      .whereNull('revoked_at')
      .orderBy('attested_at', 'desc')
      .orderBy('created_at', 'desc')
      .first('id')
  ));
  if (latest?.id) return latest.id as string;

  const createdId = randomUUID();
  await withConsentDbContext(clinicId, async (consentDb) => {
    await consentDb('scribe_consents').insert({
      id: createdId,
      clinic_id: clinicId,
      patient_id: patientId,
      session_id: null,
      mode: 'clinician_attestation',
      patient_signature_png: null,
      clinician_attested_by_id: clinicianId ?? null,
      clinician_attestation_text:
        'Clinical note consent linkage auto-created to enforce non-null note consent reference (BUG-315).',
      attested_at: new Date(),
      created_at: new Date(),
    });
  });
  return createdId;
}

/**
 * Verify that a recording consent exists for this (consentId, clinicId,
 * patientId) triple and that its attestation is within
 * SCRIBE_CONSENT_TTL_MINUTES. Throws HttpError 403 on any failure
 * branch; returns void on success.
 *
 * Mode-agnostic by design — `clinic_settings.scribe_consent_mode` CHECK
 * constraint allows only `'patient_esignature'` or `'clinician_attestation'`;
 * both create a `scribe_consents` row; the gate therefore requires a row
 * and does not branch on mode.
 *
 * @throws HttpError 403 CONSENT_REQUIRED — row missing, cross-patient,
 *         or cross-tenant
 * @throws HttpError 403 CONSENT_EXPIRED — attested_at older than TTL
 */
export async function verifyRecordingConsent(
  clinicId: string,
  patientId: string,
  consentId: string,
): Promise<void> {
  // Use owner connection for consent-gate lookup. Running this check
  // through request-scoped RLS can become circular: the route needs a
  // consent verdict before downstream access, but RLS may hide the
  // consent row that the verdict depends on.
  //
  // Scope remains explicit and tenant-safe via the exact
  // (consentId, clinicId, patientId) triple.
  const row = await withConsentDbContext(clinicId, (consentDb) => (
    consentDb('scribe_consents')
      .where({ id: consentId, clinic_id: clinicId, patient_id: patientId })
      .first('id', 'attested_at', 'revoked_at')
  ));
  if (!row) {
    throw new HttpError(
      403,
      'CONSENT_REQUIRED',
      'Recording consent not found for this patient in this clinic. Capture one via POST /api/v1/scribe/consent before recording.',
    );
  }
  if (!row.attested_at) {
    throw new HttpError(
      403,
      'CONSENT_REQUIRED',
      'Consent record exists but has no attestation timestamp.',
    );
  }
  // BUG-274 — revocation gate. A consent that has been revoked (mid-
  // session or before session-open) MUST be treated as no-consent.
  // This gate runs at open AND at every chunk ingestion path via
  // isConsentRevoked (below).
  if (row.revoked_at) {
    throw new HttpError(
      403,
      'CONSENT_REVOKED',
      'Recording consent has been revoked. Capture a fresh consent before recording.',
    );
  }
  const ageMs = Date.now() - new Date(row.attested_at).getTime();
  if (ageMs > CONSENT_TTL_MINUTES * 60_000) {
    throw new HttpError(
      403,
      'CONSENT_EXPIRED',
      `Consent is older than ${CONSENT_TTL_MINUTES} minutes. Capture a fresh consent before recording.`,
    );
  }
}

/**
 * Async scribe jobs may legitimately finish after the initial recording
 * attestation TTL, especially for long psychiatric interviews. This check is
 * for queued job pickup/readback only: it proves the consent still belongs to
 * the same clinic/patient and has not been revoked, without re-applying the
 * capture-start TTL.
 */
export async function verifyRecordingConsentStillActive(
  clinicId: string,
  patientId: string,
  consentId: string,
): Promise<void> {
  const row = await withConsentDbContext(clinicId, (consentDb) => (
    consentDb('scribe_consents')
      .where({ id: consentId, clinic_id: clinicId, patient_id: patientId })
      .first('id', 'attested_at', 'revoked_at')
  ));
  if (!row || !row.attested_at) {
    throw new HttpError(
      403,
      'CONSENT_REQUIRED',
      'Recording consent not found for this patient in this clinic.',
    );
  }
  if (row.revoked_at) {
    throw new HttpError(
      403,
      'CONSENT_REVOKED',
      'Recording consent has been revoked. Capture a fresh consent before recording.',
    );
  }
}

// BUG-274 — per-chunk revocation check with a tiny in-process cache so
// every binary-frame arrival doesn't round-trip the DB. Cache TTL is
// capped at CACHE_TTL_MS (2000ms by default) so a mid-session revoke
// takes AT MOST ~2s to apply to an already-open WebSocket — within a
// chunk window. Cache is keyed by consentId; a revoke invalidates the
// entry explicitly (via `markConsentRevokedInCache`) so the next chunk
// sees the revoke immediately without waiting for the TTL.
//
// Uses dbAdmin for O(1) index-only scan against scribe_consents_active_idx
// (partial index on `id WHERE revoked_at IS NULL`). RLS is not required
// on this read — the query is bound to a specific consentId captured at
// session-open time, and the check is "is THIS consent still active",
// not "which consents belong to me".
const REVOKE_CACHE_TTL_MS = parseInt(
  process.env.SCRIBE_CONSENT_REVOKE_CACHE_TTL_MS ?? '2000',
  10,
);
if (!Number.isFinite(REVOKE_CACHE_TTL_MS) || REVOKE_CACHE_TTL_MS < 0) {
  throw new Error(
    `[BUG-274] SCRIBE_CONSENT_REVOKE_CACHE_TTL_MS must be a non-negative integer, got '${process.env.SCRIBE_CONSENT_REVOKE_CACHE_TTL_MS}'`,
  );
}

interface RevokeCacheEntry {
  revoked: boolean;
  checkedAt: number;
}
const revokeCache = new Map<string, RevokeCacheEntry>();

/**
 * Return true if the consent row has been revoked. Cached for
 * REVOKE_CACHE_TTL_MS to limit DB load on hot WebSocket paths.
 * Misses (consentId not found) are treated as REVOKED — the safer
 * interpretation of "row gone" is "no consent".
 */
export async function isConsentRevoked(consentId: string, clinicId: string): Promise<boolean> {
  const cached = revokeCache.get(consentId);
  if (cached && Date.now() - cached.checkedAt < REVOKE_CACHE_TTL_MS) {
    return cached.revoked;
  }
  const row = await withConsentDbContext(clinicId, (consentDb) => (
    consentDb('scribe_consents')
      .where({ id: consentId, clinic_id: clinicId })
      .first('revoked_at')
  ));
  const revoked = !row || !!row.revoked_at;
  revokeCache.set(consentId, { revoked, checkedAt: Date.now() });
  return revoked;
}

/**
 * Invalidate or force-set the cache entry for a consent. Called
 * immediately after a revoke write so the next chunk check picks up
 * the new state without waiting for the TTL.
 */
export function markConsentRevokedInCache(consentId: string): void {
  revokeCache.set(consentId, { revoked: true, checkedAt: Date.now() });
}

/**
 * BUG-329 — cross-process cache invalidation bridge.
 *
 * Starts a Redis pub/sub subscriber that pushes every revoke signal
 * into this process's in-memory revoke cache.
 */
export async function startConsentRevokeCachePubSubBridge(): Promise<void> {
  await startScribeConsentRevokeSubscriber((consentId) => {
    markConsentRevokedInCache(consentId);
  });
}

/**
 * BUG-329 — publish a revoke invalidation event so every API process
 * flips its local revoke cache immediately.
 */
export async function publishConsentRevokedCacheInvalidation(
  consentId: string,
  clinicId: string,
): Promise<void> {
  await publishScribeConsentRevokedCacheInvalidation({
    consentId,
    clinicId,
    source: 'scribe-consent-revoke-endpoint',
  });
}

/**
 * Test-only helper to clear the cache between test runs. NOT exported
 * in production use — callers in production should let the TTL expire
 * naturally.
 */
export function __clearRevokeCacheForTests(): void {
  revokeCache.clear();
}

export async function __stopConsentRevokeCachePubSubBridgeForTests(): Promise<void> {
  await stopScribeConsentRevokeSubscriber();
}
