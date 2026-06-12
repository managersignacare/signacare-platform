import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createMigrationSource } from '../../scripts/lib/migrationRunner';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
});

describe('createMigrationSource', () => {
  it('maps compiled js migrations back to canonical ts ledger names', async () => {
    const migrationsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'signacare-migrations-'));
    tempDirs.push(migrationsDir);

    const compiledMigrationPath = path.join(migrationsDir, '20260701000000_baseline.js');
    await fs.writeFile(
      compiledMigrationPath,
      'module.exports = { up: async () => "ok" };',
      'utf8',
    );

    const source = createMigrationSource(migrationsDir, ['.js']);
    const migrations = await source.getMigrations(['.js']);

    expect(migrations).toEqual(['20260701000000_baseline.ts']);

    const migrationModule = await source.getMigration('20260701000000_baseline.ts');
    await expect(migrationModule.up({} as never)).resolves.toBe('ok');
  });
});
