import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  buildMasterLoginMarkdown,
  runMasterLoginStep,
} from '../src/seed-good-health/generators/05_master_login_table';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'seed-gh-login-'));
});

describe('seed-good-health generator 05: master login table', () => {
  it('markdown contains the fictional-demo warning header', async () => {
    const md = await buildMasterLoginMarkdown();
    expect(md).toContain('FICTIONAL DEMO DATA');
    expect(md).toContain('# Good Health — Master Login Table');
    expect(md).toContain('SUPERADMIN_ALLOWED_EMAIL_DOMAINS');
    expect(md).toContain('admin@signacare.local');
  });

  it('markdown reports the exact total persona count', async () => {
    const md = await buildMasterLoginMarkdown();
    // 5 executive + 1 demo-shortcut admin + 7 dept heads + 84 clinic staff/superadmins = 97
    expect(md).toContain('**Total personas:** 97');
  });

  it('markdown lists every section header the operator expects', async () => {
    const md = await buildMasterLoginMarkdown();
    expect(md).toContain('## Demo-Shortcut Logins');
    expect(md).toContain('## Executive & Corporate');
    expect(md).toContain('## Department Heads');
    expect(md).toContain('## Clinic Staff & Superadmins (by clinic)');
  });

  it('demo-shortcut section pins admin@signacare.local / Password1! verbatim', async () => {
    const md = await buildMasterLoginMarkdown();
    expect(md).toContain(
      '| admin@signacare.local | `Password1!` | superadmin | executive | Demo Admin (Shortcut Login) |',
    );
  });

  it('markdown contains one sub-section per mental-health clinic', async () => {
    const md = await buildMasterLoginMarkdown();
    expect(md).toContain('### northern — 21 personas');
    expect(md).toContain('### eastern — 21 personas');
    expect(md).toContain('### southern — 21 personas');
    expect(md).toContain('### western — 21 personas');
  });

  it('markdown includes a clinic superadmin for every seeded mental-health clinic', async () => {
    const md = await buildMasterLoginMarkdown();
    expect(md).toContain('| superadmin@northern.goodhealth.demo | `Superadmin!Northern2026` | superadmin | northern | Clinic Superadmin');
    expect(md).toContain('| superadmin@eastern.goodhealth.demo | `Superadmin!Eastern2026` | superadmin | eastern | Clinic Superadmin');
    expect(md).toContain('| superadmin@southern.goodhealth.demo | `Superadmin!Southern2026` | superadmin | southern | Clinic Superadmin');
    expect(md).toContain('| superadmin@western.goodhealth.demo | `Superadmin!Western2026` | superadmin | western | Clinic Superadmin');
  });

  it('markdown is byte-stable across two builds (determinism proof)', async () => {
    const a = await buildMasterLoginMarkdown();
    const b = await buildMasterLoginMarkdown();
    expect(a).toBe(b);
  });

  it('runMasterLoginStep writes the file and reports inserted=1 on first run', async () => {
    const outPath = path.join(tmpDir, 'logins.md');
    const result = await runMasterLoginStep(outPath);
    expect(result.inserted).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.bytes).toBeGreaterThan(1000);
    const onDisk = await fs.readFile(outPath, 'utf8');
    expect(onDisk).toContain('# Good Health — Master Login Table');
    expect(Buffer.byteLength(onDisk, 'utf8')).toBe(result.bytes);
  });

  it('second run reports updated=1 and rewrites idempotently', async () => {
    const outPath = path.join(tmpDir, 'logins.md');
    await runMasterLoginStep(outPath);
    const r2 = await runMasterLoginStep(outPath);
    expect(r2.inserted).toBe(0);
    expect(r2.updated).toBe(1);
    const contents1 = await fs.readFile(outPath, 'utf8');
    await runMasterLoginStep(outPath);
    const contents2 = await fs.readFile(outPath, 'utf8');
    expect(contents2).toBe(contents1);
  });

  it('creates parent directories on first run', async () => {
    const outPath = path.join(tmpDir, 'nested', 'dir', 'logins.md');
    const result = await runMasterLoginStep(outPath);
    expect(result.inserted).toBe(1);
    const stat = await fs.stat(outPath);
    expect(stat.isFile()).toBe(true);
  });

  it('every row in the markdown is a clean pipe-delimited line', async () => {
    const md = await buildMasterLoginMarkdown();
    const dataLines = md
      .split('\n')
      .filter((l) => l.startsWith('| ') && !l.startsWith('|---') && !l.includes('Email |'));
    // 97 personas → 97 data rows (96 standard + 1 demo-shortcut)
    expect(dataLines.length).toBe(97);
    for (const line of dataLines) {
      const cols = line.split('|').filter((s) => s.trim().length > 0);
      expect(cols.length).toBe(5);
    }
  });
});
