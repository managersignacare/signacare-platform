/* PR-R1-19 vitest fixture suite. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGuard } from '../check-controller-repo-write-bypass';

const TMP_BASE = join(tmpdir(), 'pr-r1-19-fixtures');

beforeAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
  mkdirSync(TMP_BASE, { recursive: true });
});

afterAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
});

const SNAPSHOT = JSON.stringify({
  generatedAt: '2026-05-01',
  database: 'test',
  tables: { foo: ['id'] },
  foreignKeys: {},
}, null, 2);

function writeFixture(name: string, fileName: string, content: string): {
  snapshotPath: string;
  allowlistPath: string;
  scanRoot: string;
} {
  const dir = join(TMP_BASE, name);
  mkdirSync(dir, { recursive: true });
  const scanRoot = join(dir, 'features');
  mkdirSync(join(scanRoot, 'foo'), { recursive: true });
  const snapshotPath = join(dir, 'snapshot.json');
  const allowlistPath = join(dir, 'allowlist.txt');
  writeFileSync(snapshotPath, SNAPSHOT, 'utf-8');
  writeFileSync(allowlistPath, '', 'utf-8');
  writeFileSync(join(scanRoot, 'foo', fileName), content, 'utf-8');
  return { snapshotPath, allowlistPath, scanRoot };
}

describe('runGuard — controller-repo-write-bypass', () => {
  it('REJECTs Routes.ts calling fooRepository.update', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'routes_update',
      'fooRoutes.ts',
      `await fooRepository.update(clinicId, id, { name: 'x' });`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(1);
    expect(r.violations[0]!.method).toBe('update');
  });

  it('REJECTs Controller.ts calling fooRepo.create', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'controller_create',
      'fooController.ts',
      `const row = await fooRepo.create(clinicId, dto);`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(1);
    expect(r.violations[0]!.method).toBe('create');
  });

  it('REJECTs softDelete + delete + del + insert + upsert + setMfaSecret', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'multi_writes',
      'multiRoutes.ts',
      `await fooRepository.softDelete(id);
await barRepository.delete(id);
await bazRepository.del(id);
await quxRepository.insert(dto);
await zazRepository.upsert(dto);
await staffRepository.setMfaSecret(staffId, secret);`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(1);
    expect(r.violations).toHaveLength(6);
  });

  it('PASSES read-side calls (find/get/list/count/search)', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'read_side',
      'fooRoutes.ts',
      `const row = await fooRepository.findById(id);
const list = await fooRepository.listByPatient(patientId);
const count = await fooRepository.countActive();
const result = await fooRepository.searchByName('x');
const got = await fooRepository.getById(id);`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(0);
    expect(r.counts.validatedReadCalls).toBe(5);
  });

  it('SKIPs Service.ts files (out of scope)', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'service_file',
      'fooService.ts',
      `// Service files SHOULD call repo writes — they are the canonical layer
await fooRepository.update(clinicId, id, dto);`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(0);
  });

  it('honours @repo-write-bypass-exempt', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'inline_exempt',
      'fooRoutes.ts',
      `// @repo-write-bypass-exempt: admin-only background-job seeding; no user authz applicable
await fooRepository.create(dto);`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(0);
    expect(r.counts.skippedExempt).toBe(1);
  });

  it('rejects when snapshot is missing', () => {
    const dir = join(TMP_BASE, 'no_snapshot');
    mkdirSync(dir, { recursive: true });
    const r = runGuard({
      snapshotPath: join(dir, 'nonexistent.json'),
      allowlistPath: join(dir, 'allowlist.txt'),
      scanRoot: dir,
    });
    expect(r.exitCode).toBe(2);
  });

  it('mutation-resistance: removing isWriteMethod fails this fixture', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'mut_write_detect',
      'fooRoutes.ts',
      `await fooRepository.update(id, dto);`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.violations).toHaveLength(1);
  });

  it('matches Repo (short suffix) as well as Repository', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'repo_short',
      'fooRoutes.ts',
      `await fooRepo.create(dto);`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(1);
    expect(r.violations[0]!.repoIdent).toBe('fooRepo');
  });
});
