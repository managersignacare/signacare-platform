#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadSplitManifests, REPO_ROOT } from './lib/manifests.mjs';
import {
  buildSyncMetadata,
  compareMaterializedRepo,
  createTempSyncDir,
  getGitContext,
  printSyncSummary,
  runNodeScript,
  validateTargetRepo,
  writeSyncMetadata,
} from './lib/targets.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const scaffoldScript = path.join(__dirname, 'scaffold-split-repos.mjs');

function parseArgs(argv) {
  return {
    skipFetch: argv.includes('--skip-fetch'),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifests = loadSplitManifests();
  const sourceContext = getGitContext(REPO_ROOT);
  const tempDir = createTempSyncDir('signacare-repo-split-verify-');
  const summary = [];
  let hasDrift = false;

  try {
    runNodeScript(scaffoldScript, ['--out', tempDir], REPO_ROOT);

    for (const manifest of manifests) {
      const repoDir = path.join(tempDir, manifest.repoName);
      writeSyncMetadata(repoDir, buildSyncMetadata(manifest, sourceContext));
    }

    for (const manifest of manifests) {
      const target = validateTargetRepo(manifest, { fetch: !args.skipFetch });
      const materializedDir = path.join(tempDir, manifest.repoName);
      const drift = compareMaterializedRepo(materializedDir, target.dir);

      if (drift) {
        hasDrift = true;
        summary.push(`${manifest.repoName}: OUT OF SYNC`);
        summary.push(drift.trimEnd());
      } else {
        summary.push(`${manifest.repoName}: in sync`);
      }
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  printSyncSummary(summary);
  if (hasDrift) {
    process.exit(1);
  }
}

main();
