#!/usr/bin/env tsx
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SovereignModelArtifactManifestSchema } from '@signacare/shared';

interface ParsedArgs {
  manifestPath: string | null;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { manifestPath: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--manifest') {
      args.manifestPath = argv[i + 1] ?? null;
      i += 1;
    }
  }
  return args;
}

function usage(): never {
  console.error('Usage: npm run ai:sovereign-artifact:validate -- --manifest docs/quality/sovereign-model-artifacts/<record>.json');
  process.exit(2);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!args.manifestPath) usage();

  const manifest = SovereignModelArtifactManifestSchema.parse(
    JSON.parse(readFileSync(resolve(process.cwd(), args.manifestPath), 'utf8')),
  );
  const review = manifest.trainingAdapterReview;
  const blockers: string[] = [];

  if (!review.reviewed) {
    blockers.push('trainingAdapterReview.reviewed must be true');
  }
  if (review.compatibleAdapterCount !== review.existingAdapterCount) {
    blockers.push('all existing clinician style adapters must be marked compatible with this artifact');
  }
  if (review.incompatibleAdapterNames.length > 0) {
    blockers.push('incompatibleAdapterNames must be empty before sovereign artifact promotion');
  }
  if (review.adaptersRequiringRetrain.length > 0) {
    blockers.push('adaptersRequiringRetrain must be empty before sovereign artifact promotion');
  }
  if (!manifest.healthCheckPath.startsWith('/')) {
    blockers.push('healthCheckPath must be a relative path beginning with /');
  }

  if (blockers.length > 0) {
    console.error('Sovereign model artifact manifest failed promotion validation:');
    for (const blocker of blockers) console.error(`  - ${blocker}`);
    process.exit(1);
  }

  console.log(JSON.stringify({
    ok: true,
    lane: manifest.lane,
    backendRuntime: manifest.backendRuntime,
    imageRef: manifest.imageRef,
    modelName: manifest.modelName,
    modelManifestSha256: manifest.modelManifestSha256,
    runtimePullAllowed: manifest.runtimePullAllowed,
    inferenceTrainingSeparated: manifest.inferenceTrainingSeparated,
    existingAdapterCount: review.existingAdapterCount,
    compatibleAdapterCount: review.compatibleAdapterCount,
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
