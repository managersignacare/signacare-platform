# ASR benchmark evidence (Phase 7)

This directory stores the JSON outputs from
[`scripts/asr-benchmark/run-benchmark.ts`](../../../scripts/asr-benchmark/run-benchmark.ts).

## Files

| File | Purpose |
|---|---|
| `baseline.json` | Substrate baseline. Conforms to the metrics schema but every clip is `outcome: 'missing-fixture'` because audio fixtures are operator-supplied and NOT committed to git. The first real benchmark run replaces this with measured numbers. |
| `run-<timestamp>.json` | Per-run output. Compared against `baseline.json` via the harness `--baseline` flag; the harness writes the go/no-go gate verdict into the same file. |

The baseline shape is a literal substrate so the harness, schema, and
`--baseline` flag have something to lock against on day one. **It is not
a measured baseline.** Replacing it with measured numbers from your
local audio corpus is the first task in any Phase 7 promotion cycle.

## Reproducing a baseline run

```bash
# 1. Populate scripts/asr-benchmark/fixtures/ with the seeded audio +
#    reference transcripts named in scripts/asr-benchmark/corpus-manifest.json.
#    DO NOT commit these — synthetic / de-identified clips only.
# 2. Run the benchmark.
npm run bench:asr -- \
  --backend whisper/cpu \
  --corpus-root scripts/asr-benchmark/fixtures \
  --out docs/quality/asr-benchmark/baseline-$(date +%Y%m%d).json
# 3. Replace baseline.json with the new run, or pin its filename in
#    every future --baseline invocation.
```

## Comparing a candidate run

```bash
# whisper/cpu vs faster-whisper, 6-clip corpus.
export FASTER_WHISPER_API_URL=http://localhost:8081
npm run bench:asr -- \
  --backend faster-whisper \
  --corpus-root scripts/asr-benchmark/fixtures \
  --baseline docs/quality/asr-benchmark/baseline.json \
  --out docs/quality/asr-benchmark/run-faster-whisper-$(date +%Y%m%d).json
# Exit code 2 == no-go (operator brief gate fired).
```

## Go / no-go gate (operator brief)

A run is `no-go` if ANY of the following fires:

1. **Median latency** for the `15m` or `60m` bucket dropped by less
   than `25%` vs baseline.
2. **Median WER** worsened by more than `+10%` vs baseline in any
   bucket.
3. **Timeout count** in any bucket increased vs baseline.

The harness encodes these in
[`scripts/asr-benchmark/run-benchmark.ts:evaluateGoNoGoGate`](../../../scripts/asr-benchmark/run-benchmark.ts).
Any change to the thresholds is an operator decision; do not silently
relax them.

## Clinical-safety posture

- The harness is **non-production**. It does not write to
  `llm_interactions` and does not invoke
  `recordWhisperAsrInteraction`. Real clinical pipeline audit
  semantics are unchanged.
- The default runtime behaviour is **unchanged** by Phase 7. Without
  `SIGNACARE_WHISPER_BACKEND` set (or set to `whisper/cpu`), every
  clinical request continues to route to the existing Flask Whisper
  server at `WHISPER_API_URL`.
- Reject any PR that commits a benchmark JSON whose `perClip` entries
  carry non-`synthetic` audio without operator sign-off. Real
  clinical audio belongs in a separate, access-controlled corpus.
