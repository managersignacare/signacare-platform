#!/usr/bin/env tsx
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');

function read(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

const checks: Array<{ path: string; patterns: Array<[RegExp | string, string]> }> = [
  {
    path: 'packages/shared/src/aiScribeParity.schemas.ts',
    patterns: [
      ['realtime_in_visit_documentation', 'shared contract must name realtime in-visit documentation'],
      ['au_document_generation', 'shared contract must name AU document generation'],
      ['per_clinician_style_learning', 'shared contract must name clinician style learning'],
      ['structured_mse_citations', 'shared contract must name structured MSE citations'],
      ['shared_lineage_keying', 'shared contract must name shared lineage keying'],
      ['outcome_telemetry', 'shared contract must name outcome telemetry'],
      ['ScribeRealtimeDraftSnapshotSchema', 'shared contract must validate realtime draft snapshots'],
      ['AuScribeDocumentKindSchema', 'shared contract must validate AU document kinds'],
      ['ScribeStyleFeedbackSchema', 'shared contract must validate opt-in style feedback'],
      ['ScribeOutcomeTelemetrySchema', 'shared contract must validate derived outcome telemetry'],
    ],
  },
  {
    path: 'apps/api/src/features/llm/scribeRoutes.ts',
    patterns: [
      ["/capabilities", 'API must expose a read-only capabilities endpoint for smoke proof'],
      ['AI_SCRIBE_PARITY_CAPABILITIES', 'capabilities endpoint must use shared parity capability list'],
      ['async-ai-scribe-v2', 'capabilities endpoint must advertise the active async scribe path'],
    ],
  },
  {
    path: 'apps/api/src/features/llm/scribeSessionRoutes.ts',
    patterns: [
      ['buildScribeActionLineageKey', 'session lifecycle module must retain action-item lineage keying'],
    ],
  },
  {
    path: 'apps/api/src/features/llm/scribeParityRoutes.ts',
    patterns: [
      ['/session/:id/realtime-draft', 'session API must accept realtime in-visit draft snapshots'],
      ['/session/:id/au-document', 'session API must create AU document drafts through the letter lifecycle'],
      ['/session/:id/style-feedback', 'session API must capture opt-in clinician style feedback'],
      ['/session/:id/outcome-telemetry', 'session API must capture derived outcome telemetry'],
      ['requireRecordedScribeConsent', 'PHI-bearing scribe parity endpoints must require recorded consent'],
      ['requireActiveScribeConsent', 'PHI-bearing scribe parity endpoints must re-check active consent before processing'],
      ['verifyRecordingConsentStillActive', 'PHI-bearing scribe parity endpoints must fail closed after consent revocation'],
      ['derived-feedback-pending-adapter-consent', 'style feedback must stay derived-only until adapter-corpus consent exists'],
      ['buildScribeArtifactLineageKey', 'session API must stamp shared scribe artefact lineage keys'],
      ['recordScribeOutcomeTelemetry', 'session API must emit derived outcome telemetry'],
      ['createDraftLetter', 'AU documents must reuse the existing letter lifecycle rather than one-off documents'],
      ['orderByRaw(\'CASE WHEN clinic_id = ? THEN 0 ELSE 1 END\'', 'AU document template resolution must prefer clinic-specific templates over global fallbacks'],
    ],
  },
  {
    path: 'apps/api/src/mcp/trainingPipeline.ts',
    patterns: [
      ['innerJoin(\'llm_prompts_outputs as lpo\'', 'training export must require encrypted prompt/output artefact proof'],
      ['whereNotNull(\'lpo.consent_id\')', 'training export must exclude null-consent post-hoc feedback'],
      ['where(\'lpo.encryption_status\', \'ENCRYPTED\')', 'training export must exclude failed/revoked prompt-output artefacts'],
    ],
  },
  {
    path: 'apps/api/src/features/llm/scribeArtifactLineage.ts',
    patterns: [
      ['canonicalTextHash', 'lineage helper must hash canonical clinical text'],
      ['lineageKey', 'lineage helper must return stable lineage keys'],
      ['ScribeArtifactLineageSchema.parse', 'lineage helper must validate its response contract'],
    ],
  },
  {
    path: 'apps/api/src/features/llm/scribeOutcomeTelemetry.ts',
    patterns: [
      ['scribe-outcome-telemetry', 'outcome telemetry must use a canonical feature label'],
      ["modelProvider: 'system'", 'outcome telemetry must not pretend to be model-generated output'],
      ["source: 'ai-scribe-parity-v1'", 'outcome telemetry must stamp its contract source'],
    ],
  },
  {
    path: 'apps/web/src/features/patients/components/notes/AmbientAiResultPanel.tsx',
    patterns: [
      ['result.mseStructured', 'web result panel must render the structured MSE contract'],
      ['Evidence:', 'web result panel must expose per-field MSE evidence citations'],
      ['domain.certainty', 'web result panel must expose MSE certainty labels'],
    ],
  },
  {
    path: 'deploy/azure/post-deploy-smoke.sh',
    patterns: [
      ['SMOKE_REQUIRE_AI_SCRIBE_PARITY', 'smoke script must fail closed for required scribe parity proof'],
      ['/api/v1/scribe/capabilities', 'smoke script must prove the deployed scribe capabilities route'],
      ['realtime_in_visit_documentation', 'smoke script must require realtime scribe capability'],
      ['au_document_generation', 'smoke script must require AU document generation capability'],
      ['per_clinician_style_learning', 'smoke script must require style learning capability'],
      ['structured_mse_citations', 'smoke script must require MSE citation capability'],
      ['shared_lineage_keying', 'smoke script must require lineage capability'],
      ['outcome_telemetry', 'smoke script must require outcome telemetry capability'],
    ],
  },
  {
    path: '.github/workflows/azure-deploy.yml',
    patterns: [
      ['SMOKE_REQUIRE_AI_SCRIBE_PARITY', 'Azure deploy must pass AI scribe parity policy into smoke'],
      ["needs.build-and-push.outputs.env_name == 'staging'", 'staging smoke must require AI scribe parity proof by default'],
      ["SMOKE_REQUIRE_AI_SCRIBE_PARITY: 'true'", 'post-swap production smoke must require scribe parity proof'],
    ],
  },
];

const violations: string[] = [];

for (const check of checks) {
  const source = read(check.path);
  for (const [pattern, reason] of check.patterns) {
    const pass = typeof pattern === 'string' ? source.includes(pattern) : pattern.test(source);
    if (!pass) violations.push(`${check.path}: ${reason}`);
  }
}

if (violations.length > 0) {
  console.error('AI scribe parity contract failed:');
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

console.log('AI scribe parity contract passed.');
