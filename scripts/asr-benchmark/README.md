# ASR Benchmark Harness (Phase 7)

Reproducible benchmark for the Signacare Whisper ASR pipeline. Compares
latency, WER, token overlap, memory, and timeout / clip-abort counts
across a stable seed corpus before any change to the Whisper runtime
ships.

## Why this exists

Phase 7's operator brief asks for a **decision gate** before swapping
the Whisper runtime. Without a baseline, "faster-whisper helps" or
"GPU-managed is worth it" is opinion. With this harness it's a
deterministic JSON file the operator can diff.

## Backends

The harness routes to one of three closed-list backends, matching the
runtime contract in `apps/api/src/mcp/whisperBackend.ts`:

| Backend | Endpoint env var | Notes |
|---|---|---|
| `whisper/cpu` | `WHISPER_API_URL` (default `http://localhost:8080`) | Current production. Default. |
| `faster-whisper` | `FASTER_WHISPER_API_URL` (required) | CTranslate2-backed Whisper. Drop-in `/inference` contract. |
| `gpu-managed` | `GPU_MANAGED_ASR_API_URL` (required) | Azure-managed transcription. Drop-in `/inference` contract. |

Unset / blank / unrecognised values resolve to the default backend
with a LOUD warning (no silent fallback).

## Files

| Path | Purpose |
|---|---|
| `corpus-manifest.json` | Declarative corpus — 6 clips across 5m / 15m / 60m buckets. |
| `run-benchmark.ts` | Harness orchestrator (tsx). |
| `wer.ts` | Pure Levenshtein-on-words WER + Jaccard token overlap. |
| `metrics.schema.json` | JSON Schema for the output file. |
| `fixtures/` | Audio + reference transcripts (NOT committed; populated locally). |

The `fixtures/` directory is intentionally NOT in git — the benchmark
corpus is operator-supplied audio that must NOT be tracked. The
manifest names each fixture; the operator populates them out-of-band
under `--corpus-root`.

## Usage

```bash
# Default lane (whisper/cpu) — produces a baseline.
npm run bench:asr -- \
  --backend whisper/cpu \
  --corpus-root /path/to/signacare-asr-fixtures \
  --out docs/quality/asr-benchmark/baseline-$(date +%Y%m%d).json

# Compare a candidate (faster-whisper) against the baseline.
export FASTER_WHISPER_API_URL=http://localhost:8081
npm run bench:asr -- \
  --backend faster-whisper \
  --corpus-root /path/to/signacare-asr-fixtures \
  --baseline docs/quality/asr-benchmark/baseline-20260606.json \
  --out docs/quality/asr-benchmark/run-faster-whisper-$(date +%Y%m%d).json

# Dry run (no audio, no POSTs) — useful for CI smoke.
npm run bench:asr -- --backend whisper/cpu --dry-run \
  --out /tmp/asr-bench-dryrun.json
```

CLI flags:

| Flag | Default | Purpose |
|---|---|---|
| `--backend <v>` | env `SIGNACARE_WHISPER_BACKEND` | One of the closed-list backends. |
| `--corpus-root <dir>` | `scripts/asr-benchmark/fixtures` | Where the manifest's relative audio paths resolve from. |
| `--manifest <path>` | `scripts/asr-benchmark/corpus-manifest.json` | Override the corpus manifest. |
| `--out <path>` | `docs/quality/asr-benchmark/run-<ts>.json` | Output metrics JSON path. |
| `--baseline <path>` | (none) | If supplied, computes the go/no-go gate vs that baseline. |
| `--per-clip-timeout-ms <ms>` | `600000` (10 min) | Per-clip HTTP timeout. Clips that exceed are recorded as `timeout`. |
| `--dry-run` | `false` | Skip POSTs; emit `missing-fixture` for every clip. |

## Go / No-Go gate

The harness computes the gate when `--baseline` is supplied. Verdict
is `no-go` if ANY of the following fires:

1. **Median latency** for the `15m` or `60m` bucket dropped by less
   than `25%` vs baseline.
2. **Median WER** worsened by more than `+10%` vs baseline in any
   bucket.
3. **Timeout count** in any bucket increased vs baseline (timeout
   rate must be REDUCED, not held flat — operator brief).

A `no-go` run exits non-zero (exit code 2) so CI gates can short-
circuit promotion.

## Output JSON shape

See [`metrics.schema.json`](./metrics.schema.json) for the canonical
shape. Key fields:

```jsonc
{
  "schemaVersion": "1.0.0",
  "runId": "2026-06-06T...-whisper_cpu",
  "backend": "whisper/cpu",
  "endpointUrl": "http://localhost:8080",
  "fellBackToDefault": false,
  "fallbackReason": null,
  "corpus": { "manifestPath": "...", "manifestSha256": "...", "clipCount": 6 },
  "perClip": [
    { "clipId": "seed-5m-01", "outcome": "ok", "latencyMs": 8421, "wer": 0.082, ... }
  ],
  "perDurationBucket": {
    "5m":  { "medianLatencyMs": 8000, "medianWer": 0.08, "timeoutCount": 0, ... },
    "15m": { "medianLatencyMs": 27500, "medianWer": 0.09, "timeoutCount": 0, ... },
    "60m": { "medianLatencyMs": 130000, "medianWer": 0.10, "timeoutCount": 0, ... }
  },
  "summary": { "clipCount": 6, "okCount": 6, ... },
  "goNoGoGate": { "verdict": "go", ... }   // only when --baseline supplied
}
```

## Validating output against the schema

```bash
# Optional: install ajv-cli once, then
npx ajv validate \
  -s scripts/asr-benchmark/metrics.schema.json \
  -d docs/quality/asr-benchmark/baseline-20260606.json
```

## Operator notes — clinical-safety posture

- The harness is a **non-production tool**. It does not write to
  `llm_interactions` and does not invoke `recordWhisperAsrInteraction`.
  Real clinical pipeline audit semantics are unchanged.
- The default behaviour of the API runtime is **unchanged** by Phase 7.
  Without `SIGNACARE_WHISPER_BACKEND` set (or set to `whisper/cpu`),
  every clinical request continues to use the existing Flask Whisper
  server at `WHISPER_API_URL`.
- The benchmark corpus must be **synthetic or de-identified**. Do not
  populate `fixtures/` with real clinical audio. The manifest's
  `phiClass` field documents the expected posture per clip; CI may add
  a future guard that rejects any non-`synthetic` value in the
  committed manifest.
