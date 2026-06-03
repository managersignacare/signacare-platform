/**
 * apps/api/scripts/migrate.ts
 *
 * Runnable in two modes:
 *
 *   Dev (ts-node):
 *     npm run migrate:dev   →   reads .ts migrations from ./migrations
 *
 *   Production (compiled):
 *     npm run migrate       →   reads .js migrations from
 *                               ../migrations/*.js (relative to
 *                               dist/scripts/migrate.js)
 *
 * The migrations directory is resolved from __dirname so the script
 * works in both layouts without an env var.
 */

import { getSecretsBackendName, loadSecretsAsync } from '../src/config/secrets';
import {
  createMigrationKnex,
  createMigrationSource,
  getScriptLayout,
  runSqlMigrations,
  type MigrationDbConfig,
} from './lib/migrationRunner';

async function main(): Promise<void> {
  // Keep migration path aligned with runtime boot semantics:
  // if secrets come from Azure Key Vault, resolve them before config
  // is imported (config.ts validates env at module-load time).
  if (getSecretsBackendName() === 'azure_keyvault') {
    await loadSecretsAsync();
  }

  const { config } = await import('../src/config/config');
  const pgConfig: MigrationDbConfig = {
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database,
  };

  const isCompiled = __filename.endsWith('.js');
  const loadExtensions = isCompiled ? ['.js'] : ['.ts'];
  const layout = getScriptLayout(__filename);
  const migrationSource = createMigrationSource(layout.migrationsDir, loadExtensions);
  const db = createMigrationKnex(pgConfig, migrationSource);
  const [batch, files] = await db.migrate.latest();

  // SQL migrations run AFTER Knex because they add RLS/triggers/
  // grants to tables that Knex migrations create. The .ts wrappers
  // registered themselves in the batch above as ledger-only no-ops.
  await runSqlMigrations(pgConfig, layout.sqlMigrationsDir);
  console.log(
    `Migrations complete. Mode: ${isCompiled ? 'compiled' : 'ts-node'}. Batch ${batch}. Applied: ${files.length > 0 ? files.join(', ') : 'none (already up to date)'}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
