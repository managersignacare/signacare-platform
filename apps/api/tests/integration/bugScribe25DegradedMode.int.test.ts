import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authedAgent, isIntegrationReady, loginAsAdmin } from './_helpers';
import { dbAdmin } from '../../src/db/db';
import { withTenantContext } from '../../src/shared/tenantContext';
import { _resetFeatureFlagCache } from '../../src/shared/featureFlags';

const READY = await isIntegrationReady();

describe.skipIf(!READY)('BUG-SCRIBE25-006 — scribe degraded-mode + recovery behavior', () => {
  let token = '';
  let clinicId = '';
  let priorAiScribeState: { enabled: boolean; rolloutPercentage: number } | null = null;
  let priorWhisperUrl: string | undefined;

  async function enableAiScribeFlag(): Promise<void> {
    await withTenantContext(clinicId, async () => {
      const existing = await dbAdmin('feature_flags')
        .where({ clinic_id: clinicId, name: 'ai-scribe' })
        .first('id', 'enabled', 'rollout_percentage');
      if (existing) {
        priorAiScribeState = {
          enabled: Boolean(existing.enabled),
          rolloutPercentage: Number(existing.rollout_percentage ?? 0),
        };
        await dbAdmin('feature_flags')
          .where({ id: existing.id })
          .update({ enabled: true, rollout_percentage: 100 });
        _resetFeatureFlagCache();
        return;
      }
      priorAiScribeState = null;
      await dbAdmin('feature_flags').insert({
        id: randomUUID(),
        clinic_id: clinicId,
        name: 'ai-scribe',
        enabled: true,
        rollout_percentage: 100,
        created_at: new Date(),
        updated_at: new Date(),
      });
      _resetFeatureFlagCache();
    });
  }

  beforeAll(async () => {
    const session = await loginAsAdmin();
    token = session.token;
    clinicId = session.clinicId;
    await enableAiScribeFlag();
    priorWhisperUrl = process.env.WHISPER_API_URL;
  });

  afterAll(async () => {
    if (!READY) return;
    process.env.WHISPER_API_URL = priorWhisperUrl;
    await withTenantContext(clinicId, async () => {
      if (priorAiScribeState === null) {
        await dbAdmin('feature_flags').where({ clinic_id: clinicId, name: 'ai-scribe' }).del();
      } else {
        await dbAdmin('feature_flags')
          .where({ clinic_id: clinicId, name: 'ai-scribe' })
          .update({
            enabled: priorAiScribeState.enabled,
            rollout_percentage: priorAiScribeState.rolloutPercentage,
          });
      }
      _resetFeatureFlagCache();
    });
  });

  it('returns degraded-mode recovery payload when whisper host is unavailable', async () => {
    process.env.WHISPER_API_URL = 'http://127.0.0.1:1';

    const res = await authedAgent(token)
      .post('/api/v1/scribe/stream-final')
      .field('sessionId', 'degraded-mode-session')
      .field('existingTranscript', 'partial transcript from earlier chunks')
      .attach('audio', Buffer.from('bad-audio-content'), 'chunk.webm');

    expect(res.status).toBe(200);
    expect(res.body?.degradedMode).toBe(true);
    expect(res.body?.recovery?.retryRecommended).toBe(true);
    expect(res.body?.transcript).toContain('partial transcript from earlier chunks');
  });
});
