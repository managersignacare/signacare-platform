#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadSplitManifests, REPO_ROOT } from './lib/manifests.mjs';
import {
  assertCleanSourceRepo,
  backupRepoWorkingTree,
  buildBackupRoot,
  buildSyncMetadata,
  compareMaterializedRepo,
  createTempSyncDir,
  getGitContext,
  printSyncSummary,
  runNodeScript,
  syncMaterializedRepo,
  validateTargetRepo,
  writeSyncMetadata,
} from './lib/targets.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const scaffoldScript = path.join(__dirname, 'scaffold-split-repos.mjs');

function parseArgs(argv) {
  return {
    dryRun: argv.includes('--dry-run'),
    allowDirtySource: argv.includes('--allow-dirty-source'),
    skipFetch: argv.includes('--skip-fetch'),
  };
}

function materializeRepos(tempDir, manifests, sourceContext) {
  runNodeScript(scaffoldScript, ['--out', tempDir], REPO_ROOT);

  for (const manifest of manifests) {
    const repoDir = path.join(tempDir, manifest.repoName);
    writeSyncMetadata(repoDir, buildSyncMetadata(manifest, sourceContext));
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifests = loadSplitManifests();
  const sourceContext = getGitContext(REPO_ROOT);
  const tempDir = createTempSyncDir('signacare-repo-split-sync-');
  const backupRoot = buildBackupRoot();
  const summary = [];

  try {
    if (!args.allowDirtySource) {
      assertCleanSourceRepo(REPO_ROOT);
    }

    materializeRepos(tempDir, manifests, sourceContext);

    for (const manifest of manifests) {
      const target = validateTargetRepo(manifest, { fetch: !args.skipFetch });
      const materializedDir = path.join(tempDir, manifest.repoName);

      summary.push(
        `${manifest.repoName}: source ${sourceContext.branch}@${sourceContext.commit.slice(0, 12)} -> ${target.dir}`,
      );

      if (args.dryRun) {
        const drift = compareMaterializedRepo(materializedDir, target.dir);
        summary.push(drift ? `  drift detected (dry-run)` : '  already in sync');
        continue;
      }

      const archivePath = backupRepoWorkingTree(target.dir, backupRoot);
      summary.push(`  backup: ${archivePath}`);

      syncMaterializedRepo(materializedDir, target.dir);
      const verification = compareMaterializedRepo(materializedDir, target.dir);
      if (verification) {
        throw new Error(
          `Post-sync verification failed for ${manifest.repoName}\n${verification}`,
        );
      }

      summary.push('  synced and verified');
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  printSyncSummary(summary);
  if (args.dryRun) {
    console.log('Dry run complete. No target repos were modified.');
    return;
  }

  console.log(`Target repo sync complete. Backups stored in ${backupRoot}`);
}

main();
