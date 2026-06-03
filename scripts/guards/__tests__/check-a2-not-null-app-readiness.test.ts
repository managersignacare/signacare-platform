import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TMP_BASE = join(tmpdir(), 'check-a2-not-null-app-readiness-fixtures');
const SCRIPT = join(process.cwd(), 'scripts', 'guards', 'check-a2-not-null-app-readiness.ts');

beforeAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
  mkdirSync(TMP_BASE, { recursive: true });
});

afterAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
});

function writeFixture(
  name: string,
  statuses: { bug315: 'pending' | 'verified'; bug334: 'pending' | 'verified' },
  source: {
    llm: string;
    patient: string;
    repo: string;
    clinicService: string;
    provisioning: string;
    clinicSchema: string;
  },
): { manifestPath: string; env: Record<string, string> } {
  const dir = join(TMP_BASE, name);
  mkdirSync(dir, { recursive: true });

  const manifestPath = join(dir, 'manifest.json');
  const manifest = {
    version: 1,
    lane: 'A2',
    slice: 'A2-2',
    targets: [
      {
        bugId: 'BUG-315',
        appReadinessStatus: statuses.bug315,
        appReadinessEvidence: 'fixture',
      },
      {
        bugId: 'BUG-334',
        appReadinessStatus: statuses.bug334,
        appReadinessEvidence: 'fixture',
      },
    ],
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const llmPath = join(dir, 'llmRoutes.ts');
  const patientPath = join(dir, 'patientRoutes.ts');
  const repoPath = join(dir, 'clinicalNote.repository.ts');
  const clinicServicePath = join(dir, 'clinicService.ts');
  const provisioningPath = join(dir, 'provisioningService.ts');
  const clinicSchemaPath = join(dir, 'clinic.schemas.ts');

  writeFileSync(llmPath, source.llm, 'utf8');
  writeFileSync(patientPath, source.patient, 'utf8');
  writeFileSync(repoPath, source.repo, 'utf8');
  writeFileSync(clinicServicePath, source.clinicService, 'utf8');
  writeFileSync(provisioningPath, source.provisioning, 'utf8');
  writeFileSync(clinicSchemaPath, source.clinicSchema, 'utf8');

  return {
    manifestPath,
    env: {
      A2_APP_READINESS_LLM_ROUTES_PATH: llmPath,
      A2_APP_READINESS_PATIENT_ROUTES_PATH: patientPath,
      A2_APP_READINESS_CLINICAL_NOTE_REPO_PATH: repoPath,
      A2_APP_READINESS_CLINIC_SERVICE_PATH: clinicServicePath,
      A2_APP_READINESS_PROVISIONING_SERVICE_PATH: provisioningPath,
      A2_APP_READINESS_CLINIC_SCHEMA_PATH: clinicSchemaPath,
    },
  };
}

function runGuard(manifestPath: string, env: Record<string, string>): { ok: boolean; output: string } {
  try {
    const output = execFileSync(
      'npx',
      ['tsx', SCRIPT, manifestPath],
      {
        cwd: process.cwd(),
        env: { ...process.env, ...env },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    return { ok: true, output };
  } catch (error) {
    const stdout = error instanceof Error && 'stdout' in error ? String((error as { stdout?: string }).stdout ?? '') : '';
    const stderr = error instanceof Error && 'stderr' in error ? String((error as { stderr?: string }).stderr ?? '') : '';
    return { ok: false, output: `${stdout}\n${stderr}` };
  }
}

describe('check-a2-not-null-app-readiness', () => {
  const blockerSource = {
    llm: "const x = { consent_id: dto.consentId };",
    patient: "router.post('/:id/notes', async () => { await db('clinical_notes').insert({ title: 'n' }).returning(CLINICAL_NOTE_COLUMNS); });",
    repo: "async create() { await db('clinical_notes').insert({ note_type: 'soap' }).returning('id'); return note; }",
    clinicService:
      "const create = { hpio: dto.hpio ?? null }; if (dto.hpio !== undefined) patch.hpio = dto.hpio;",
    provisioning: "await trx('clinics').insert({ id: clinicId, name: dto.clinicName });",
    clinicSchema:
      "const HPIO_FORMAT = /^800362\\d{10}$/; export const ClinicCreateSchema = z.object({ hpio: z.string().regex(HPIO_FORMAT).nullable().optional() });",
  };

  const readySource = {
    llm: "const x = { consent_id: dto.consentId };",
    patient: "router.post('/:id/notes', async () => { await db('clinical_notes').insert({ consent_id: dto.consentId }).returning(CLINICAL_NOTE_COLUMNS); });",
    repo: "async create() { await db('clinical_notes').insert({ consent_id: consentId }).returning('id'); return note; }",
    clinicService:
      "const create = { hpio: dto.hpio }; if (dto.hpio !== undefined) patch.timezone = dto.timeZone;",
    provisioning: "await trx('clinics').insert({ id: clinicId, name: dto.clinicName, hpio: dto.hpio });",
    clinicSchema:
      "const HPIO_FORMAT = /^800362\\d{10}$/; export const ClinicCreateSchema = z.object({ hpio: z.string().regex(HPIO_FORMAT) });",
  };

  it('passes when statuses are pending and blockers still exist', () => {
    const fx = writeFixture('pending-with-blockers', { bug315: 'pending', bug334: 'pending' }, blockerSource);
    const res = runGuard(fx.manifestPath, fx.env);
    expect(res.ok).toBe(true);
    expect(res.output).toContain('BUG-315: blockers=');
    expect(res.output).toContain('BUG-334: blockers=');
  });

  it('fails when manifest marks verified while blockers still exist', () => {
    const fx = writeFixture('verified-with-blockers', { bug315: 'verified', bug334: 'verified' }, blockerSource);
    const res = runGuard(fx.manifestPath, fx.env);
    expect(res.ok).toBe(false);
    expect(res.output).toContain('marked verified but still has app-contract blockers');
  });

  it('fails when pending status remains after blockers are removed', () => {
    const fx = writeFixture('pending-without-blockers', { bug315: 'pending', bug334: 'pending' }, readySource);
    const res = runGuard(fx.manifestPath, fx.env);
    expect(res.ok).toBe(false);
    expect(res.output).toContain('has no app-contract blockers; manifest should promote to verified');
  });

  it('treats BUG-334 as ready when hpio is required even if later fields remain nullable/optional', () => {
    const bug334ReadyWithTrailingNullableFields = {
      llm: blockerSource.llm,
      patient: blockerSource.patient,
      repo: blockerSource.repo,
      clinicService:
        "const create = { hpio: dto.hpio }; if (typeof dto.hpio === 'string') patch.hpio = dto.hpio;",
      provisioning: "await trx('clinics').insert({ id: clinicId, name: dto.clinicName, hpio: dto.hpio });",
      clinicSchema:
        "const HPIO_FORMAT = /^800362\\d{10}$/; export const ClinicCreateSchema = z.object({ hpio: z.string().regex(HPIO_FORMAT), npdsConformanceId: z.string().min(1).max(100).nullable().optional() }); export type ClinicCreateDTO = z.infer<typeof ClinicCreateSchema>;",
    };
    const fx = writeFixture(
      'bug334-ready-with-nulls-after-hpio',
      { bug315: 'pending', bug334: 'verified' },
      bug334ReadyWithTrailingNullableFields,
    );
    const res = runGuard(fx.manifestPath, fx.env);
    expect(res.ok).toBe(true);
    expect(res.output).toContain('BUG-334: blockers=0');
  });
});
