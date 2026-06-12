#!/usr/bin/env tsx
/**
 * Phase 7 — ASR benchmark harness.
 *
 * Usage:
 *
 *   npm run bench:asr -- \
 *     --backend whisper/cpu \
 *     --corpus-root <path-to-audio-fixtures> \
 *     --out docs/quality/asr-benchmark/run-<timestamp>.json \
 *     [--manifest scripts/asr-benchmark/corpus-manifest.json] \
 *     [--baseline docs/quality/asr-benchmark/baseline.json] \
 *     [--per-clip-timeout-ms 600000] \
 *     [--dry-run]
 *
 * Reads the corpus manifest, iterates each clip in declared order,
 * POSTs the audio to the backend's /inference endpoint (matching the
 * existing Whisper client contract), records latency / WER / token
 * overlap / timeout + abort counts, and writes a metrics JSON file
 * conforming to scripts/asr-benchmark/metrics.schema.json.
 *
 * The harness is intentionally self-contained:
 *
 *   - No imports from apps/api — the benchmark CAN'T accidentally
 *     mutate clinical pipeline state.
 *   - The backend resolver is duplicated as a small inline helper that
 *     mirrors apps/api/src/mcp/whisperBackend.ts (the unit-tested
 *     contract). Drift between the two is caught by the unit tests
 *     asserting the same closed-list enum.
 *   - `--dry-run` skips the actual POSTs and emits a metrics file with
 *     `outcome: 'missing-fixture'` for every clip; useful for CI
 *     smoke without a running Whisper server.
 *
 * Go/no-go gate (operator brief):
 *
 *   - median latency drop ≥ 25% for 15m+ buckets
 *   - WER non-worsening by more than +10%
 *   - timeout rate REDUCED (no silent fallback)
 *
 * Computed in `evaluateGoNoGate()` when --baseline is supplied.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { computeWer, tokenOverlap } from './wer';

// ── Inline backend contract (mirrors apps/api/src/mcp/whisperBackend.ts) ──

const ALLOWED_BACKENDS = ['whisper/cpu', 'faster-whisper', 'gpu-managed'] as const;
type Backend = (typeof ALLOWED_BACKENDS)[number];
const DEFAULT_BACKEND: Backend = 'whisper/cpu';

function isBackend(v: string): v is Backend {
  return (ALLOWED_BACKENDS as readonly string[]).includes(v);
}

function endpointUrlFor(backend: Backend): string | null {
  switch (backend) {
    case 'whisper/cpu':
      return process.env.WHISPER_API_URL ?? 'http://localhost:8080';
    case 'faster-whisper':
      return process.env.FASTER_WHISPER_API_URL ?? null;
    case 'gpu-managed':
      return process.env.GPU_MANAGED_ASR_API_URL ?? null;
  }
}

interface BackendResolution {
  backend: Backend;
  url: string;
  fellBackToDefault: boolean;
  fallbackReason: string | null;
}

function resolveBackend(requested: Backend | undefined): BackendResolution {
  const target = requested ?? DEFAULT_BACKEND;
  const url = endpointUrlFor(target);
  if (target === DEFAULT_BACKEND) {
    return {
      backend: DEFAULT_BACKEND,
      url: url ?? 'http://localhost:8080',
      fellBackToDefault: false,
      fallbackReason: null,
    };
  }
  if (!url) {
    const reason = `backend "${target}" requested but its endpoint URL env var is unset`;
    return {
      backend: DEFAULT_BACKEND,
      url: endpointUrlFor(DEFAULT_BACKEND) ?? 'http://localhost:8080',
      fellBackToDefault: true,
      fallbackReason: reason,
    };
  }
  return { backend: target, url, fellBackToDefault: false, fallbackReason: null };
}

// ── Types ────────────────────────────────────────────────────────────────

type DurationBucket = '5m' | '15m' | '60m';
type Outcome = 'ok' | 'timeout' | 'clip-aborted' | 'decode-failed' | 'transport-error' | 'missing-fixture';

interface CorpusClip {
  id: string;
  durationBucket: DurationBucket;
  audioPath: string;
  referenceTranscriptPath: string;
  seed: number;
  phiClass: string;
  notes?: string;
}

interface CorpusManifest {
  schemaVersion: string;
  name: string;
  description: string;
  phaseContext: string;
  durationBuckets: DurationBucket[];
  clips: CorpusClip[];
}

interface PerClipResult {
  clipId: string;
  durationBucket: DurationBucket;
  outcome: Outcome;
  latencyMs: number | null;
  wer: number | null;
  tokenOverlap: number | null;
  substitutions: number | null;
  deletions: number | null;
  insertions: number | null;
  referenceWordCount: number | null;
  hypothesisWordCount: number | null;
  memoryRssMb: number | null;
  errorCode: string | null;
}

interface PerBucketSummary {
  clipCount: number;
  medianLatencyMs: number | null;
  p95LatencyMs: number | null;
  medianWer: number | null;
  medianTokenOverlap: number | null;
  timeoutCount: number;
  abortCount: number;
  memoryRssMbP95: number | null;
}

interface RunSummary {
  clipCount: number;
  okCount: number;
  timeoutCount: number;
  abortCount: number;
  decodeFailedCount: number;
  transportErrorCount: number;
  missingFixtureCount: number;
}

interface GoNoGoGate {
  baselineRunId: string;
  medianLatencyDropPctByBucket: Partial<Record<DurationBucket, number>>;
  werDeltaPctByBucket: Partial<Record<DurationBucket, number>>;
  timeoutDeltaByBucket: Partial<Record<DurationBucket, number>>;
  verdict: 'go' | 'no-go';
  noGoReasons: string[];
}

interface MetricsOutput {
  schemaVersion: '1.0.0';
  runId: string;
  startedAt: string;
  completedAt: string;
  backend: Backend;
  endpointUrl: string;
  modelName?: string;
  modelVersion?: string;
  fellBackToDefault: boolean;
  fallbackReason: string | null;
  corpus: {
    manifestPath: string;
    manifestSha256: string;
    corpusRoot: string;
    clipCount: number;
  };
  perClip: PerClipResult[];
  perDurationBucket: Partial<Record<DurationBucket, PerBucketSummary>>;
  summary: RunSummary;
  goNoGoGate?: GoNoGoGate;
}

// ── CLI ──────────────────────────────────────────────────────────────────

interface CliArgs {
  backend: Backend | undefined;
  corpusRoot: string;
  manifestPath: string;
  outPath: string;
  baselinePath: string | undefined;
  perClipTimeoutMs: number;
  dryRun: boolean;
}

function parseCli(argv: string[]): CliArgs {
  const args = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      args.set(key, next);
      i++;
    } else {
      args.set(key, true);
    }
  }

  const backendRaw = args.get('backend');
  let backend: Backend | undefined;
  if (typeof backendRaw === 'string') {
    if (!isBackend(backendRaw)) {
      throw new Error(`--backend "${backendRaw}" not in closed list ${JSON.stringify(ALLOWED_BACKENDS)}`);
    }
    backend = backendRaw;
  }

  const cwd = process.cwd();
  const manifestPath = args.get('manifest');
  const corpusRoot = args.get('corpus-root');
  const outPath = args.get('out');

  return {
    backend,
    corpusRoot: typeof corpusRoot === 'string' ? resolve(cwd, corpusRoot) : resolve(cwd, 'scripts/asr-benchmark/fixtures'),
    manifestPath: typeof manifestPath === 'string' ? resolve(cwd, manifestPath) : resolve(cwd, 'scripts/asr-benchmark/corpus-manifest.json'),
    outPath: typeof outPath === 'string' ? resolve(cwd, outPath) : resolve(cwd, `docs/quality/asr-benchmark/run-${Date.now()}.json`),
    baselinePath: typeof args.get('baseline') === 'string' ? resolve(cwd, args.get('baseline') as string) : undefined,
    perClipTimeoutMs: Number(args.get('per-clip-timeout-ms') ?? 600_000),
    dryRun: args.get('dry-run') === true,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function p95(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return sorted[idx];
}

function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

function readUtf8(path: string): string {
  return readFileSync(path, 'utf8');
}

function ensureDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function summariseBucket(results: PerClipResult[]): PerBucketSummary {
  const okResults = results.filter((r) => r.outcome === 'ok');
  const latencies = okResults.map((r) => r.latencyMs).filter((v): v is number => v !== null);
  const wers = okResults.map((r) => r.wer).filter((v): v is number => v !== null);
  const overlaps = okResults.map((r) => r.tokenOverlap).filter((v): v is number => v !== null);
  const memories = okResults.map((r) => r.memoryRssMb).filter((v): v is number => v !== null);
  return {
    clipCount: results.length,
    medianLatencyMs: median(latencies),
    p95LatencyMs: p95(latencies),
    medianWer: median(wers),
    medianTokenOverlap: median(overlaps),
    timeoutCount: results.filter((r) => r.outcome === 'timeout').length,
    abortCount: results.filter((r) => r.outcome === 'clip-aborted').length,
    memoryRssMbP95: p95(memories),
  };
}

function summariseRun(results: PerClipResult[]): RunSummary {
  return {
    clipCount: results.length,
    okCount: results.filter((r) => r.outcome === 'ok').length,
    timeoutCount: results.filter((r) => r.outcome === 'timeout').length,
    abortCount: results.filter((r) => r.outcome === 'clip-aborted').length,
    decodeFailedCount: results.filter((r) => r.outcome === 'decode-failed').length,
    transportErrorCount: results.filter((r) => r.outcome === 'transport-error').length,
    missingFixtureCount: results.filter((r) => r.outcome === 'missing-fixture').length,
  };
}

// ── Backend interaction ──────────────────────────────────────────────────

interface InferenceResult {
  outcome: Outcome;
  latencyMs: number | null;
  hypothesis: string | null;
  modelName?: string;
  modelVersion?: string;
  errorCode?: string;
}

async function callInference(
  endpointUrl: string,
  audioPath: string,
  perClipTimeoutMs: number,
): Promise<InferenceResult> {
  if (!existsSync(audioPath)) {
    return { outcome: 'missing-fixture', latencyMs: null, hypothesis: null, errorCode: 'AUDIO_FIXTURE_MISSING' };
  }
  const t0 = Date.now();
  const audioBuffer = readFileSync(audioPath);
  const audioBlob = new Blob([audioBuffer]);

  const formData = new FormData();
  formData.append('file', audioBlob, audioPath.split('/').pop() ?? 'audio.wav');

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), perClipTimeoutMs);

  try {
    const response = await fetch(`${endpointUrl.replace(/\/$/, '')}/inference`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });

    const latencyMs = Date.now() - t0;
    if (!response.ok) {
      return { outcome: 'transport-error', latencyMs, hypothesis: null, errorCode: `HTTP_${response.status}` };
    }
    const json = (await response.json()) as { text?: string; transcript?: string; model?: string; model_version?: string };
    const hypothesis = json.text ?? json.transcript ?? '';
    if (!hypothesis) {
      return { outcome: 'decode-failed', latencyMs, hypothesis: '', errorCode: 'EMPTY_TRANSCRIPT' };
    }
    return {
      outcome: 'ok',
      latencyMs,
      hypothesis,
      modelName: json.model,
      modelVersion: json.model_version,
    };
  } catch (err) {
    const latencyMs = Date.now() - t0;
    if (err instanceof Error && err.name === 'AbortError') {
      return { outcome: 'timeout', latencyMs, hypothesis: null, errorCode: 'CLIP_TIMEOUT' };
    }
    return {
      outcome: 'transport-error',
      latencyMs,
      hypothesis: null,
      errorCode: err instanceof Error ? err.message : 'UNKNOWN',
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

// ── Go/no-go evaluator ──────────────────────────────────────────────────

function evaluateGoNoGoGate(
  current: { runId?: string; perDurationBucket: Partial<Record<DurationBucket, PerBucketSummary>> },
  baseline: MetricsOutput,
): GoNoGoGate {
  const buckets: DurationBucket[] = ['5m', '15m', '60m'];
  const medianLatencyDropPctByBucket: Partial<Record<DurationBucket, number>> = {};
  const werDeltaPctByBucket: Partial<Record<DurationBucket, number>> = {};
  const timeoutDeltaByBucket: Partial<Record<DurationBucket, number>> = {};
  const noGoReasons: string[] = [];

  for (const bucket of buckets) {
    const curr = current.perDurationBucket[bucket];
    const base = baseline.perDurationBucket[bucket];
    if (!curr || !base) continue;

    if (typeof base.medianLatencyMs === 'number' && typeof curr.medianLatencyMs === 'number' && base.medianLatencyMs > 0) {
      const dropPct = ((base.medianLatencyMs - curr.medianLatencyMs) / base.medianLatencyMs) * 100;
      medianLatencyDropPctByBucket[bucket] = Number(dropPct.toFixed(2));
      if ((bucket === '15m' || bucket === '60m') && dropPct < 25) {
        noGoReasons.push(`${bucket}: median latency drop ${dropPct.toFixed(1)}% < required 25%`);
      }
    }

    if (typeof base.medianWer === 'number' && typeof curr.medianWer === 'number' && base.medianWer > 0) {
      const deltaPct = ((curr.medianWer - base.medianWer) / base.medianWer) * 100;
      werDeltaPctByBucket[bucket] = Number(deltaPct.toFixed(2));
      if (deltaPct > 10) {
        noGoReasons.push(`${bucket}: WER worsened by ${deltaPct.toFixed(1)}% (allowed: +10%)`);
      }
    }

    const timeoutDelta = curr.timeoutCount - base.timeoutCount;
    timeoutDeltaByBucket[bucket] = timeoutDelta;
    if (timeoutDelta > 0) {
      noGoReasons.push(`${bucket}: timeout count INCREASED by ${timeoutDelta} (required: reduced)`);
    }
  }

  return {
    baselineRunId: baseline.runId,
    medianLatencyDropPctByBucket,
    werDeltaPctByBucket,
    timeoutDeltaByBucket,
    verdict: noGoReasons.length === 0 ? 'go' : 'no-go',
    noGoReasons,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseCli(process.argv.slice(2));
  const resolution = resolveBackend(args.backend);
  const startedAt = new Date().toISOString();

  if (!existsSync(args.manifestPath)) {
    throw new Error(`Corpus manifest not found at ${args.manifestPath}`);
  }
  const manifestSource = readUtf8(args.manifestPath);
  const manifest = JSON.parse(manifestSource) as CorpusManifest;

  console.log(`[asr-benchmark] backend=${resolution.backend} endpoint=${resolution.url}`);
  console.log(`[asr-benchmark] corpus=${manifest.name} clips=${manifest.clips.length} dryRun=${args.dryRun}`);
  if (resolution.fellBackToDefault) {
    console.warn(`[asr-benchmark] WARNING: fell back to default backend — ${resolution.fallbackReason}`);
  }

  const perClipResults: PerClipResult[] = [];
  let modelName: string | undefined;
  let modelVersion: string | undefined;

  for (const clip of manifest.clips) {
    const audioFullPath = isAbsolute(clip.audioPath) ? clip.audioPath : join(args.corpusRoot, clip.audioPath);
    const referenceFullPath = isAbsolute(clip.referenceTranscriptPath)
      ? clip.referenceTranscriptPath
      : join(args.corpusRoot, clip.referenceTranscriptPath);

    if (args.dryRun) {
      perClipResults.push({
        clipId: clip.id,
        durationBucket: clip.durationBucket,
        outcome: 'missing-fixture',
        latencyMs: null,
        wer: null,
        tokenOverlap: null,
        substitutions: null,
        deletions: null,
        insertions: null,
        referenceWordCount: null,
        hypothesisWordCount: null,
        memoryRssMb: null,
        errorCode: 'DRY_RUN',
      });
      console.log(`  [dry-run] ${clip.id} (${clip.durationBucket}) skipped`);
      continue;
    }

    const result = await callInference(resolution.url, audioFullPath, args.perClipTimeoutMs);
    if (result.modelName) modelName = result.modelName;
    if (result.modelVersion) modelVersion = result.modelVersion;
    const memoryRssMb = Math.round(process.memoryUsage().rss / 1024 / 1024);

    if (result.outcome !== 'ok' || result.hypothesis === null) {
      perClipResults.push({
        clipId: clip.id,
        durationBucket: clip.durationBucket,
        outcome: result.outcome,
        latencyMs: result.latencyMs,
        wer: null,
        tokenOverlap: null,
        substitutions: null,
        deletions: null,
        insertions: null,
        referenceWordCount: null,
        hypothesisWordCount: null,
        memoryRssMb,
        errorCode: result.errorCode ?? null,
      });
      console.log(`  [${result.outcome}] ${clip.id} (${clip.durationBucket}) latencyMs=${result.latencyMs}`);
      continue;
    }

    const referenceText = existsSync(referenceFullPath) ? readUtf8(referenceFullPath) : '';
    const werResult = computeWer(referenceText, result.hypothesis);
    const overlap = tokenOverlap(referenceText, result.hypothesis);

    perClipResults.push({
      clipId: clip.id,
      durationBucket: clip.durationBucket,
      outcome: 'ok',
      latencyMs: result.latencyMs,
      wer: Number(werResult.wer.toFixed(4)),
      tokenOverlap: Number(overlap.toFixed(4)),
      substitutions: werResult.substitutions,
      deletions: werResult.deletions,
      insertions: werResult.insertions,
      referenceWordCount: werResult.referenceWordCount,
      hypothesisWordCount: werResult.hypothesisWordCount,
      memoryRssMb,
      errorCode: null,
    });
    console.log(`  [ok] ${clip.id} (${clip.durationBucket}) latencyMs=${result.latencyMs} WER=${werResult.wer.toFixed(3)}`);
  }

  const perDurationBucket: Partial<Record<DurationBucket, PerBucketSummary>> = {};
  for (const bucket of ['5m', '15m', '60m'] as const) {
    const bucketResults = perClipResults.filter((r) => r.durationBucket === bucket);
    if (bucketResults.length > 0) perDurationBucket[bucket] = summariseBucket(bucketResults);
  }

  const runId = `${startedAt}-${resolution.backend.replace(/[^a-z0-9]/g, '_')}`;
  const output: MetricsOutput = {
    schemaVersion: '1.0.0',
    runId,
    startedAt,
    completedAt: new Date().toISOString(),
    backend: resolution.backend,
    endpointUrl: resolution.url,
    modelName,
    modelVersion,
    fellBackToDefault: resolution.fellBackToDefault,
    fallbackReason: resolution.fallbackReason,
    corpus: {
      manifestPath: relative(process.cwd(), args.manifestPath),
      manifestSha256: sha256Hex(manifestSource),
      corpusRoot: relative(process.cwd(), args.corpusRoot),
      clipCount: manifest.clips.length,
    },
    perClip: perClipResults,
    perDurationBucket,
    summary: summariseRun(perClipResults),
  };

  if (args.baselinePath && existsSync(args.baselinePath)) {
    const baseline = JSON.parse(readUtf8(args.baselinePath)) as MetricsOutput;
    output.goNoGoGate = evaluateGoNoGoGate(output, baseline);
    console.log(`[asr-benchmark] go/no-go vs baseline runId=${baseline.runId}: ${output.goNoGoGate.verdict.toUpperCase()}`);
    if (output.goNoGoGate.verdict === 'no-go') {
      for (const reason of output.goNoGoGate.noGoReasons) console.log(`  - ${reason}`);
    }
  }

  ensureDir(args.outPath);
  writeFileSync(args.outPath, JSON.stringify(output, null, 2) + '\n', 'utf8');

  const sizeKb = (statSync(args.outPath).size / 1024).toFixed(1);
  console.log(`[asr-benchmark] wrote ${args.outPath} (${sizeKb} KB)`);

  if (output.goNoGoGate?.verdict === 'no-go') process.exit(2);
}

main().catch((err) => {
  console.error('[asr-benchmark] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
