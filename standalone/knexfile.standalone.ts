/**
 * Knex configuration for standalone SQLite mode.
 *
 * The same migrations that run against PostgreSQL will run against SQLite.
 * Some PG-specific features (gen_random_uuid, jsonb) need migration compatibility.
 *
 * Usage:
 *   DB_CLIENT=sqlite3 DB_FILENAME=./signacare.db npx knex migrate:latest --knexfile standalone/knexfile.standalone.ts
 */
import type { Knex } from 'knex';

const config: Knex.Config = {
  client: 'better-sqlite3',
  connection: {
    filename: process.env.DB_FILENAME || './signacare.db',
  },
  useNullAsDefault: true,
  migrations: {
    directory: '../apps/api/migrations',
    extension: 'ts',
  },
  seeds: {
    directory: '../apps/api/seeds',
    extension: 'ts',
  },
};

export default config;
