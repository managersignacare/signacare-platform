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
  });

  it('markdown reports the exact total persona count', async () => {
    const md = await buildMasterLoginMarkdown();
    // 5 executive + 7 dept heads + 80 clinic = 92
    expect(md).toContain('**Total personas:** 92');
  });

  it('markdown lists every section header the operator expects', async () => {
    const md = await buildMasterLoginMarkdown();
    expect(md).toContain('## Executive & Corporate');
    expect(md).toContain('## Department Heads');
    expect(md).toContain('## Clinical Staff (by clinic)');
  });

  it('markdown contains one sub-section per mental-health clinic', async () => {
    const md = await buildMasterLoginMarkdown();
    expect(md).toContain('### northern — 20 personas');
    expect(md).toContain('### eastern — 20 personas');
    expect(md).toContain('### southern — 20 personas');
    expect(md).toContain('### western — 20 personas');
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
    // 92 personas → 92 data rows
    expect(dataLines.length).toBe(92);
    for (const line of dataLines) {
      const cols = line.split('|').filter((s) => s.trim().length > 0);
      expect(cols.length).toBe(5);
    }
  });
});
