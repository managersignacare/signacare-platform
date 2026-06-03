#!/usr/bin/env tsx
/**
 * scripts/guards/check-migration-source-consistency.ts
 *
 * Why this exists:
 * - Migrations are authored under `apps/api/migrations/*.ts`.
 * - Compiled runtime can execute `apps/api/dist/migrations/*.js`.
 * - If source and build conventions drift (mixed extensions in source, or
 *   tsconfig build include pinning old prefixes), migrations can silently skip.
 *
 * Structural enforcement:
 * 1) Source migration directory must contain ONLY `.ts` files.
 * 2) API build config must include all migration TS files recursively
 *    (not a pinned subset by date prefix).
 * 3) CI/deploy workflows must run `migrate:dev` explicitly.
 *
 * Run:
 *   npm run guard:migration-source-consistency
 */

import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SOURCE_MIGRATIONS_DIR = path.join(REPO_ROOT, 'apps', 'api', 'migrations');
const DIST_MIGRATIONS_DIR = path.join(REPO_ROOT, 'apps', 'api', 'dist', 'migrations');
const API_TSCONFIG_BUILD = path.join(REPO_ROOT, 'apps', 'api', 'tsconfig.build.json');
const WORKFLOW_FILES = [
  path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml'),
  path.join(REPO_ROOT, '.github', 'workflows', 'deploy.yml'),
];

interface Violation {
  file: string;
  detail: string;
}

function readFileSafe(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    throw new Error(`required file not found: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function listFilesSafe(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath)
    .filter((entry) => fs.statSync(path.join(dirPath, entry)).isFile())
    .sort();
}

function main(): void {
  const violations: Violation[] = [];

  const sourceMigrationFiles = listFilesSafe(SOURCE_MIGRATIONS_DIR);
  if (sourceMigrationFiles.length === 0) {
    violations.push({
      file: path.relative(REPO_ROOT, SOURCE_MIGRATIONS_DIR),
      detail: 'source migrations directory is empty; expected at least one .ts migration',
    });
  }
  for (const file of sourceMigrationFiles) {
    if (path.extname(file) !== '.ts') {
      violations.push({
        file: path.relative(REPO_ROOT, path.join(SOURCE_MIGRATIONS_DIR, file)),
        detail: 'non-.ts file found in source migrations directory',
      });
    }
  }

  const tsconfigBuildRaw = readFileSafe(API_TSCONFIG_BUILD);
  const hasBroadMigrationInclude = /["']migrations\/\*\*\/\*\.ts["']/.test(tsconfigBuildRaw);
  if (!hasBroadMigrationInclude) {
    violations.push({
      file: path.relative(REPO_ROOT, API_TSCONFIG_BUILD),
      detail: 'missing include pattern "migrations/**/*.ts"',
    });
  }
  if (/migrations\/202604\*\.ts/.test(tsconfigBuildRaw)) {
    violations.push({
      file: path.relative(REPO_ROOT, API_TSCONFIG_BUILD),
      detail: 'legacy pinned include "migrations/202604*.ts" detected; causes build-time migration drift',
    });
  }

  for (const workflowFile of WORKFLOW_FILES) {
    const workflowRaw = readFileSafe(workflowFile);
    if (!workflowRaw.includes('npm run migrate:dev --workspace=apps/api')) {
      violations.push({
        file: path.relative(REPO_ROOT, workflowFile),
        detail: 'expected explicit "npm run migrate:dev --workspace=apps/api" step',
      });
    }
    if (/npm run migrate\s+--workspace=apps\/api/.test(workflowRaw)) {
      violations.push({
        file: path.relative(REPO_ROOT, workflowFile),
        detail: 'found "npm run migrate --workspace=apps/api"; workflow must use migrate:dev',
      });
    }
  }

  const distMigrationFiles = listFilesSafe(DIST_MIGRATIONS_DIR);
  const distJsCount = distMigrationFiles.filter((file) => file.endsWith('.js')).length;
  const distMapCount = distMigrationFiles.filter((file) => file.endsWith('.js.map')).length;

  console.log('→ check-migration-source-consistency');
  console.log(`  source migration files (.ts expected): ${sourceMigrationFiles.length}`);
  console.log(`  dist migration js artifacts:           ${distJsCount}`);
  console.log(`  dist migration sourcemaps:             ${distMapCount}`);

  if (violations.length > 0) {
    console.error(`  violations: ${violations.length}`);
    for (const violation of violations) {
      console.error(`  - ${violation.file}: ${violation.detail}`);
    }
    process.exit(1);
  }

  console.log('✓ migration source/build/workflow consistency holds.');
}

main();
