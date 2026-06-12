// apps/api/tests/unit/whisperClient.test.ts
//
// BUG-424 — TDD RED-gate for the Whisper SSoT helper.
//
// This file pins the contract that:
//   1. `getWhisperModelVersion()` returns a stable `name@sha256:digest`
//      string (cached) or the explicit `name@unknown` sentinel when
//      /health is unreachable. NEVER an empty string. NEVER a silent
//      undefined.
//   2. `recordWhisperAsrInteraction` writes ONE row to `llm_interactions`
//      with `feature='ambient.asr'`, `model_provider='whisper'`, and a
//      `model_version` that matches the validated shape — fail-CLOSED on
//      missing version (throws WHISPER_MODEL_VERSION_MISSING).
//   3. Caller never has to remember to set the feature or provider —
//      single SSoT helper.
//
// L4 motivation: clinical-safety surface. A silent ASR model regression
// with no audit trail is the forensic black hole the Audit Tier 4.4
// recommendation flagged.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WHISPER_MODEL_VERSION_PATTERN } from '../../src/mcp/whisperClient';

vi.mock('../../src/shared/recordLlmInteraction', () => ({
  recordLlmInteraction: vi.fn(async () => 'mock-row-id'),
}));

import { recordLlmInteraction } from '../../src/shared/recordLlmInteraction';
import {
  getWhisperModelVersion,
  recordWhisperAsrInteraction,
  __testReset,
} from '../../src/mcp/whisperClient';

const CLINIC = '00000000-0000-0000-0000-0000000000c1';
const STAFF = '00000000-0000-0000-0000-0000000000s1';

beforeEach(() => {
  vi.clearAllMocks();
  __testReset();
});

describe('BUG-424 — WHISPER_MODEL_VERSION_PATTERN', () => {
  it('TP-WC-1: accepts the canonical `name@sha256:64hex` shape', () => {
    expect(WHISPER_MODEL_VERSION_PATTERN.test('large-v3-turbo@sha256:' + 'a'.repeat(64))).toBe(true);
  });

  it('TP-WC-2: accepts `name@unknown` graceful-fallback sentinel', () => {
    expect(WHISPER_MODEL_VERSION_PATTERN.test('large-v3-turbo@unknown')).toBe(true);
  });

  it('TP-WC-3: rejects bare digest, bare name, and obviously malformed strings', () => {
    expect(WHISPER_MODEL_VERSION_PATTERN.test('sha256:' + 'a'.repeat(64))).toBe(false);
    expect(WHISPER_MODEL_VERSION_PATTERN.test('large-v3-turbo')).toBe(false);
    expect(WHISPER_MODEL_VERSION_PATTERN.test('')).toBe(false);
    expect(WHISPER_MODEL_VERSION_PATTERN.test('name@sha256:short')).toBe(false);
    expect(WHISPER_MODEL_VERSION_PATTERN.test('name@')).toBe(false);
  });
});

describe('BUG-424 — getWhisperModelVersion', () => {
  it('TP-WC-4: returns name@sha256:digest when /health responds with both fields', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: 'ok', model: 'large-v3-turbo', model_version: 'large-v3-turbo@sha256:' + 'b'.repeat(64) }),
    } as unknown as Response));
    vi.stubGlobal('fetch', fetchSpy);
    const v = await getWhisperModelVersion();
    expect(v).toBe('large-v3-turbo@sha256:' + 'b'.repeat(64));
    expect(WHISPER_MODEL_VERSION_PATTERN.test(v)).toBe(true);
  });

  it('TP-WC-5: caches on first call (second invocation does NOT re-fetch)', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ model: 'large-v3-turbo', model_version: 'large-v3-turbo@sha256:' + 'c'.repeat(64) }),
    } as unknown as Response));
    vi.stubGlobal('fetch', fetchSpy);
    await getWhisperModelVersion();
    await getWhisperModelVersion();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('TP-WC-6: graceful fallback to <name>@unknown when /health is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const v = await getWhisperModelVersion();
    expect(v.endsWith('@unknown')).toBe(true);
    expect(WHISPER_MODEL_VERSION_PATTERN.test(v)).toBe(true);
  });

  it('TP-WC-7: graceful fallback to <name>@unknown when /health responds without model_version field (older Whisper server)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: 'ok', model: 'large-v3-turbo' }),
    } as unknown as Response)));
    const v = await getWhisperModelVersion();
    expect(v.endsWith('@unknown')).toBe(true);
  });
});

describe('BUG-424 absorb-1 — recordLlmInteraction provider-aware version resolution', () => {
  // L5 cycle-1 BLOCK on Standard 1: pre-fix, the Whisper `<name>@sha256:<digest>`
  // shape did NOT match `startsWith('sha256:')`, so recordLlmInteraction's else
  // branch routed to ollamaModelRegistry which overwrote the digest with
  // `large-v3-turbo@unknown`. The fix widens the digest-honour branch to also
  // accept any caller-supplied modelVersion when `modelProvider !== 'ollama'`.
  //
  // These tests pin the provider-aware boundary by un-mocking
  // recordLlmInteraction temporarily and verifying that the row built by the
  // real helper carries the Whisper digest verbatim.
  it('TP-WC-12: recordLlmInteraction honours `<name>@sha256:<digest>` when modelProvider=whisper (no Ollama overwrite)', async () => {
    vi.doUnmock('../../src/shared/recordLlmInteraction');
    vi.resetModules();
    // Stub dbAdmin so the unit test never touches Postgres; integration
    // test in tests/integration/whisperAsrModelVersionRoundTrip.int.test.ts
    // is the live-DB end-to-end gate.
    let captured: Record<string, unknown> | null = null;
    const insertFor = (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        if (table === 'llm_interactions') captured = row;
        return [];
      },
    });
    const trx = Object.assign(
      (table: string) => insertFor(table),
      { raw: async () => [] },
    );
    vi.doMock('../../src/db/db', () => ({
      dbAdmin: Object.assign(
        (table: string) => insertFor(table),
        {
          transaction: async (fn: (trx: unknown) => Promise<void>) => {
            await fn(trx);
          },
        },
      ),
    }));
    vi.doMock('../../src/utils/audit', () => ({ writeAuditLog: async () => {} }));
    vi.doMock('../../src/shared/phiEncryption', () => ({
      encryptPhi: (s: string) => s,
      isPhiEncryptionEnabled: () => false,
    }));
    const { recordLlmInteraction } = await import('../../src/shared/recordLlmInteraction');
    const v = 'large-v3-turbo@sha256:' + 'e'.repeat(64);
    await recordLlmInteraction({
      clinicId: CLINIC,
      userId: STAFF,
      feature: 'ambient.asr',
      modelName: 'large-v3-turbo',
      modelVersion: v,
      modelProvider: 'whisper',
    });
    expect(captured).not.toBeNull();
    expect((captured as Record<string, unknown>).model_version).toBe(v);
    expect((captured as Record<string, unknown>).model_provider).toBe('whisper');
    // Restore mocks for subsequent tests
    vi.doMock('../../src/shared/recordLlmInteraction', () => ({
      recordLlmInteraction: vi.fn(async () => 'mock-row-id'),
    }));
    vi.resetModules();
  });
});

describe('BUG-424 — recordWhisperAsrInteraction (fail-CLOSED + SSoT)', () => {
  it('TP-WC-8: rejects fail-CLOSED with WHISPER_MODEL_VERSION_MISSING when modelVersion is empty', async () => {
    await expect(
      recordWhisperAsrInteraction({
        clinicId: CLINIC,
        userId: STAFF,
        modelName: 'large-v3-turbo',
        modelVersion: '',
        latencyMs: 1234,
      }),
    ).rejects.toThrow('WHISPER_MODEL_VERSION_MISSING');
    expect(recordLlmInteraction).not.toHaveBeenCalled();
  });

  it('TP-WC-9: rejects fail-CLOSED when modelVersion does not match the canonical pattern', async () => {
    await expect(
      recordWhisperAsrInteraction({
        clinicId: CLINIC,
        userId: STAFF,
        modelName: 'large-v3-turbo',
        // looks plausible but doesn't match the SSoT shape
        modelVersion: 'large-v3-turbo',
        latencyMs: 1234,
      }),
    ).rejects.toThrow('WHISPER_MODEL_VERSION_MISSING');
    expect(recordLlmInteraction).not.toHaveBeenCalled();
  });

  it('TP-WC-10: writes ONE row with feature=ambient.asr + provider=whisper when version is well-formed', async () => {
    const v = 'large-v3-turbo@sha256:' + 'd'.repeat(64);
    await recordWhisperAsrInteraction({
      clinicId: CLINIC,
      userId: STAFF,
      modelName: 'large-v3-turbo',
      modelVersion: v,
      latencyMs: 5000,
      patientId: '00000000-0000-0000-0000-0000000000p1',
      success: true,
    });
    expect(recordLlmInteraction).toHaveBeenCalledTimes(1);
    const callArg = (recordLlmInteraction as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.feature).toBe('ambient.asr');
    expect(callArg.modelProvider).toBe('whisper');
    expect(callArg.modelName).toBe('large-v3-turbo');
    expect(callArg.modelVersion).toBe(v);
  });

  it('TP-WC-11: accepts the @unknown graceful sentinel (audit captured even when /health was down at scribe time)', async () => {
    const v = 'large-v3-turbo@unknown';
    await recordWhisperAsrInteraction({
      clinicId: CLINIC,
      userId: STAFF,
      modelName: 'large-v3-turbo',
      modelVersion: v,
      latencyMs: 5000,
    });
    expect(recordLlmInteraction).toHaveBeenCalledTimes(1);
    const callArg = (recordLlmInteraction as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.modelVersion).toBe(v);
  });
});
