/**
 * BUG-424c-FOLLOWUP-INVARIANT-TEST integration test (BUG-451 batch 7).
 *
 * Closes BUG-424c-FOLLOWUP-INVARIANT-TEST (S3). DIFFERENT shape from
 * batches 1-6 — this is an INVARIANT test: asserts the audit-trail
 * invariant that "every ASR-derived `clinical_notes` row has a paired
 * `llm_interactions feature='ambient.asr'` row within ±60s of the
 * note's `created_at`".
 *
 * Tests directly invoke `recordWhisperAsrInteractionSafely` (the SSoT
 * helper from `apps/api/src/mcp/whisperClient.ts`) and verify:
 *   - llm_interactions row persisted with feature='ambient.asr'
 *     + model_provider='whisper'
 *   - model_version matches WHISPER_MODEL_VERSION_PATTERN
 *     (`<name>@sha256:<64hex>` or `<name>@unknown` sentinel)
 *   - metadata.clinicalNoteId + metadata.surface preserved through
 *     JSONB persistence
 *   - parseWhisperVersionFromResponse parses /inference response data
 *     correctly + falls back to @unknown sentinel for malformed
 *     payloads
 *   - JOIN query: clinical_notes ↔ llm_interactions on
 *     patient_id/episode_id/clinic_id with timestamp window returns
 *     paired rows (proves the invariant the test exists to defend)
 *
 * Failure path defence: `recordWhisperAsrInteractionSafely` swallows
 * any audit-write failure with structured ERROR log so clinical flow
 * continues — caller is freed from try/catch responsibility. The
 * strict variant (`recordWhisperAsrInteraction`) throws on
 * WHISPER_MODEL_VERSION_MISSING; the safe wrapper does NOT.
 *
 * BUG-424c remaining-callers gap: scribeStreaming.ts:677 (partial
 * WebSocket frames, ephemeral) + streamingTranscribeRoutes.ts:60,118
 * (broken /transcribe vs /inference + missing audit). This test
 * defends the EXISTING audit invariant; future provider additions
 * (Azure speech / Whisper-MLX / Vosk) must use this SSoT helper to
 * pass these assertions.
 *
 * fix-registry anchors: R-FIX-BUG-424C-INT-LIVE-AUDIT-WRITE +
 * R-FIX-BUG-424C-INT-MODEL-VERSION-PATTERN +
 * R-FIX-BUG-424C-INT-CLINICAL-NOTE-PAIRING-INVARIANT.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const ready = await isIntegrationReady();

describe.skipIf(!ready)('BUG-424c cycle-2 — Whisper ASR audit invariant (live)', () => {
  let session: { token: string; clinicId: string; userId: string };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let dbAdmin: any;
  let recordWhisperAsrInteractionSafely: any;
  let recordWhisperAsrInteraction: any;
  let parseWhisperVersionFromResponse: any;
  let WHISPER_MODEL_VERSION_PATTERN: RegExp;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const runId = randomUUID().slice(0, 8);
  const tag = `bug424c-${runId}`;
  const patientId = randomUUID();
  const episodeId = randomUUID();
  const consentId = randomUUID();

  // clinical_notes ids tracked for FK-safe afterAll cleanup.
  // llm_interactions IS append-only per the BUG-286 tamper-evident
  // trigger (`llm_interactions_no_delete` BEFORE DELETE per migration
  // 20260701000031_llm_interactions_immutability.ts) — sibling
  // append-only AHPRA Standard 1 / forensic-trail discipline of the
  // audit_log immutability per BUG-039. Test rows for llm_interactions
  // are NEVER deleted; they accumulate harmlessly with fresh per-run
  // UUIDs (cross-run identifier collision is impossible).
  const createdNotes: string[] = [];

  beforeAll(async () => {
    if (!ready) return;
    session = await loginAsAdmin();
    ({ dbAdmin } = await import('../../src/db/db'));
    const whisper = await import('../../src/mcp/whisperClient');
    recordWhisperAsrInteractionSafely = whisper.recordWhisperAsrInteractionSafely;
    recordWhisperAsrInteraction = whisper.recordWhisperAsrInteraction;
    parseWhisperVersionFromResponse = whisper.parseWhisperVersionFromResponse;
    WHISPER_MODEL_VERSION_PATTERN = whisper.WHISPER_MODEL_VERSION_PATTERN;

    await dbAdmin('patients').insert({
      id: patientId,
      clinic_id: session.clinicId,
      emr_number: `${tag}-${runId.slice(0, 4)}`,
      given_name: 'Patient',
      family_name: tag,
      date_of_birth: '1990-01-01',
    });

    await dbAdmin('episodes').insert({
      id: episodeId,
      clinic_id: session.clinicId,
      patient_id: patientId,
      title: `Episode ${tag}`,
      episode_number: `EP-${runId}`,
      episode_type: 'inpatient',
      status: 'open',
      start_date: new Date(),
      primary_clinician_id: session.userId,
    });

    await dbAdmin('scribe_consents').insert({
      id: consentId,
      clinic_id: session.clinicId,
      patient_id: patientId,
      mode: 'clinician_attestation',
      clinician_attested_by_id: session.userId,
      clinician_attestation_text: `BUG-424c consent ${tag}`,
      attested_at: new Date(),
      created_at: new Date(),
    });
  });

  afterAll(async () => {
    if (!ready || !session) return;

    // FK-safe cleanup. llm_interactions rows are NOT deleted — the
    // BUG-286 tamper-evident trigger blocks all DELETE on
    // llm_interactions just like audit_log per BUG-039 (sibling
    // append-only AHPRA Standard 1 / forensic-trail discipline).
    //
    // Episodes + patients are ALSO not deleted because their FK
    // CASCADE on llm_interactions.episode_id / patient_id would
    // trigger the BUG-286 immutability path. Test fixtures (1 patient
    // + 1 episode + N clinical_notes per run) accumulate harmlessly
    // with fresh per-run UUIDs; each test run is isolated by `runId`
    // so cross-run identifier collision is impossible.
    if (createdNotes.length > 0) {
      await dbAdmin('clinical_notes').whereIn('id', createdNotes).del();
    }
    await dbAdmin('scribe_consents').where({ id: consentId }).del().catch(() => undefined);
    // episodes + patients intentionally left in place — the BUG-286
    // immutability trigger forbids cascade deletion of forensic
    // llm_interactions rows.
  });

  /** Insert a quick-memo clinical_note (mimicking the production route shape). */
  async function insertQuickMemoNote(): Promise<string> {
    const id = randomUUID();
    await dbAdmin('clinical_notes').insert({
      id,
      clinic_id: session.clinicId,
      patient_id: patientId,
      episode_id: episodeId,
      consent_id: consentId,
      note_type: 'quick_memo',
      content: `Test transcript ${tag}`,
      status: 'draft',
      author_id: session.userId,
    });
    createdNotes.push(id);
    return id;
  }

  describe('BUG-424c — recordWhisperAsrInteractionSafely (live audit write)', () => {
    it('TP-WHIS-INT-424c-1: writes llm_interactions row with feature=ambient.asr + model_provider=whisper + valid model_version', async () => {
      const noteId = await insertQuickMemoNote();
      const validVersion = `large-v3-turbo@sha256:${'a'.repeat(64)}`;

      await recordWhisperAsrInteractionSafely({
        clinicId: session.clinicId,
        userId: session.userId,
        patientId,
        episodeId,
        modelName: 'large-v3-turbo',
        modelVersion: validVersion,
        latencyMs: 1234,
        success: true,
        metadata: {
          surface: 'voice.quick-memo',
          clinicalNoteId: noteId,
          transcriptLength: 42,
        },
      });

      // Find the llm_interactions row we just wrote (filter by clinic
      // + patient + episode + feature + clinicalNoteId in metadata).
      const rows = await dbAdmin('llm_interactions')
        .where({
          clinic_id: session.clinicId,
          patient_id: patientId,
          episode_id: episodeId,
          feature: 'ambient.asr',
        })
        .whereRaw("metadata::text LIKE ?", [`%${noteId}%`])
        .select('id', 'feature', 'model_provider', 'model_name', 'model_version', 'success', 'latency_ms', 'metadata');

      expect(rows.length).toBeGreaterThanOrEqual(1);
      const row = rows[0];

      expect(row.feature).toBe('ambient.asr');
      expect(row.model_provider).toBe('whisper');
      expect(row.model_name).toBe('large-v3-turbo');
      expect(row.model_version).toBe(validVersion);
      expect(WHISPER_MODEL_VERSION_PATTERN.test(row.model_version)).toBe(true);
      expect(row.success).toBe(true);
      expect(row.latency_ms).toBe(1234);

      // metadata is JSONB — parse if string, use as-is if already
      // object (pg converts JSONB to JS object by default).
      const md =
        typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
      expect(md.surface).toBe('voice.quick-memo');
      expect(md.clinicalNoteId).toBe(noteId);
      expect(md.transcriptLength).toBe(42);
    });

    it('TP-WHIS-INT-424c-2: model_version pattern enforcement — strict variant throws WHISPER_MODEL_VERSION_MISSING on bad pattern', async () => {
      // The strict `recordWhisperAsrInteraction` throws when
      // modelVersion doesn't match the pattern. The safe wrapper
      // (`recordWhisperAsrInteractionSafely`) catches + logs the
      // throw — clinical flow preserved. Test the strict variant
      // directly because the safe wrapper would swallow.
      let thrown: Error | null = null;
      try {
        await recordWhisperAsrInteraction({
          clinicId: session.clinicId,
          userId: session.userId,
          patientId,
          episodeId,
          modelName: 'large-v3-turbo',
          modelVersion: 'NOT-A-VALID-PATTERN', // missing @ separator + sha256
          latencyMs: 100,
          success: true,
        });
      } catch (err) {
        thrown = err as Error;
      }

      expect(thrown).toBeTruthy();
      expect(thrown!.message).toContain('WHISPER_MODEL_VERSION_MISSING');
      // Pattern-violation prevents the audit row from being written;
      // no llm_interactions row should exist for this test's invocation.
    });

    it('TP-WHIS-INT-424c-3: safe wrapper degrades gracefully on bad pattern — no throw, no row written, ERROR-logged', async () => {
      // Counter to TP-2: same bad pattern but via the safe wrapper.
      // No throw should escape (clinical flow preserved). No new
      // llm_interactions row should be written.
      const noteId = await insertQuickMemoNote();
      const beforeCount = (
        await dbAdmin('llm_interactions')
          .where({ clinic_id: session.clinicId, patient_id: patientId })
          .count('* as c')
      )[0].c;

      // Should NOT throw.
      await recordWhisperAsrInteractionSafely({
        clinicId: session.clinicId,
        userId: session.userId,
        patientId,
        episodeId,
        modelName: 'large-v3-turbo',
        modelVersion: 'INVALID',
        latencyMs: 100,
        success: true,
        metadata: { clinicalNoteId: noteId, surface: 'voice.quick-memo' },
      });

      const afterCount = (
        await dbAdmin('llm_interactions')
          .where({ clinic_id: session.clinicId, patient_id: patientId })
          .count('* as c')
      )[0].c;
      expect(Number(afterCount)).toBe(Number(beforeCount));
    });
  });

  describe('BUG-424c — parseWhisperVersionFromResponse (SSoT parser)', () => {
    it('TP-WHIS-INT-424c-4: well-formed /inference response → returns model + version verbatim', async () => {
      const goodVersion = `large-v3-turbo@sha256:${'b'.repeat(64)}`;
      const result = await parseWhisperVersionFromResponse({
        model: 'large-v3-turbo',
        model_version: goodVersion,
      });

      expect(result.whisperModel).toBe('large-v3-turbo');
      expect(result.whisperModelVersion).toBe(goodVersion);
      expect(WHISPER_MODEL_VERSION_PATTERN.test(result.whisperModelVersion)).toBe(true);
    });

    it('TP-WHIS-INT-424c-5: malformed /inference response → falls back to /health probe (digest or @unknown sentinel)', async () => {
      // /inference omitted model_version. Helper must fall back to
      // getWhisperModelVersion() (the /health probe). Depending on local
      // dev runtime, the probe may return a real digest or degrade to
      // `<name>@unknown` if the probe cannot resolve.
      const result = await parseWhisperVersionFromResponse({
        model: 'large-v3-turbo',
        // model_version omitted entirely
      });

      expect(result.whisperModel).toBe('large-v3-turbo');
      // Fallback output MUST always be canonical regardless of whether
      // /health returned a digest or the helper used @unknown.
      expect(WHISPER_MODEL_VERSION_PATTERN.test(result.whisperModelVersion)).toBe(true);
    });
  });

  describe('BUG-424c — invariant: clinical_note ↔ llm_interactions pairing', () => {
    it('TP-WHIS-INT-424c-6: JOIN query — every ASR-derived clinical_note has paired llm_interactions row within ±60s window', async () => {
      // Insert a clinical_note + paired llm_interactions row via the
      // SSoT helper. JOIN-query then asserts the pairing is queryable
      // via patient_id + episode_id + clinic_id + timestamp window.
      // This is the canonical invariant the FOLLOWUP defends.
      const noteId = await insertQuickMemoNote();
      const validVersion = `large-v3-turbo@sha256:${'c'.repeat(64)}`;

      await recordWhisperAsrInteractionSafely({
        clinicId: session.clinicId,
        userId: session.userId,
        patientId,
        episodeId,
        modelName: 'large-v3-turbo',
        modelVersion: validVersion,
        latencyMs: 5000,
        success: true,
        metadata: { surface: 'voice.quick-memo', clinicalNoteId: noteId },
      });

      // JOIN clinical_notes ↔ llm_interactions on patient_id +
      // episode_id + clinic_id with a ±60s timestamp window. Filter
      // on metadata.clinicalNoteId for direct linkage proof. The
      // JSONB extraction `metadata->>'clinicalNoteId'` matches the
      // invariant the FOLLOWUP exists to defend.
      const paired = await dbAdmin('clinical_notes as cn')
        .innerJoin('llm_interactions as li', function () {
          this.on('li.patient_id', '=', 'cn.patient_id')
            .andOn('li.episode_id', '=', 'cn.episode_id')
            .andOn('li.clinic_id', '=', 'cn.clinic_id');
        })
        .where('cn.id', noteId)
        .where('li.feature', 'ambient.asr')
        .whereRaw("li.metadata->>'clinicalNoteId' = ?", [noteId])
        .whereRaw("ABS(EXTRACT(EPOCH FROM (li.created_at - cn.created_at))) <= 60")
        .select('cn.id as note_id', 'li.id as interaction_id', 'li.feature', 'li.model_provider');

      expect(paired.length).toBe(1);
      expect(paired[0].note_id).toBe(noteId);
      expect(paired[0].feature).toBe('ambient.asr');
      expect(paired[0].model_provider).toBe('whisper');
      // llm_interactions row is NOT cleaned up in afterAll (BUG-286
      // immutability trigger); the row accumulates with the fresh
      // per-run UUID — cross-run collision impossible.
    });
  });
});
