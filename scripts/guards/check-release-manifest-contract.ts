#!/usr/bin/env tsx
import { existsSync, readFileSync } from 'node:fs';
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

function requirePattern(relPath: string, pattern: RegExp | string, reason: string): void {
  if (!exists(relPath)) {
    violations.push(`${relPath}: required file is missing`);
    return;
  }
  if (!has(read(relPath), pattern)) violations.push(`${relPath}: ${reason}`);
}

requireFile('scripts/release/create-release-manifest.mjs');
requireFile('scripts/release/promote-release-manifest.mjs');
requireFile('apps/api/src/shared/releaseMetadata.ts');
requireFile('deploy/azure/check-release-drift.sh');
requireFile('.github/workflows/deployment-drift-audit.yml');

const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
const scripts = packageJson.scripts ?? {};
const expectedScripts: Record<string, RegExp> = {
  'release:manifest': /node scripts\/release\/create-release-manifest\.mjs/,
  'release:promote-manifest': /node scripts\/release\/promote-release-manifest\.mjs/,
  'release:drift-audit': /bash deploy\/azure\/check-release-drift\.sh/,
  'guard:release-manifest-contract': /scripts\/guards\/check-release-manifest-contract\.ts/,
};
for (const [name, pattern] of Object.entries(expectedScripts)) {
  const script = scripts[name];
  if (!script) {
    violations.push(`package.json: missing script ${name}`);
  } else if (!pattern.test(script)) {
    violations.push(`package.json: script ${name} no longer matches the release-manifest contract`);
  }
}

for (const required of ['guard:release-manifest-contract']) {
  if (!(scripts['guard:claude-discipline'] ?? '').includes(required)) {
    violations.push(`package.json: guard:claude-discipline must include ${required}`);
  }
  if (!(scripts['guard:architecture-boundaries'] ?? '').includes(required)) {
    violations.push(`package.json: guard:architecture-boundaries must include ${required}`);
  }
}

const manifestChecks: Array<[RegExp | string, string]> = [
  ['release-manifest.json', 'release manifest generator must write the canonical manifest filename'],
  ['release-manifest.json.sha256', 'release manifest generator must write a manifest checksum sidecar'],
  ['activePath: \'linux-app-service\'', 'manifest must pin Linux App Service as the active path'],
  ['imageArtifact(\'api\'', 'manifest must validate API image digest refs'],
  ['imageArtifact(\'web\'', 'manifest must validate web image digest refs'],
  ['aiRuntime', 'manifest must include AI runtime model metadata'],
  ['SIGNACARE_OLLAMA_MODEL_MANIFEST_SHA256', 'manifest must include the Ollama model manifest proof'],
  ['SIGNACARE_WHISPER_MODEL_SHA256', 'manifest must include the Whisper model checksum proof'],
  ['configContractSha256', 'manifest must include the env/config contract hash'],
  ['migrationHead', 'manifest must include the migration head'],
  ['openapiSha256', 'manifest must include the OpenAPI contract hash'],
  ['manual_break_glass', 'manifest must classify break-glass provenance explicitly'],
  ['promotableToProd', 'manifest must record whether a release can be promoted to prod'],
  ['nonPromotableReason', 'manifest must explain why a release is not promotable to prod'],
];
for (const [pattern, reason] of manifestChecks) {
  requirePattern('scripts/release/create-release-manifest.mjs', pattern, reason);
}

const promotionManifestChecks: Array<[RegExp | string, string]> = [
  ['staging-digest-import', 'promotion manifest must record the staging digest import strategy'],
  ['sourceReleaseManifestSha256', 'promotion manifest must record the source staging manifest hash'],
  ['promotedFromRef', 'promotion manifest must keep the source image ref provenance'],
  ['SIGNACARE_TARGET_ACR_NAME', 'promotion manifest must rewrite image refs to the target ACR'],
  ['SIGNACARE_EXPECTED_IMAGE_TAG', 'promotion manifest must require the reviewed staging image tag'],
  ['Only GitHub Actions-built staging manifests can be promoted to prod.', 'promotion manifest must reject break-glass staging manifests'],
  ['promotableToProd', 'promotion manifest must require explicit promotability metadata'],
  ['Azure Deploy', 'promotion manifest must require the canonical staging workflow provenance'],
];
for (const [pattern, reason] of promotionManifestChecks) {
  requirePattern('scripts/release/promote-release-manifest.mjs', pattern, reason);
}

const metadataKeys = [
  'SIGNACARE_RELEASE_MANIFEST_SHA256',
  'SIGNACARE_COMMIT_SHA',
  'SIGNACARE_PIPELINE_WORKFLOW',
  'SIGNACARE_PIPELINE_ORIGIN',
  'SIGNACARE_RELEASE_PROMOTABLE_TO_PROD',
  'SIGNACARE_RELEASE_NON_PROMOTABLE_REASON',
  'SIGNACARE_API_IMAGE_DIGEST',
  'SIGNACARE_WEB_IMAGE_DIGEST',
  'SIGNACARE_OLLAMA_MODEL',
  'SIGNACARE_OLLAMA_MODEL_MANIFEST_SHA256',
  'SIGNACARE_WHISPER_MODEL',
  'SIGNACARE_WHISPER_MODEL_SHA256',
  'SIGNACARE_OPENAPI_SHA256',
  'SIGNACARE_CONFIG_CONTRACT_SHA256',
  'SIGNACARE_MIGRATION_HEAD',
  'SIGNACARE_PROMOTION_SOURCE_RELEASE_MANIFEST_SHA256',
];
for (const key of metadataKeys) {
  requirePattern('apps/api/src/shared/releaseMetadata.ts', key, `runtime metadata must expose ${key}`);
}
requirePattern('apps/api/src/routes/health.ts', "router.get('/version'", 'API must expose /version for runtime release proof');
requirePattern('apps/api/src/routes/health.ts', 'readReleaseMetadata', '/health and /version must use the release metadata helper');

const workflowChecks: Array<[RegExp | string, string]> = [
  ['id-token: write', 'Azure deploy must use GitHub OIDC instead of long-lived Azure credentials'],
  ['AZURE_CLIENT_ID_DEFAULT', 'Azure deploy must declare the default OIDC client ID or an explicit override path'],
  ['client-id: ${{ secrets.AZURE_CLIENT_ID || vars.AZURE_CLIENT_ID || env.AZURE_CLIENT_ID_DEFAULT }}', 'Azure login must use the OIDC client-id input with override support'],
  ['Create immutable release manifest', 'Azure deploy must create the immutable release manifest'],
  ['Upload immutable release manifest', 'Azure deploy must upload the release manifest artifact'],
  ['node scripts/release/create-release-manifest.mjs', 'Azure deploy must use the canonical manifest generator'],
  ['SIGNACARE_RELEASE_MANIFEST_SHA256', 'Azure deploy must stamp manifest checksum into runtime settings'],
  ['SIGNACARE_PIPELINE_WORKFLOW', 'Azure deploy must stamp workflow provenance into runtime settings'],
  ['SIGNACARE_PIPELINE_ORIGIN', 'Azure deploy must stamp pipeline origin into runtime settings'],
  ['SIGNACARE_RELEASE_PROMOTABLE_TO_PROD', 'Azure deploy must stamp release promotability into runtime settings'],
  ['SIGNACARE_API_IMAGE_DIGEST', 'Azure deploy must stamp API image digest into runtime settings'],
  ['SIGNACARE_WEB_IMAGE_DIGEST', 'Azure deploy must stamp web image digest into runtime settings'],
  ['SIGNACARE_OLLAMA_MODEL_MANIFEST_SHA256', 'Azure deploy must stamp Ollama model manifest proof into runtime settings'],
  ['SIGNACARE_WHISPER_MODEL_SHA256', 'Azure deploy must stamp Whisper model checksum proof into runtime settings'],
  ['EXPECTED_SIGNACARE_RELEASE_MANIFEST_SHA256', 'Azure deploy must pass expected manifest checksum into smoke tests'],
  ['EXPECTED_SIGNACARE_OLLAMA_MODEL', 'Azure deploy must pass expected Ollama model metadata into smoke tests'],
  ['EXPECTED_SIGNACARE_WHISPER_MODEL_SHA256', 'Azure deploy must pass expected Whisper model metadata into smoke tests'],
  ['staging_run_id', 'Prod deploy must require the reviewed staging workflow run ID'],
  ['staging_image_tag', 'Prod deploy must require the reviewed staging image tag'],
  ['Download reviewed staging release manifest', 'Prod deploy must download the reviewed staging manifest artifact'],
  ['Downloaded staging release manifest checksum mismatch', 'Prod deploy must verify the downloaded staging manifest checksum before promotion'],
  ['az acr import', 'Prod deploy must import exact staging digests into the production ACR'],
  ['node scripts/release/promote-release-manifest.mjs', 'Prod deploy must create a production promotion manifest'],
  ['SIGNACARE_PROMOTION_SOURCE_RELEASE_MANIFEST_SHA256', 'Azure deploy must stamp promotion source manifest hash into runtime settings'],
  ['EXPECTED_SIGNACARE_PROMOTION_SOURCE_RELEASE_MANIFEST_SHA256', 'Azure smoke tests must verify promotion source manifest hash'],
  ['SMOKE_REQUIRE_AUTHENTICATED_CHECKS', 'Azure smoke tests must make authenticated clinical probes explicitly required or optional'],
  ['az webapp config appsettings set', 'Azure deploy must set runtime release metadata through App Service settings'],
  ['echo "slot=next"', 'Staging deploy must use the non-prod next slot for blue-green rollout'],
  ['Validate deployment slot topology', 'Azure deploy must fail closed when the expected deployment slot is missing'],
  ['Smoke test deployment slot', 'Azure deploy must prove the release on the deployment slot before cutover'],
  ['Swap deployment slot into live site', 'Azure deploy must swap the verified slot into the live site'],
  ['Post-swap smoke test on live site', 'Azure deploy must re-prove the live site after slot swap'],
];
for (const [pattern, reason] of workflowChecks) {
  requirePattern('.github/workflows/azure-deploy.yml', pattern, reason);
}

if (/:latest\b/.test(read('.github/workflows/azure-deploy.yml'))) {
  violations.push('.github/workflows/azure-deploy.yml: Linux deploy must not use mutable latest tags');
}
if (/AZURE_CREDENTIALS/.test(read('.github/workflows/azure-deploy.yml'))) {
  violations.push('.github/workflows/azure-deploy.yml: Azure deploy must not use long-lived AZURE_CREDENTIALS; use GitHub OIDC');
}

const smokeChecks: Array<[RegExp | string, string]> = [
  ['check_release_version', 'post-deploy smoke must verify /version'],
  ['$API/version', 'post-deploy smoke must call the runtime /version endpoint'],
  ['EXPECTED_SIGNACARE_RELEASE_MANIFEST_SHA256', 'post-deploy smoke must compare manifest checksum'],
  ['EXPECTED_SIGNACARE_PIPELINE_WORKFLOW', 'post-deploy smoke must compare workflow provenance'],
  ['EXPECTED_SIGNACARE_PIPELINE_ORIGIN', 'post-deploy smoke must compare pipeline origin'],
  ['EXPECTED_SIGNACARE_RELEASE_PROMOTABLE_TO_PROD', 'post-deploy smoke must compare release promotability'],
  ['EXPECTED_SIGNACARE_API_IMAGE_DIGEST', 'post-deploy smoke must compare API image digest'],
  ['EXPECTED_SIGNACARE_WEB_IMAGE_DIGEST', 'post-deploy smoke must compare web image digest'],
  ['EXPECTED_SIGNACARE_OLLAMA_MODEL', 'post-deploy smoke must compare Ollama model metadata'],
  ['EXPECTED_SIGNACARE_WHISPER_MODEL_SHA256', 'post-deploy smoke must compare Whisper model metadata'],
  ['EXPECTED_SIGNACARE_PROMOTION_SOURCE_RELEASE_MANIFEST_SHA256', 'post-deploy smoke must compare prod promotion provenance when present'],
  ['authenticated_smoke_required', 'post-deploy smoke must centralize the authenticated-smoke requirement policy'],
];
for (const [pattern, reason] of smokeChecks) {
  requirePattern('deploy/azure/post-deploy-smoke.sh', pattern, reason);
}

const driftAuditChecks: Array<[RegExp | string, string]> = [
  ['API /version returned', 'drift audit must read API /version as the runtime truth source'],
  ['siteConfig.linuxFxVersion', 'drift audit must compare App Service linuxFxVersion against /version digests'],
  ['SIGNACARE_RELEASE_MANIFEST_SHA256', 'drift audit must verify stamped release metadata'],
  ['SIGNACARE_PIPELINE_ORIGIN', 'drift audit must verify stamped pipeline provenance'],
  ['SIGNACARE_RELEASE_PROMOTABLE_TO_PROD', 'drift audit must verify stamped release promotability'],
  ['EXPECT_AZURE_OPENAI', 'drift audit must be able to enforce Azure OpenAI env-contract presence'],
  ['EXPECT_AI_RUNTIME', 'drift audit must be able to enforce AI runtime digest parity'],
];
for (const [pattern, reason] of driftAuditChecks) {
  requirePattern('deploy/azure/check-release-drift.sh', pattern, reason);
}

const driftWorkflowChecks: Array<[RegExp | string, string]> = [
  ['name: Deployment Drift Audit', 'deployment drift audit workflow must exist'],
  ["cron: '0 3 * * *'", 'deployment drift audit must run on a schedule'],
  ['workflow_dispatch', 'deployment drift audit must support manual runs'],
  ['bash deploy/azure/check-release-drift.sh', 'deployment drift audit workflow must call the canonical drift checker'],
];
for (const [pattern, reason] of driftWorkflowChecks) {
  requirePattern('.github/workflows/deployment-drift-audit.yml', pattern, reason);
}

requirePattern(
  'docs/architecture/repo-boundaries-and-release-standard.md',
  'release-manifest.json',
  'release standard must document the immutable release manifest',
);
requirePattern(
  'docs/architecture/repo-boundaries-and-release-standard.md',
  '/version',
  'release standard must document runtime version proof',
);
requirePattern(
  'docs/architecture/repo-boundaries-and-release-standard.md',
  'manual_break_glass',
  'release standard must document non-promotable break-glass staging manifests',
);
requirePattern(
  'docs/architecture/repo-boundaries-and-release-standard.md',
  'deployment-drift-audit.yml',
  'release standard must document the scheduled deployment drift audit',
);

if (violations.length > 0) {
  console.error('Release manifest contract failed:');
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

console.log('Release manifest contract passed.');
