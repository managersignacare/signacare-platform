import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AI_SCRIBE_PARITY_CAPABILITIES,
  AiScribeCapabilitiesResponseSchema,
  ScribeRealtimeDraftSnapshotSchema,
  ScribeStyleFeedbackSchema,
} from '@signacare/shared';
import { buildScribeArtifactLineageKey } from '../../src/features/llm/scribeArtifactLineage';

const ROOT = resolve(__dirname, '..', '..');

function read(relPath: string): string {
  return readFileSync(resolve(ROOT, relPath), 'utf8');
}

describe('AI scribe competitive parity contract', () => {
  it('advertises all six parity capabilities through the shared schema', () => {
    const payload = AiScribeCapabilitiesResponseSchema.parse({
      schemaVersion: '1.0',
      activePath: 'async-ai-scribe-v2',
      capabilities: AI_SCRIBE_PARITY_CAPABILITIES,
      stagingSmokeRequired: true,
      productionSmokeRequired: true,
    });

    expect(payload.capabilities).toEqual([
      'realtime_in_visit_documentation',
      'au_document_generation',
      'per_clinician_style_learning',
      'structured_mse_citations',
      'shared_lineage_keying',
      'outcome_telemetry',
    ]);
  });

  it('requires explicit clinician opt-in for style feedback learning', () => {
    expect(() => ScribeStyleFeedbackSchema.parse({
      source: 'ambient_note',
      originalText: 'Original note wording.',
      editedText: 'Edited clinician style.',
      clinicianOptInConfirmed: false,
    })).toThrow();

    expect(ScribeStyleFeedbackSchema.parse({
      source: 'ambient_note',
      originalText: 'Original note wording.',
      editedText: 'Edited clinician style.',
      clinicianOptInConfirmed: true,
    }).clinicianOptInConfirmed).toBe(true);
  });

  it('validates realtime draft snapshots without requiring raw draft persistence', () => {
    const snapshot = ScribeRealtimeDraftSnapshotSchema.parse({
      sourceChunkIndex: 2,
      partialTranscript: 'Patient reports three weeks of low mood.',
      draftSections: { subjective: 'Low mood for three weeks.' },
      mseStructuredPresent: true,
    });

    expect(snapshot.sourceChunkIndex).toBe(2);
    expect(snapshot.draftSections.subjective).toContain('Low mood');
  });

  it('builds stable shared lineage keys without exposing raw clinical text', () => {
    const first = buildScribeArtifactLineageKey({
      sourceKind: 'in_visit_draft',
      patientId: '00000000-0000-4000-8000-000000000001',
      sessionId: '00000000-0000-4000-8000-000000000002',
      canonicalText: ' Patient reports low mood. ',
    });
    const second = buildScribeArtifactLineageKey({
      sourceKind: 'in_visit_draft',
      patientId: '00000000-0000-4000-8000-000000000001',
      sessionId: '00000000-0000-4000-8000-000000000002',
      canonicalText: 'patient   reports   low   mood.',
    });

    expect(first.lineageKey).toBe(second.lineageKey);
    expect(first.canonicalTextHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toHaveProperty('canonicalText');
  });

  it('wires the API, UI, smoke, and Azure workflow to the parity contract', () => {
    const scribeRoutes = read('src/features/llm/scribeRoutes.ts');
    const parityRoutes = read('src/features/llm/scribeParityRoutes.ts');
    const resultPanel = read('../web/src/features/patients/components/notes/AmbientAiResultPanel.tsx');
    const smoke = read('../../deploy/azure/post-deploy-smoke.sh');
    const workflow = read('../../.github/workflows/azure-deploy.yml');

    expect(scribeRoutes).toContain('/capabilities');
    expect(scribeRoutes).toContain('scribeParityRoutes');
    expect(parityRoutes).toContain('/session/:id/realtime-draft');
    expect(parityRoutes).toContain('/session/:id/au-document');
    expect(parityRoutes).toContain('/session/:id/style-feedback');
    expect(parityRoutes).toContain('/session/:id/outcome-telemetry');
    expect(parityRoutes).toContain('requireRecordedScribeConsent');
    expect(parityRoutes).toContain('requireActiveScribeConsent');
    expect(parityRoutes).toContain('verifyRecordingConsentStillActive');
    expect(parityRoutes).toContain('derived-feedback-pending-adapter-consent');
    expect(parityRoutes).not.toContain('saveFeedback');
    expect(resultPanel).toContain('result.mseStructured');
    expect(resultPanel).toContain('Evidence:');
    expect(smoke).toContain('SMOKE_REQUIRE_AI_SCRIBE_PARITY');
    expect(smoke).toContain('/api/v1/scribe/capabilities');
    expect(workflow).toContain("needs.build-and-push.outputs.env_name == 'staging'");
    expect(workflow).toContain('SMOKE_REQUIRE_AI_SCRIBE_PARITY');
  });

  it('keeps style-learning exports consent-bound and clinic-template selection deterministic', () => {
    const parityRoutes = read('src/features/llm/scribeParityRoutes.ts');
    const trainingPipeline = read('src/mcp/trainingPipeline.ts');

    expect(parityRoutes).toContain("orderByRaw('CASE WHEN clinic_id = ? THEN 0 ELSE 1 END'");
    expect(trainingPipeline).toContain("innerJoin('llm_prompts_outputs as lpo'");
    expect(trainingPipeline).toContain("whereNotNull('lpo.consent_id')");
    expect(trainingPipeline).toContain("where('lpo.encryption_status', 'ENCRYPTED')");
  });
});
