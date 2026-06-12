#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import {
  buildOwnershipReport,
  loadSplitManifests,
  manifestOwnsPath,
  projectPathForManifest,
  REPO_ROOT,
} from './lib/manifests.mjs';

function parseArgs(argv) {
  const args = { outDir: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out' && argv[i + 1]) {
      args.outDir = path.resolve(argv[i + 1]);
      i += 1;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const manifests = loadSplitManifests();
const report = buildOwnershipReport(manifests);

if (report.conflicts.length > 0) {
  console.error('Cannot scaffold split repos while ownership conflicts exist.');
  for (const conflict of report.conflicts) {
    console.error(`  - ${conflict.path} -> ${conflict.owners.join(', ')}`);
  }
  process.exit(1);
}

if (!args.outDir) {
  console.log('repo-split scaffold dry run');
  console.log(`  files scanned: ${report.filesScanned}`);
  for (const manifest of manifests) {
    const ownedFiles = report.ownership.get(manifest.repoName) ?? [];
    console.log(`  ${manifest.repoName}: ${ownedFiles.length} file(s) ready for extraction`);
  }
  console.log('Pass --out <dir> to materialize bootstrap repo trees.');
  process.exit(0);
}

fs.mkdirSync(args.outDir, { recursive: true });

for (const manifest of manifests) {
  const repoDir = path.join(args.outDir, manifest.repoName);
  fs.mkdirSync(repoDir, { recursive: true });

  if (manifest.repoScaffoldPath) {
    const scaffoldDir = path.join(REPO_ROOT, manifest.repoScaffoldPath);
    if (fs.existsSync(scaffoldDir)) {
      fs.cpSync(scaffoldDir, repoDir, { recursive: true });
    }
  }

  fs.writeFileSync(
    path.join(repoDir, 'split-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  const ownedFiles = report.ownership.get(manifest.repoName) ?? [];
  fs.writeFileSync(
    path.join(repoDir, 'owned-files.txt'),
    `${ownedFiles.join('\n')}\n`,
    'utf8',
  );

  for (const relativePath of ownedFiles) {
    if (!manifestOwnsPath(manifest, relativePath)) continue;
    const sourcePath = path.join(REPO_ROOT, relativePath);
    if (fs.lstatSync(sourcePath).isSymbolicLink()) continue;
    const projectedPath = projectPathForManifest(manifest, relativePath);
    const targetPath = path.join(repoDir, projectedPath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
  }
}

console.log(`Materialized split repo scaffolds at ${args.outDir}`);
