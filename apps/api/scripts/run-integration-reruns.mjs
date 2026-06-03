#!/usr/bin/env node
/**
 * Deterministic integration rerun probe.
 *
 * Runs a single integration file repeatedly and reports fail-rate against
 * an explicit budget (default 1%). This is intended for C1 flake containment
 * evidence such as BUG-713.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const cwd = resolve(import.meta.dirname, '..');

function parseArgs(argv) {
  const out = {
    file: '',
    runs: 10,
    maxFailRate: 0.01,
    out: '',
    logDir: '',
    stopOnFirstFail: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--file':
        out.file = next ?? '';
        i += 1;
        break;
      case '--runs':
        out.runs = Number(next);
        i += 1;
        break;
      case '--max-fail-rate':
        out.maxFailRate = Number(next);
        i += 1;
        break;
      case '--out':
        out.out = next ?? '';
        i += 1;
        break;
      case '--log-dir':
        out.logDir = next ?? '';
        i += 1;
        break;
      case '--stop-on-first-fail':
        out.stopOnFirstFail = true;
        break;
      case '--help':
      case '-h':
        printHelpAndExit(0);
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        printHelpAndExit(2);
    }
  }

  return out;
}

function printHelpAndExit(code) {
  console.log(`
Usage:
  node scripts/run-integration-reruns.mjs --file <tests/integration/*.test.ts> [options]

Options:
  --runs <n>                 Number of runs (default: 10)
  --max-fail-rate <0..1>     Max allowed fail rate (default: 0.01)
  --out <path.json>          Write summary JSON
  --log-dir <dir>            Write per-run stdout/stderr logs
  --stop-on-first-fail       Stop immediately on first failure
  --help, -h                 Show this help
  `);
  process.exit(code);
}

function normalizeFile(file) {
  return file
    .replace(/\\/g, '/')
    .replace(/^\.?\/*/, '')
    .replace(/^tests\/integration\//, 'tests/integration/');
}

function ensureParentDir(path) {
  const parent = dirname(path);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
  }
}

const options = parseArgs(process.argv.slice(2));

if (!options.file) {
  console.error('Missing required --file argument.');
  printHelpAndExit(2);
}
if (!Number.isInteger(options.runs) || options.runs <= 0) {
  console.error(`Invalid --runs value: ${options.runs}`);
  process.exit(2);
}
if (!Number.isFinite(options.maxFailRate) || options.maxFailRate < 0 || options.maxFailRate > 1) {
  console.error(`Invalid --max-fail-rate value: ${options.maxFailRate}`);
  process.exit(2);
}

const file = normalizeFile(options.file);
const startedAt = new Date().toISOString();
const results = [];
let passCount = 0;
let failCount = 0;

if (options.logDir) {
  mkdirSync(options.logDir, { recursive: true });
}

console.log(`rerun_probe_start file=${file} runs=${options.runs} max_fail_rate=${options.maxFailRate}`);

for (let run = 1; run <= options.runs; run += 1) {
  const runStarted = new Date().toISOString();
  const t0 = Date.now();
  const res = spawnSync(
    'npm',
    ['run', 'test:integration', '--', file],
    {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, CI: '1' },
      stdio: 'pipe',
    },
  );
  const durationMs = Date.now() - t0;
  const ok = res.status === 0;

  if (ok) passCount += 1;
  else failCount += 1;

  const runRecord = {
    run,
    ok,
    exitCode: res.status ?? null,
    signal: res.signal ?? null,
    durationMs,
    startedAt: runStarted,
  };

  if (options.logDir) {
    const base = `${options.logDir}/run-${String(run).padStart(2, '0')}`;
    const stdoutPath = `${base}.stdout.log`;
    const stderrPath = `${base}.stderr.log`;
    writeFileSync(stdoutPath, res.stdout ?? '', 'utf8');
    writeFileSync(stderrPath, res.stderr ?? '', 'utf8');
    runRecord.stdoutLog = stdoutPath;
    runRecord.stderrLog = stderrPath;
  }

  results.push(runRecord);
  console.log(`run=${run}/${options.runs} status=${ok ? 'PASS' : 'FAIL'} duration_ms=${durationMs}`);

  if (!ok && options.stopOnFirstFail) {
    break;
  }
}

const completedAt = new Date().toISOString();
const executedRuns = results.length;
const failRate = executedRuns > 0 ? failCount / executedRuns : 1;
const gatePass = failRate <= options.maxFailRate;

const summary = {
  file,
  configuredRuns: options.runs,
  executedRuns,
  passCount,
  failCount,
  failRate,
  maxFailRate: options.maxFailRate,
  gatePass,
  startedAt,
  completedAt,
  results,
};

if (options.out) {
  ensureParentDir(options.out);
  writeFileSync(options.out, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(`summary_written=${options.out}`);
}

console.log(
  `rerun_probe_result gate=${gatePass ? 'PASS' : 'FAIL'} pass=${passCount} fail=${failCount} fail_rate=${failRate.toFixed(4)}`,
);

process.exit(gatePass ? 0 : 1);
