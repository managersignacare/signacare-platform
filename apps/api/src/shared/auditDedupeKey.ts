export interface AuditDedupeKeyInput {
  clinicId: string;
  tableName: string;
  recordId: string;
  action: string;
  eventTimeIso: string;
  /**
   * Optional payload fingerprint.
   * - Present: distinguishes semantically different events that happen
   *   within the same 5-second bucket.
   * - Absent: preserves legacy bucket behaviour.
   */
  payloadFingerprint?: string;
}

/**
 * A2 foundation invariant:
 * every replayable audit write carries a deterministic dedupe key so a
 * timeout/reenqueue path can be made idempotent later without creating
 * duplicate append-only audit rows.
 *
 * Key design:
 * - event-time exact (millisecond precision), not coarse bucketed.
 *   This avoids collapsing legitimate back-to-back events for the same
 *   record/action pair.
 * - optional payload fingerprint to distinguish semantically different
 *   events that share the same record/action/time envelope.
 */
export function buildAuditDedupeKey(input: AuditDedupeKeyInput): string {
  const clinicId = input.clinicId.trim();
  const tableName = input.tableName.trim();
  const recordId = input.recordId.trim();
  const action = input.action.trim().toUpperCase();

  if (!clinicId) {
    throw new Error('buildAuditDedupeKey clinicId is required');
  }
  if (!tableName) {
    throw new Error('buildAuditDedupeKey tableName is required');
  }
  if (!recordId) {
    throw new Error('buildAuditDedupeKey recordId is required');
  }
  if (!action) {
    throw new Error('buildAuditDedupeKey action is required');
  }

  const eventMs = Date.parse(input.eventTimeIso);
  if (!Number.isFinite(eventMs)) {
    throw new Error('buildAuditDedupeKey eventTimeIso must be a valid ISO timestamp');
  }

  const fingerprint = input.payloadFingerprint?.trim() ?? '';
  return fingerprint
    ? `audit:${clinicId}:${tableName}:${recordId}:${action}:${eventMs}:${fingerprint}`
    : `audit:${clinicId}:${tableName}:${recordId}:${action}:${eventMs}`;
}
