#!/usr/bin/env node

import { buildOwnershipReport, loadSplitManifests, validateManifestShape } from './lib/manifests.mjs';

const manifests = loadSplitManifests();
const repoNames = new Set();
let hasFailure = false;

for (const manifest of manifests) {
  const errors = validateManifestShape(manifest);
  if (repoNames.has(manifest.repoName)) {
    errors.push(`duplicate repoName '${manifest.repoName}'`);
  }
  repoNames.add(manifest.repoName);

  if (errors.length > 0) {
    hasFailure = true;
    console.error(`Manifest invalid: ${manifest.absolutePath}`);
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
  }
}

const report = buildOwnershipReport(manifests);

if (report.conflicts.length > 0) {
  hasFailure = true;
  console.error('\nOwnership conflicts detected:');
  for (const conflict of report.conflicts) {
    console.error(`  - ${conflict.path} -> ${conflict.owners.join(', ')}`);
  }
}

if (hasFailure) {
  process.exit(1);
}

console.log('repo-split manifest check passed.');
console.log(`  manifests:     ${manifests.length}`);
console.log(`  files scanned: ${report.filesScanned}`);
for (const manifest of manifests) {
  const ownedFiles = report.ownership.get(manifest.repoName) ?? [];
  console.log(`  ${manifest.repoName}: ${ownedFiles.length} file(s)`);
}
