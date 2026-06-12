import type { Knex } from 'knex';

function normalizeJsonbValue(value: unknown, fallback: unknown): unknown {
  if (value === undefined) return fallback;
  if (value === null) return null;
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return fallback;
  return JSON.parse(serialized) as unknown;
}

export function toJsonbDbValue(knex: Knex, value: unknown, fallback: unknown): Knex.Raw {
  const normalized = normalizeJsonbValue(value, fallback);
  return knex.raw('?::jsonb', [JSON.stringify(normalized)]);
}

export function normalizeAiJobResultJson(value: unknown): unknown {
  return normalizeJsonbValue(value, {});
}

export function normalizeAiJobWarnings(value: string[] | undefined): string[] {
  const normalized = normalizeJsonbValue(value, []);
  return Array.isArray(normalized) ? normalized.map((item) => String(item)) : [];
}
