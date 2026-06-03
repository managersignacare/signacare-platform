#!/usr/bin/env tsx
/**
 * A2-2 Phase B / BUG-315 + BUG-334:
 * validate app/API contract readiness posture for NOT NULL promotion.
 *
 * This guard does NOT require readiness to be green today. It enforces
 * honest status transitions:
 * - if manifest says appReadinessStatus=verified, blockers must be gone.
 * - if blockers are gone, manifest cannot stay pending.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type AppReadinessStatus = 'pending' | 'verified';

interface ReadinessTarget {
  bugId: string;
  appReadinessStatus: AppReadinessStatus;
  appReadinessEvidence: string;
}

interface ReadinessManifest {
  version: number;
  lane: string;
  slice: string;
  targets: ReadinessTarget[];
}

interface TargetReport {
  bugId: string;
  blockers: string[];
}

const ROOT = resolve(__dirname, '..', '..');
const DEFAULT_MANIFEST = resolve(ROOT, '.github', 'a2-not-null-readiness.json');

const PATHS = {
  llmRoutes: process.env.A2_APP_READINESS_LLM_ROUTES_PATH
    ? resolve(ROOT, process.env.A2_APP_READINESS_LLM_ROUTES_PATH)
    : resolve(ROOT, 'apps/api/src/features/llm/llmRoutes.ts'),
  patientRoutes: process.env.A2_APP_READINESS_PATIENT_ROUTES_PATH
    ? resolve(ROOT, process.env.A2_APP_READINESS_PATIENT_ROUTES_PATH)
    : resolve(ROOT, 'apps/api/src/features/patients/patientRoutes.ts'),
  clinicalNoteRepo: process.env.A2_APP_READINESS_CLINICAL_NOTE_REPO_PATH
    ? resolve(ROOT, process.env.A2_APP_READINESS_CLINICAL_NOTE_REPO_PATH)
    : resolve(ROOT, 'apps/api/src/features/clinical-notes/clinicalNote.repository.ts'),
  clinicService: process.env.A2_APP_READINESS_CLINIC_SERVICE_PATH
    ? resolve(ROOT, process.env.A2_APP_READINESS_CLINIC_SERVICE_PATH)
    : resolve(ROOT, 'apps/api/src/features/clinic/clinicService.ts'),
  provisioningService: process.env.A2_APP_READINESS_PROVISIONING_SERVICE_PATH
    ? resolve(ROOT, process.env.A2_APP_READINESS_PROVISIONING_SERVICE_PATH)
    : resolve(ROOT, 'apps/api/src/features/provisioning/provisioningService.ts'),
  clinicSchema: process.env.A2_APP_READINESS_CLINIC_SCHEMA_PATH
    ? resolve(ROOT, process.env.A2_APP_READINESS_CLINIC_SCHEMA_PATH)
    : resolve(ROOT, 'packages/shared/src/clinic.schemas.ts'),
};

function capture(source: string, re: RegExp): string | null {
  const m = source.match(re);
  return m ? m[0] : null;
}

function buildBug315Report(): TargetReport {
  const blockers: string[] = [];
  const llmRoutes = readFileSync(PATHS.llmRoutes, 'utf8');
  const patientRoutes = readFileSync(PATHS.patientRoutes, 'utf8');
  const clinicalNoteRepo = readFileSync(PATHS.clinicalNoteRepo, 'utf8');

  if (!/consent_id:\s*dto\.consentId/.test(llmRoutes)) {
    blockers.push('ambient-note save path is missing explicit consent_id write (llmRoutes)');
  }

  const patientNoteInserts = [...patientRoutes.matchAll(/db\('clinical_notes'\)\.insert\(\{[\s\S]*?\}\)/g)].map(
    (m) => m[0],
  );
  if (patientNoteInserts.length === 0) {
    blockers.push('unable to locate clinical_notes inserts in patientRoutes');
  }
  patientNoteInserts.forEach((block, i) => {
    if (!/consent_id\s*:/.test(block)) {
      blockers.push(`patientRoutes clinical_notes insert #${i + 1} does not write consent_id`);
      return;
    }
    if (/consent_id\s*:\s*null\b/.test(block) || /consent_id\s*:[^,\n}]+\?\?\s*null/.test(block)) {
      blockers.push(`patientRoutes clinical_notes insert #${i + 1} permits null consent_id fallback`);
    }
  });

  const primaryPatientCreateBlock = capture(
    patientRoutes,
    /router\.post\('\/:id\/notes'[\s\S]*?\.returning\(CLINICAL_NOTE_COLUMNS\);/,
  );
  if (!primaryPatientCreateBlock) {
    blockers.push('unable to locate patients/:id/notes primary insert block');
  } else if (!/consent_id\s*:/.test(primaryPatientCreateBlock)) {
    blockers.push('patients/:id/notes insert does not write consent_id');
  }

  const repoCreateInsert = capture(
    clinicalNoteRepo,
    /db\('clinical_notes'\)\s*\.insert\(\{[\s\S]*?\}\)\s*\.returning\('id'\)/,
  );
  if (!repoCreateInsert) {
    blockers.push('unable to locate clinicalNote.repository create insert block');
  } else if (!/consent_id\s*:/.test(repoCreateInsert)) {
    blockers.push('clinicalNote.repository create insert does not write consent_id');
  } else if (/consent_id\s*:\s*null\b/.test(repoCreateInsert) || /consent_id\s*:[^,\n}]+\?\?\s*null/.test(repoCreateInsert)) {
    blockers.push('clinicalNote.repository create insert permits null consent_id fallback');
  }

  return { bugId: 'BUG-315', blockers };
}

function buildBug334Report(): TargetReport {
  const blockers: string[] = [];
  const clinicService = readFileSync(PATHS.clinicService, 'utf8');
  const provisioningService = readFileSync(PATHS.provisioningService, 'utf8');
  const clinicSchema = readFileSync(PATHS.clinicSchema, 'utf8');

  if (/hpio:\s*dto\.hpio\s*\?\?\s*null/.test(clinicService)) {
    blockers.push('clinicService.createClinic allows null hpio writes (dto.hpio ?? null)');
  }

  if (/if\s*\(\s*dto\.hpio\s*!==\s*undefined\s*\)\s*patch\.hpio\s*=\s*dto\.hpio;/.test(clinicService)) {
    blockers.push('clinicService.updateClinic keeps hpio optional/nullable');
  }

  const provisioningInsert = capture(
    provisioningService,
    /await trx\('clinics'\)\.insert\(\{[\s\S]*?\}\);/,
  );
  if (!provisioningInsert) {
    blockers.push('unable to locate provisioning clinics insert block');
  } else if (!/hpio\s*:/.test(provisioningInsert)) {
    blockers.push('provisioningService clinic insert omits hpio');
  }

  const clinicCreateSchemaBlock = capture(
    clinicSchema,
    /export const ClinicCreateSchema[\s\S]*?export type ClinicCreateDTO/,
  );
  if (!clinicCreateSchemaBlock) {
    blockers.push('unable to locate ClinicCreateSchema block');
  } else {
    const hpioProperty = capture(clinicCreateSchemaBlock, /hpio:\s*[^,]+,/);
    if (!hpioProperty) {
      blockers.push('ClinicCreateSchema is missing hpio contract');
    } else if (/\.nullable\(\)\.optional\(\)/.test(hpioProperty)) {
      blockers.push('ClinicCreateSchema keeps hpio nullable/optional');
    }
  }

  return { bugId: 'BUG-334', blockers };
}

function main(): number {
  const manifestPath = process.argv[2] ? resolve(ROOT, process.argv[2]) : DEFAULT_MANIFEST;
  const violations: string[] = [];

  let manifest: ReadinessManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ReadinessManifest;
  } catch (error) {
    console.error(`✗ failed to load manifest ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  if (manifest.version !== 1) violations.push('manifest version must be 1');
  if (manifest.lane !== 'A2') violations.push('manifest lane must be A2');
  if (manifest.slice !== 'A2-2') violations.push('manifest slice must be A2-2');

  const reports = [buildBug315Report(), buildBug334Report()];

  for (const report of reports) {
    const target = manifest.targets.find((t) => t.bugId === report.bugId);
    if (!target) {
      violations.push(`manifest missing target ${report.bugId}`);
      continue;
    }

    const hasBlockers = report.blockers.length > 0;
    if (target.appReadinessStatus === 'verified' && hasBlockers) {
      violations.push(`${report.bugId} marked verified but still has app-contract blockers`);
    }
    if (target.appReadinessStatus === 'pending' && !hasBlockers) {
      violations.push(`${report.bugId} has no app-contract blockers; manifest should promote to verified`);
    }
  }

  if (violations.length > 0) {
    console.error('✗ check-a2-not-null-app-readiness');
    for (const v of violations) {
      console.error(`  - ${v}`);
    }
    return 1;
  }

  console.log('✓ check-a2-not-null-app-readiness');
  console.log(`  manifest: ${manifestPath}`);
  for (const report of reports) {
    console.log(`  ${report.bugId}: blockers=${report.blockers.length}`);
    for (const blocker of report.blockers) {
      console.log(`    - ${blocker}`);
    }
  }
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}
