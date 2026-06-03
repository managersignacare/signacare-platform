/**
 * BUG-037 regression — llm_interactions MUST record model_version +
 * temperature + pipeline so AI-assisted clinical outputs are forensically
 * reproducible (HIPAA 164.312(b); APP 11.1 security).
 *
 * Coverage matrix (9 tests):
 *
 *   1. Migration smoke: model_version / temperature / pipeline exist
 *      and are queryable.
 *   2. CHECK constraint: temperature ∈ [0, 2] — negative rejected.
 *   3. CHECK constraint: temperature ∈ [0, 2] — >2 rejected.
 *   4. recordLlmInteraction happy path: row contains every audit field.
 *   5. Ambient pipeline ordering: stages serialised in the documented
 *      order (whisper → pii_redact → pass1 → pass2 → pass3).
 *   6. /agent write: /agent handler uses recordLlmInteraction and the
 *      row carries modelVersion + temperature + pipeline with agent_run.
 *   7. Non-blocking failure path: insert-failure writes LLM_AUDIT_WRITE_FAILED
 *      to audit_log and does not throw to the caller.
 *   8. PHI-safe metadata: keys matching PHI_FIELDS are rejected.
 *   9. Backward compat: existing llm_interactions rows without the new
 *      columns still read back cleanly (NULL is honest, no crash).
 *
 * Red-first: pre-migration tests 1–4 and 6–8 FAIL (columns don't exist /
 * helper not wired); post-fix 9/9 PASS.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

// ─── Hoisted LLM mock so /agent doesn't hit Ollama ─────────────────────────
const aiAgentMock = vi.hoisted(() => ({
  runAgent: vi.fn(),
}));
vi.mock('../../src/mcp/server/aiAgent', () => ({
  runAgent: aiAgentMock.runAgent,
}));

import request from 'supertest';
import app from '../../src/server';

describe.skipIf(!(await isIntegrationReady()))('BUG-037 llm_interactions audit fields', () => {
  let token: string;
  let clinicId: string;
  let userId: string;
  let patientId: string;

  beforeAll(async () => {
    const session = await loginAsAdmin();
    token = session.token;
    clinicId = session.clinicId;
    userId = session.userId;

    const { dbAdmin } = await import('../../src/db/db');
    // Fetch an existing patient the admin user can query so /agent doesn't
    // fail the patient-relationship gate for admin-role bypass.
    const p = await dbAdmin('patients').where({ clinic_id: clinicId }).first();
    if (!p) throw new Error('No seeded patient for BUG-037 tests');
    patientId = p.id;
  });

  afterAll(async () => {
    // llm_interactions is append-only (BUG-286). Cleanup by DELETE is
    // intentionally disallowed; this suite uses unique IDs/features so
    // rows are naturally isolated per run.
  });

  it('T1 — migration added model_version / temperature / pipeline columns', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const cols = await dbAdmin
      .raw(
        `SELECT column_name, data_type
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'llm_interactions'
         AND column_name IN ('model_version','temperature','pipeline')
         ORDER BY column_name`,
      );
    const colMap = new Map<string, string>();
    for (const r of cols.rows as { column_name: string; data_type: string }[]) {
      colMap.set(r.column_name, r.data_type);
    }
    expect(colMap.get('model_version')).toBe('text');
    expect(colMap.get('temperature')).toBe('numeric');
    expect(colMap.get('pipeline')).toBe('jsonb');
  });

  it('T2 — CHECK constraint rejects negative temperature', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    await expect(
      dbAdmin('llm_interactions').insert({
        id: randomUUID(),
        clinic_id: clinicId,
        user_id: userId,
        feature: 'bug-037-smoke',
        model_name: 'llama3',
        temperature: -0.1,
        success: true,
        created_at: new Date(),
      }),
    ).rejects.toThrow(/temperature_range_check|check constraint/i);
  });

  it('T3 — CHECK constraint rejects temperature > 2', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    await expect(
      dbAdmin('llm_interactions').insert({
        id: randomUUID(),
        clinic_id: clinicId,
        user_id: userId,
        feature: 'bug-037-smoke',
        model_name: 'llama3',
        temperature: 2.1,
        success: true,
        created_at: new Date(),
      }),
    ).rejects.toThrow(/temperature_range_check|check constraint/i);
  });

  it('T4 — recordLlmInteraction writes every new audit field', async () => {
    const { recordLlmInteraction } = await import('../../src/shared/recordLlmInteraction');
    const id = await recordLlmInteraction({
      clinicId,
      userId,
      feature: 'bug-037-happy',
      modelName: 'llama3.2',
      modelVersion: 'sha256:abc123',
      modelProvider: 'ollama',
      temperature: 0.2,
      pipeline: [{
        stage: 'pass1_extract',
        startedAt: new Date().toISOString(),
        durationMs: 450,
        success: true,
        meta: { subjective: 3 },
      }],
      promptTokens: 120,
      completionTokens: 80,
      totalTokens: 200,
      latencyMs: 1500,
      success: true,
      metadata: { versionSource: 'digest' },
    });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const { dbAdmin } = await import('../../src/db/db');
    const row = await dbAdmin('llm_interactions').where({ id }).first();
    expect(row).toBeDefined();
    expect(row.model_version).toBe('sha256:abc123');
    expect(Number(row.temperature)).toBe(0.2);
    expect(row.pipeline).toBeDefined();
    const pipe = typeof row.pipeline === 'string' ? JSON.parse(row.pipeline) : row.pipeline;
    expect(Array.isArray(pipe)).toBe(true);
    expect(pipe[0].stage).toBe('pass1_extract');
    expect(pipe[0].durationMs).toBe(450);
  });

  it('T5 — pipeline preserves stage ordering in JSONB', async () => {
    const { recordLlmInteraction } = await import('../../src/shared/recordLlmInteraction');
    const id = await recordLlmInteraction({
      clinicId,
      userId,
      feature: 'bug-037-happy',
      modelName: 'llama3.2',
      modelVersion: 'llama3.2',
      temperature: 0.0,
      pipeline: [
        { stage: 'whisper', startedAt: '2026-04-21T10:00:00Z', durationMs: 2000, success: true },
        { stage: 'pii_redact', startedAt: '2026-04-21T10:00:02Z', durationMs: 10, success: true },
        { stage: 'pass1_extract', startedAt: '2026-04-21T10:00:02Z', durationMs: 450, success: true },
        { stage: 'pass2_safety', startedAt: '2026-04-21T10:00:03Z', durationMs: 15, success: true },
        { stage: 'pass3_format', startedAt: '2026-04-21T10:00:03Z', durationMs: 600, success: true },
      ],
      success: true,
    });
    const { dbAdmin } = await import('../../src/db/db');
    const row = await dbAdmin('llm_interactions').where({ id }).first();
    const pipe = typeof row.pipeline === 'string' ? JSON.parse(row.pipeline) : row.pipeline;
    expect(pipe.map((s: { stage: string }) => s.stage)).toEqual([
      'whisper', 'pii_redact', 'pass1_extract', 'pass2_safety', 'pass3_format',
    ]);
  });

  it('T6 — /agent writes row with modelVersion + temperature + agent_run pipeline', async () => {
    aiAgentMock.runAgent.mockResolvedValueOnce({
      answer: 'Mock agent answer.',
      toolCalls: [],
      iterations: 1,
      model: 'llama3.2',
      modelVersion: 'llama3.2',
      requestedTemperature: 0.1,
    });

    const res = await request(app)
      .post('/api/v1/llm/agent')
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test')
      .send({ query: 'Show organisation statistics', patientId });
    expect(res.status).toBe(200);

    const { dbAdmin } = await import('../../src/db/db');
    const row = await dbAdmin('llm_interactions')
      .where({ clinic_id: clinicId, feature: 'ai-agent' })
      .orderBy('created_at', 'desc').first();
    expect(row).toBeDefined();
    // L5 absorption — modelVersion is resolved via ollamaModelRegistry
    // when the caller supplies a tag (not an sha256: digest). In the test
    // env Ollama may be unreachable; the registry degrades to
    // '<name>@unknown'. Either way the model_name is embedded.
    expect(row.model_version).toMatch(/^llama3\.2@/);
    expect(Number(row.temperature)).toBe(0.1);
    const pipe = typeof row.pipeline === 'string' ? JSON.parse(row.pipeline) : row.pipeline;
    expect(pipe[0].stage).toBe('agent_run');
  });

  it('T7 — primary insert failure writes LLM_AUDIT_WRITE_FAILED to audit_log', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    // Force primary insert failure via the CHECK constraint.
    const { recordLlmInteraction } = await import('../../src/shared/recordLlmInteraction');

    const before = await dbAdmin('audit_log')
      .where({ operation: 'LLM_AUDIT_WRITE_FAILED' })
      .count({ cnt: '*' }).first();
    const beforeCnt = Number((before as { cnt: string }).cnt);

    // Must not throw, even though the row will fail the CHECK constraint.
    await expect(
      recordLlmInteraction({
        clinicId,
        userId,
        feature: 'bug-037-happy',
        modelName: 'llama3',
        temperature: 99, // violates CHECK
        success: true,
      }),
    ).resolves.toBeDefined();

    const after = await dbAdmin('audit_log')
      .where({ operation: 'LLM_AUDIT_WRITE_FAILED' })
      .count({ cnt: '*' }).first();
    const afterCnt = Number((after as { cnt: string }).cnt);
    expect(afterCnt).toBeGreaterThan(beforeCnt);
  });

  it('T8 — metadata with PHI field name is rejected at write-time', async () => {
    const { recordLlmInteraction } = await import('../../src/shared/recordLlmInteraction');
    await expect(
      recordLlmInteraction({
        clinicId,
        userId,
        feature: 'bug-037-happy',
        modelName: 'llama3',
        metadata: { given_name: 'Jane' }, // PHI field name — forbidden
      }),
    ).rejects.toThrow(/PHI field name/i);
  });

  it('T9 — existing rows without new columns read back cleanly (backward compat)', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const legacyId = randomUUID();
    // Write a row that omits model_version / temperature / pipeline.
    await dbAdmin('llm_interactions').insert({
      id: legacyId,
      clinic_id: clinicId,
      user_id: userId,
      feature: 'bug-037-backcompat',
      model_name: 'llama3',
      success: true,
      created_at: new Date(),
    });
    const row = await dbAdmin('llm_interactions').where({ id: legacyId }).first();
    expect(row).toBeDefined();
    expect(row.model_version).toBeNull();
    expect(row.temperature).toBeNull();
    expect(row.pipeline).toBeNull();
  });
});
