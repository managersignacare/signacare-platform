// apps/api/knexfile.ts
import type { Knex } from "knex";
import { config } from "./src/config/index";

const base: Knex.Config = {
  client: "pg",
  connection: {
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database,
  },
  pool: {
    min: 2,
    max: 10,
  },
  migrations: {
    directory: "./migrations",
    tableName: "knex_migrations",
    extension: "ts",
  },
};

const knexConfig: Record<string, Knex.Config> = {
  development: {
    ...base,
    debug: true,
  },
  test: {
    ...base,
  },
  production: {
    ...base,
  },
};

module.exports = knexConfig;
