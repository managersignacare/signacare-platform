#!/usr/bin/env tsx
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AiModelPromotionRecordSchema,
  AiShadowRunEvidenceBundleSchema,
  AiTextGenerationModelAliasSchema,
} from '@signacare/shared';
import { assertAliasPromotionAllowedByManifest } from '../../apps/api/src/features/llm/modelRouter/modelPolicyManifest';
import { assertModelPromotionEvidenceBundleAllowed } from '../../apps/api/src/features/llm/modelRouter/modelGovernance';
import { createHash } from 'node:crypto';

interface ParsedArgs {
  alias: string | null;
  recordPath: string | null;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { alias: null, recordPath: null };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--alias') {
      args.alias = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (value === '--record') {
      args.recordPath = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
  }
  return args;
}

function usage(): never {
  console.error('Usage: npm run ai:model-promotion:validate -- --alias <alias> --record <promotion-record.json>');
  process.exit(2);
}

function sha256Text(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function assertRepoEvidencePath(path: string): void {
  if (
    path.startsWith('/')
    || path.includes('..')
    || !/^docs\/quality\/ai-model-governance\/[A-Za-z0-9_.-]+\.json$/.test(path)
  ) {
    throw new Error('shadowEvidenceUri must be a repo-relative docs/quality/ai-model-governance/*.json path');
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!args.alias || !args.recordPath) usage();

  const alias = AiTextGenerationModelAliasSchema.parse(args.alias);
  const record = AiModelPromotionRecordSchema.parse(
    JSON.parse(readFileSync(resolve(process.cwd(), args.recordPath), 'utf8')),
  );
  const policy = assertAliasPromotionAllowedByManifest({ alias, promotionRecord: record });
  assertRepoEvidencePath(record.shadowEvidenceUri);
  const shadowEvidenceRaw = readFileSync(resolve(process.cwd(), record.shadowEvidenceUri), 'utf8');
  const shadowEvidence = AiShadowRunEvidenceBundleSchema.parse(JSON.parse(shadowEvidenceRaw));
  assertModelPromotionEvidenceBundleAllowed({
    promotionRecord: record,
    evidenceBundle: shadowEvidence,
    evidenceSha256: sha256Text(shadowEvidenceRaw),
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        alias,
        decision: record.decision,
        policyVersion: record.policyVersion,
        fromDeploymentRef: record.fromDeploymentRef,
        toDeploymentRef: record.toDeploymentRef,
        evidenceUri: record.evidenceUri,
        shadowEvidenceUri: record.shadowEvidenceUri,
        shadowEvidenceSha256: record.shadowEvidenceSha256,
        rollbackPlanUri: record.rollbackPlanUri,
        defaultLanePreference: policy.defaultLanePreference,
        promptCacheEligible: policy.promptCacheEligible,
      },
      null,
      2,
    ),
  );
}

try {
  main();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
