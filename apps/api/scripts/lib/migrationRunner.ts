import fs from 'fs';
import path from 'path';
import knex, { type Knex } from 'knex';
import { Client } from 'pg';
import { orderMigrationsForExecution } from './orderMigrations';

export type MigrationDbConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl?: boolean;
};

type MigrationModule = {
  up: (k: Knex) => PromiseLike<unknown>;
  down?: (k: Knex) => PromiseLike<unknown>;
};

function isMigrationModule(value: unknown): value is MigrationModule {
  if (!value || typeof value !== 'object') return false;
  const maybe = value as Record<string, unknown>;
  return typeof maybe.up === 'function';
}

export type ScriptLayout = {
  isCompiled: boolean;
  migrationsDir: string;
  sqlMigrationsDir: string;
  loadExtensions: readonly string[];
};

export function getScriptLayout(scriptFilename: string): ScriptLayout {
  const isCompiled = scriptFilename.endsWith('.js');
  const scriptDir = path.dirname(scriptFilename);
  return {
    isCompiled,
    migrationsDir: path.resolve(scriptDir, '..', 'migrations'),
    sqlMigrationsDir: path.resolve(scriptDir, '..', 'src', 'db', 'migrations'),
    loadExtensions: isCompiled ? ['.js'] : ['.ts'],
  };
}

export function createMigrationSource(
  migrationsDir: string,
  defaultExtensions: readonly string[],
): Knex.MigrationSource<string> {
  const compiledJsNameToRuntimePath = new Map<string, string>();

  return {
    async getMigrations(extensions: readonly string[]): Promise<string[]> {
      const extList = extensions.length > 0 ? extensions : defaultExtensions;
      const files = fs
        .readdirSync(migrationsDir)
        .filter((fileName) => extList.some((ext) => fileName.endsWith(ext)));

      const canonicalFiles = files.map((fileName) => {
        if (fileName.endsWith('.js')) {
          const canonicalName = `${fileName.slice(0, -3)}.ts`;
          compiledJsNameToRuntimePath.set(canonicalName, fileName);
          return canonicalName;
        }

        return fileName;
      });

      return orderMigrationsForExecution(canonicalFiles);
    },
    getMigrationName(migration: string): string {
      return migration;
    },
    async getMigration(migration: string): Promise<MigrationModule> {
      const runtimeFileName = compiledJsNameToRuntimePath.get(migration) ?? migration;
      const fullPath = path.join(migrationsDir, runtimeFileName);
      const loaded = await import(fullPath);
      const candidate = 'default' in loaded && loaded.default ? loaded.default : loaded;
      if (!isMigrationModule(candidate)) {
        throw new Error(`Invalid migration module shape for ${migration}`);
      }
      return candidate;
    },
  };
}

export function createMigrationKnex(
  pgConfig: MigrationDbConfig,
  migrationSource: Knex.MigrationSource<string>,
): Knex {
  return knex({
    client: 'pg',
    connection: {
      host: pgConfig.host,
      port: pgConfig.port,
      user: pgConfig.user,
      password: pgConfig.password,
      database: pgConfig.database,
      ...(pgConfig.ssl ? { ssl: { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' } } : {}),
    },
    pool: { min: 1, max: 1 },
    migrations: {
      tableName: 'knex_migrations',
      migrationSource,
      // Each migration runs in auto-commit mode to avoid 25P02 cascading
      // transaction aborts across a large ledger batch.
      disableTransactions: true,
    },
  });
}

export async function runSqlMigrations(
  pgConfig: MigrationDbConfig,
  sqlMigrationsDir: string,
  logger: Pick<Console, 'log' | 'error'> = console,
): Promise<void> {
  if (!fs.existsSync(sqlMigrationsDir)) return;

  const sqlFiles = fs
    .readdirSync(sqlMigrationsDir)
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort();
  if (sqlFiles.length === 0) return;

  const client = new Client({
    host: pgConfig.host,
    port: pgConfig.port,
    user: pgConfig.user,
    password: pgConfig.password,
    database: pgConfig.database,
    ...(pgConfig.ssl ? { ssl: { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' } } : {}),
  });
  await client.connect();
  try {
    for (const fileName of sqlFiles) {
      const fullPath = path.join(sqlMigrationsDir, fileName);
      const sql = fs.readFileSync(fullPath, 'utf-8');
      try {
        await client.query(sql);
        logger.log(`  sql: ${fileName} ✓`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`  sql: ${fileName} FAILED: ${message}`);
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}
