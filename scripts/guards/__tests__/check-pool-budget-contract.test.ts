import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runGuard } from '../check-pool-budget-contract';

const TMP_ROOT = join(tmpdir(), 'check-pool-budget-contract-fixtures');

function writeFixtureFile(path: string, content: string): void {
  writeFileSync(path, content, 'utf8');
}

beforeAll(() => {
  if (existsSync(TMP_ROOT)) rmSync(TMP_ROOT, { recursive: true, force: true });
  mkdirSync(TMP_ROOT, { recursive: true });
});

afterAll(() => {
  if (existsSync(TMP_ROOT)) rmSync(TMP_ROOT, { recursive: true, force: true });
});

function makePaths(prefix: string) {
  const fixtureDir = join(TMP_ROOT, prefix);
  mkdirSync(fixtureDir, { recursive: true });

  const paths = {
    envExamplePath: join(fixtureDir, '.env.example'),
    envProductionTemplatePath: join(fixtureDir, '.env.production.template'),
    ecosystemConfigPath: join(fixtureDir, 'ecosystem.config.js'),
    worksheetPath: join(fixtureDir, 'worksheet.md'),
  };

  return { fixtureDir, paths };
}

function writeBaselineFixture(paths: ReturnType<typeof makePaths>['paths']): void {
  writeFixtureFile(
    paths.envExamplePath,
    [
      'DB_POOL_MAX=50',
      'DB_POOL_MIN=5',
      'DB_REPLICA_POOL_MAX=30',
      'API_PROCESS_COUNT=4',
      'DB_POOL_BUDGET_ASSERT_MODE=warn',
      'DB_USABLE_BACKEND_CONNECTIONS=730',
      'DB_RESERVED_BACKEND_CONNECTIONS=146',
      'DB_NON_API_CONSUMERS=10',
      'DB_SAFE_UTILIZATION_CEILING=0.70',
      'SSE_MAX_CONNECTIONS=500',
      'LLM_MAX_CONCURRENT=3',
      'WHISPER_MAX_CONCURRENT=2',
    ].join('\n'),
  );
  writeFixtureFile(
    paths.envProductionTemplatePath,
    [
      'DB_POOL_MAX=20',
      'DB_POOL_MIN=2',
      'DB_REPLICA_POOL_MAX=30',
      'API_PROCESS_COUNT=4',
      'DB_POOL_BUDGET_ASSERT_MODE=warn',
      'DB_USABLE_BACKEND_CONNECTIONS=730',
      'DB_RESERVED_BACKEND_CONNECTIONS=146',
      'DB_NON_API_CONSUMERS=10',
      'DB_SAFE_UTILIZATION_CEILING=0.70',
      'SSE_MAX_CONNECTIONS=500',
      'LLM_MAX_CONCURRENT=3',
      'WHISPER_MAX_CONCURRENT=2',
      'DB_REPLICA_HOST=replica.internal',
    ].join('\n'),
  );
  writeFixtureFile(
    paths.ecosystemConfigPath,
    "module.exports = { apps: [{ instances: process.env.API_INSTANCES || 4 }] };",
  );
  writeFixtureFile(paths.worksheetPath, '# worksheet');
}

describe('check-pool-budget-contract guard', () => {
  it('passes when contract keys exist and projection is non-risky', () => {
    const { paths } = makePaths('pass');
    writeBaselineFixture(paths);

    const result = runGuard({ paths });
    expect(result.exitCode).toBe(0);
    expect(result.failures).toHaveLength(0);
    expect(result.evaluation?.projection?.verdict).toBe('healthy');
  });

  it('fails when required keys are missing', () => {
    const { paths } = makePaths('missing-key');
    writeBaselineFixture(paths);
    writeFixtureFile(paths.envProductionTemplatePath, 'DB_POOL_MAX=20\n');

    const result = runGuard({ paths });
    expect(result.exitCode).toBe(1);
    expect(result.failures.some((f) => f.includes('missing key: DB_POOL_MIN'))).toBe(true);
  });

  it('fails when projection is risky', () => {
    const { paths } = makePaths('risky');
    writeBaselineFixture(paths);
    writeFixtureFile(
      paths.envProductionTemplatePath,
      [
        'DB_POOL_MAX=80',
        'DB_POOL_MIN=2',
        'DB_REPLICA_POOL_MAX=60',
        'API_PROCESS_COUNT=4',
        'DB_POOL_BUDGET_ASSERT_MODE=warn',
        'DB_USABLE_BACKEND_CONNECTIONS=200',
        'DB_RESERVED_BACKEND_CONNECTIONS=20',
        'DB_NON_API_CONSUMERS=30',
        'DB_SAFE_UTILIZATION_CEILING=0.70',
        'SSE_MAX_CONNECTIONS=500',
        'LLM_MAX_CONCURRENT=3',
        'WHISPER_MAX_CONCURRENT=2',
      ].join('\n'),
    );

    const result = runGuard({ paths });
    expect(result.exitCode).toBe(1);
    expect(result.failures.some((f) => f.includes('projection is risky'))).toBe(true);
  });
});
