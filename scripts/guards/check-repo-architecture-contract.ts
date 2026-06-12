#!/usr/bin/env tsx
/**
 * Repo architecture contract.
 *
 * This guard pins the monorepo/deployment decisions that are easy to erode:
 * app/package boundaries, generated client contracts, affected builds,
 * immutable Azure deployment by digest, and Linux as the active deployment path.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');

function read(relPath: string): string {
  return readFileSync(resolve(ROOT, relPath), 'utf8');
}

function exists(relPath: string): boolean {
  return existsSync(resolve(ROOT, relPath));
}

function has(source: string, pattern: RegExp | string): boolean {
  return typeof pattern === 'string' ? source.includes(pattern) : pattern.test(source);
}

const violations: string[] = [];

function requireFile(relPath: string): void {
  if (!exists(relPath)) violations.push(`${relPath}: required file is missing`);
}

function requireAbsent(relPath: string, reason: string): void {
  if (exists(relPath)) violations.push(`${relPath}: ${reason}`);
}

function requirePattern(relPath: string, pattern: RegExp | string, reason: string): void {
  if (!exists(relPath)) {
    violations.push(`${relPath}: required file is missing`);
    return;
  }
  const source = read(relPath);
  if (!has(source, pattern)) violations.push(`${relPath}: ${reason}`);
}

requireFile('scripts/guards/check-cross-project-boundary.ts');
requireFile('scripts/contracts/export-openapi.ts');
requireFile('scripts/ci/affected-workspaces.ts');
requireFile('scripts/release/create-release-manifest.mjs');
requireFile('scripts/guards/check-release-manifest-contract.ts');
requireFile('scripts/guards/check-linux-deployment-hardening-contract.ts');
requireFile('scripts/guards/check-llm-provider-boundary.ts');
requireFile('scripts/guards/check-ai-runtime-policy-contract.ts');
requireFile('scripts/guards/check-ai-model-governance-contract.ts');
requireFile('scripts/guards/check-ai-prompt-cache-smoke-contract.ts');
requireFile('scripts/guards/check-scribe-agentic-isolation.ts');
requireFile('packages/shared/src/generated/openapi.json');
requireFile('packages/shared/src/generated/openapi.ts');
requireFile('docs/architecture/repo-boundaries-and-release-standard.md');

requireAbsent(
  '.github/workflows/deploy.yml',
  'stale dry-run deploy workflow must stay removed; .github/workflows/azure-deploy.yml is canonical',
);

const workflowFiles = exists('.github/workflows')
  ? readdirSync(resolve(ROOT, '.github/workflows')).filter((name) => /\.ya?ml$/.test(name))
  : [];
if (!workflowFiles.includes('azure-deploy.yml')) {
  violations.push('.github/workflows/azure-deploy.yml: canonical Azure deployment workflow is missing');
}

const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
const scripts = packageJson.scripts ?? {};
const expectedScripts: Record<string, RegExp> = {
  'ci:affected-workspaces': /scripts\/ci\/affected-workspaces\.ts/,
  'contracts:generate': /scripts\/contracts\/export-openapi\.ts/,
  'release:manifest': /scripts\/release\/create-release-manifest\.mjs/,
  'guard:api-client-contracts': /contracts:generate.*git diff --exit-code packages\/shared\/src\/generated\/openapi\.json packages\/shared\/src\/generated\/openapi\.ts/,
  'guard:release-manifest-contract': /scripts\/guards\/check-release-manifest-contract\.ts/,
  'guard:linux-deployment-hardening-contract': /scripts\/guards\/check-linux-deployment-hardening-contract\.ts/,
  'guard:llm-provider-boundary': /scripts\/guards\/check-llm-provider-boundary\.ts/,
  'guard:ai-runtime-policy-contract': /scripts\/guards\/check-ai-runtime-policy-contract\.ts/,
  'guard:ai-model-governance-contract': /scripts\/guards\/check-ai-model-governance-contract\.ts/,
  'guard:ai-prompt-cache-smoke-contract': /scripts\/guards\/check-ai-prompt-cache-smoke-contract\.ts/,
  'guard:cross-project-boundary': /scripts\/guards\/check-cross-project-boundary\.ts/,
  'guard:repo-architecture-contract': /scripts\/guards\/check-repo-architecture-contract\.ts/,
  'guard:scribe-agentic-isolation': /scripts\/guards\/check-scribe-agentic-isolation\.ts/,
  'guard:architecture-boundaries': /guard:cross-project-boundary.*arch:depcruise.*guard:api-client-contracts.*guard:release-manifest-contract.*guard:repo-architecture-contract.*guard:llm-provider-boundary.*guard:ai-runtime-policy-contract.*guard:ai-model-governance-contract.*guard:ai-prompt-cache-smoke-contract.*guard:scribe-agentic-isolation.*guard:linux-deployment-hardening-contract/,
};

for (const [name, pattern] of Object.entries(expectedScripts)) {
  const script = scripts[name];
  if (!script) {
    violations.push(`package.json: missing script ${name}`);
  } else if (!pattern.test(script)) {
    violations.push(`package.json: script ${name} no longer matches the architecture contract`);
  }
}

const webPackageJson = JSON.parse(read('apps/web/package.json')) as { scripts?: Record<string, string> };
const webScripts = webPackageJson.scripts ?? {};
const expectedWebScripts: Record<string, RegExp> = {
  lint: /eslint src --ext \.ts,\.tsx/,
  build: /vite build/,
  test: /vitest run --config vitest\.config\.ts/,
};
for (const [name, pattern] of Object.entries(expectedWebScripts)) {
  const script = webScripts[name];
  if (!script) {
    violations.push(`apps/web/package.json: missing script ${name}`);
  } else if (!pattern.test(script)) {
    violations.push(`apps/web/package.json: script ${name} no longer matches the web workspace contract`);
  }
}

const discipline = scripts['guard:claude-discipline'] ?? '';
for (const required of ['guard:api-client-contracts', 'guard:release-manifest-contract', 'guard:cross-project-boundary', 'guard:repo-architecture-contract', 'guard:llm-provider-boundary', 'guard:scribe-agentic-isolation', 'guard:linux-deployment-hardening-contract']) {
  if (!discipline.includes(required)) {
    violations.push(`package.json: guard:claude-discipline must include ${required}`);
  }
}

requirePattern(
  'packages/shared/src/index.ts',
  "export * from './generated/openapi';",
  'shared package must export the generated OpenAPI contract',
);

const ci = exists('.github/workflows/ci.yml') ? read('.github/workflows/ci.yml') : '';
const ciChecks: Array<[RegExp | string, string]> = [
  [/affected-workspaces:/, 'CI must include an affected-workspace planning job'],
  ['npm run ci:affected-workspaces', 'CI must run the affected-workspace planner'],
  [/if: \$\{\{ needs\['affected-workspaces'\]\.outputs\.build_any == 'true' \}\}/, 'CI build job must be affected-gated'],
  [/needs\['affected-workspaces'\]\.outputs\.build_api == 'true'/, 'CI build job must selectively build the API'],
  [/needs\['affected-workspaces'\]\.outputs\.build_web == 'true'/, 'CI build job must selectively build the web app'],
  ['npm run guard:api-client-contracts', 'CI must guard generated API/client contracts'],
  ['npm run guard:repo-architecture-contract', 'CI must run this repo architecture contract guard'],
  ['npm run guard:cross-project-boundary', 'CI must enforce no illegal cross-project imports'],
  ['npm run arch:depcruise', 'CI must enforce dependency-cruiser layering rules'],
  ['generated-api-contracts-guard', 'CI gate must include generated API contract guard'],
  ['repo-architecture-contract-guard', 'CI gate must include repo architecture contract guard'],
];
for (const [pattern, reason] of ciChecks) {
  if (!has(ci, pattern)) violations.push(`.github/workflows/ci.yml: ${reason}`);
}

const azureDeploy = exists('.github/workflows/azure-deploy.yml') ? read('.github/workflows/azure-deploy.yml') : '';
const azureChecks: Array<[RegExp | string, string]> = [
  ['docker buildx imagetools inspect "$IMAGE"', 'deploy workflow must resolve pushed images to immutable digests'],
  ['api_image=$REPO@$DIGEST', 'API deploy output must be repo@digest'],
  ['web_image=$REPO@$DIGEST', 'web deploy output must be repo@digest'],
  ['Create immutable release manifest', 'deploy workflow must create a release manifest'],
  ['Upload immutable release manifest', 'deploy workflow must upload the release manifest artifact'],
  ['SIGNACARE_RELEASE_MANIFEST_SHA256', 'deploy workflow must stamp manifest checksum into runtime settings'],
  ['EXPECTED_SIGNACARE_RELEASE_MANIFEST_SHA256', 'deploy workflow must pass expected release metadata to smoke tests'],
  ['--docker-custom-image-name "$IMAGE"', 'App Service image selection must use the resolved digest output'],
  [/push:\s*\n\s*branches:\s*\n\s*- main/, 'staging deploy must remain wired to main branch pushes'],
  ['echo "slot=next"', 'staging deploy must use the non-prod next slot instead of direct live rollout'],
  ['Swap deployment slot into live site', 'deploy workflow must cut traffic by slot swap after slot proof'],
  ['Post-swap smoke test on live site', 'deploy workflow must re-prove the live site after swap'],
];
for (const [pattern, reason] of azureChecks) {
  if (!has(azureDeploy, pattern)) violations.push(`.github/workflows/azure-deploy.yml: ${reason}`);
}
if (/:latest\b/.test(azureDeploy)) {
  violations.push('.github/workflows/azure-deploy.yml: active deploy workflow must not use mutable latest tags');
}

requirePattern(
  'deploy/azure/README.md',
  'The active deployment lane is Linux App Service',
  'Azure README must declare Linux App Service as the active lane',
);
requirePattern(
  'deploy/azure/README.md',
  'The Windows VM lane is retained as legacy/reference only',
  'Azure README must mark Windows VM as legacy/reference only',
);
requirePattern(
  'deploy/azure/main-windows.bicep',
  'LEGACY / REFERENCE ONLY',
  'Windows VM Bicep must be clearly marked legacy/reference only',
);
requirePattern(
  'deploy/azure/windows-vm/README.md',
  'Legacy / reference only',
  'Windows VM README must be clearly marked legacy/reference only',
);
requirePattern(
  'docs/architecture/repo-boundaries-and-release-standard.md',
  'No raw cross-app imports',
  'architecture doc must state the raw cross-app import rule',
);
requirePattern(
  'docs/architecture/repo-boundaries-and-release-standard.md',
  'Deploy by digest',
  'architecture doc must state immutable digest deployment',
);
requirePattern(
  'docs/architecture/repo-boundaries-and-release-standard.md',
  'release-manifest.json',
  'architecture doc must state immutable release manifest deployment',
);

if (violations.length > 0) {
  console.error('Repo architecture contract failed:');
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

console.log('Repo architecture contract passed.');
