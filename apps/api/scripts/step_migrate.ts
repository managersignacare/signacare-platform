/**
 * apps/api/scripts/step_migrate.ts
 *
 * Development-only migration driver. Runs pending Knex migrations
 * one at a time so a failure surfaces with its real cause instead
 * of the "current transaction is aborted" cascade you get from a
 * batched `migrate.latest()` run.
 *
 * Usage: npx ts-node -r dotenv/config -r tsconfig-paths/register \
 *          --project tsconfig.node.json scripts/step_migrate.ts
 */
import knex, { type Knex } from 'knex';
import fs from 'fs';
import path from 'path';
import { config } from '../src/config/config';
import { orderMigrationsForExecution } from './lib/orderMigrations';

const migrationsDir = path.resolve(__dirname, '..', 'migrations');

const migrationSource = {
  async getMigrations(loadExtensions: readonly string[]): Promise<string[]> {
    const files = fs.readdirSync(migrationsDir)
      .filter((f) => loadExtensions.some((ext) => f.endsWith(ext)));
    return orderMigrationsForExecution(files);
  },
  getMigrationName(migration: string): string {
    return migration;
  },
  async getMigration(migration: string): Promise<{ up: (k: Knex) => PromiseLike<unknown>; down?: (k: Knex) => PromiseLike<unknown> }> {
    const full = path.join(migrationsDir, migration);
    // eslint-disable-next-line @typescript-eslint/no-require-imports, import/no-dynamic-require, global-require
    return require(full);
  },
};

function makeDb() {
  return knex({
    client: 'pg',
    connection: {
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      password: config.database.password,
      database: config.database.database,
    },
    // Single-connection pool so each iteration's connection starts
    // clean after destroy() — avoids a poisoned connection being
    // recycled back into the pool and masking the real failure as
    // a "transaction is aborted" cascade.
    pool: { min: 1, max: 1 },
    migrations: {
      tableName: 'knex_migrations',
      migrationSource,
    },
  });
}

async function main(): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const db = makeDb();
    try {
      const result = await db.migrate.up();
      const files = (result as unknown as [number, string[]])[1];
      if (!files || files.length === 0) {
        console.log('DONE — no more pending migrations');
        await db.destroy();
        break;
      }
      console.log(`APPLIED: ${files.join(', ')}`);
      await db.destroy();
    } catch (err: unknown) {
      const e = err as {
        message?: string;
        code?: string;
        detail?: string;
        hint?: string;
        constraint?: string;
        table?: string;
        column?: string;
        where?: string;
      };
      console.error('FAILED ON NEXT PENDING MIGRATION:');
      console.error('  message :', e?.message);
      console.error('  code    :', e?.code);
      console.error('  detail  :', e?.detail);
      console.error('  hint    :', e?.hint);
      console.error('  where   :', e?.where);
      console.error('  constr  :', e?.constraint);
      console.error('  table   :', e?.table);
      console.error('  column  :', e?.column);
      await db.destroy().catch(() => { /* already broken */ });
      process.exit(1);
    }
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
