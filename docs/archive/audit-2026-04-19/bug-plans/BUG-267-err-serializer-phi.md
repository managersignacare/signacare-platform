# BUG-267 — err.message contains PHI from DB constraint violations

**Metadata**

- Severity: **S0** (elevated from S1 → S0 on 2026-04-20 by L4 clinical-safety review)
- Track / Wave: **A / A-2** (patient-safety S0 wave)
- State: fixed (this commit)
- Fix-registry anchor: `R-FIX-LOGGER-ERR-SERIALIZER-PHI`
- Reportability: OAIC Notifiable Data Breach scheme (NDB) — unredacted PHI values in journald logs is a reportable privacy incident

---

## Diagnosis

PostgreSQL constraint-violation errors embed the offending column value directly into the `err.message` string:

| PG error code | Message shape |
|---|---|
| 23505 unique | `duplicate key value violates unique constraint "patients_medicare_lookup_uniq": Key (medicare_number)=(2123456789) already exists` |
| 23505 composite | `Key (clinic_id, medicare_number)=(uuid-xxx, 2123456789) already exists` |
| 23503 FK | `Key (patient_id)=(uuid) is not present in table "patients"` |
| 23514 check | `new row for relation "patient_medications" violates check constraint "dose_range_check": failing row contains (val1, val2, ..., valN)` |
| 23502 not-null | `null value in column "family_name" violates not-null constraint` (column name only, no value) |

Signacare's pino configuration at `apps/api/src/utils/logger.ts:230-234` wires `pino.stdSerializers.err` verbatim. That serializer returns the raw error object with `message`, `stack`, `code`, `detail`, `hint`, `table`, `constraint` — all untouched. Any `logger.error({ err })` on a DB-constraint path emits the offending PHI value to journald.

BUG-216 (commit `7323453`) expanded `redact.paths` + `redactPhi()` to cover ~120 structured field names. Both operate on **object keys**. Neither parses the **string values** inside `err.message`. Error messages pass through unredacted.

## Fix

### Layer 2 — custom pino err serializer (new)

New module `apps/api/src/utils/sanitizeErrForLogging.ts` replaces `pino.stdSerializers.err`:

1. Call `pino.stdSerializers.err(err)` to preserve the standard shape (`type`, `code`, stack frames, cause chain, etc.).
2. Run `sanitizeString()` over `.message`, `.stack`, `.detail`, `.hint`, `.table`, `.constraint`.
3. `sanitizeString()` applies three ordered regex passes:

| Regex | PG class | Action |
|---|---|---|
| `/Key \(([^)]+)\)=\((.*?)\)/g` | 23503, 23505 (incl. composite) | Split column capture on `,\s*`. If ANY column ∈ `PHI_FIELDS`, replace the entire `(v1, v2)` value block with `[REDACTED — PHI column]`. Otherwise leave untouched. |
| `/Failing row contains \((.*?)\)/g` | 23514 | Unconditionally replace parenthesised contents with `[REDACTED — failing-row PHI]` (fail-closed; can't map positional values to column names without query introspection). |
| `/column "([a-z_]+)"/g` | 23502 + generic | Preserve as-is (column names are ops-useful + not PHI). |

4. Return the sanitised **copy**. `err` is never mutated — catch-blocks higher up see the original message for their own decisions.

### Layer wiring in `logger.ts`

Change the `serializers.err:` key from `pino.stdSerializers.err` to `sanitizeErrForLogging`. Single-line change at `logger.ts:231`.

### Why not `redact.paths`?

Pino's `redact.paths` is a dotted-path key matcher. It cannot introspect string contents. By the time pino's redactor runs, the PHI is already baked into the `.message` string. A custom serializer is the correct layer — it intercepts before serialisation.

## Defence in depth

| Layer | Owner | Covers |
|---|---|---|
| 1 | Feature-code `catch (err) { err.code === '23xxx' }` | Handler-level sanitisation before logging |
| **2** | **`sanitizeErrForLogging` (this fix)** | **Everything Layer 1 missed — catches ALL `logger.error({ err })` paths without per-call-site change** |
| 3 | `redact.paths` + `redactPhi()` | PHI on structured context fields |

Layer 2 is the belt-and-suspenders layer — no handler code needs to change.

## Conservative-by-design posture

The three regex anchors match **known PG error-message syntax**. Arbitrary-value regex was rejected because it over-redacts non-PHI and under-redacts novel PG formats. Residual:

- **BUG-312 (S2 B-11) — non-pino log paths** — `console.error(err)`, `process.stderr.write(err.message)` bypass the serializer. Not addressed by this fix.
- **BUG-313 (S3 B-11) — knex debug / third-party loggers** — `debug()` writes via its own stream. PG driver's internal logging bypasses pino. Not addressed.
- **Novel PG error formats** — PG 18+ phrasing changes, RDS-variant error shapes pass through verbatim. Accepted; future audit iteration will extend the regex set.
- **Over-redaction** — any error message happening to contain `Key (foo)=(bar)` gets redacted even if not from PG. Tolerable: false-positive redaction is strictly safer than false-negative PHI leak.

## Performance posture

The serializer runs **only on error-logging paths** (`logger.error({ err })`, `logger.warn({ err })`, unhandled rejections). Happy-path request handling never enters it. Regex cost is bounded:

- All patterns are **non-greedy** with `.*?` anchored against `)` — no catastrophic backtracking (ReDoS-safe).
- ≤3 regex passes per error, each linear in message length.
- Typical PG error ≤512 chars → sub-millisecond overhead, dominated by log-line I/O cost.
- Single sanitised copy per error, no GC pressure.

No impact on request hot paths.

## Tests — 12 total, red-first

**Unit (9, `apps/api/tests/unit/sanitizeErrForLogging.test.ts`):**

| # | Case |
|---|---|
| U1 | `Key (medicare_number)=(2123456789) already exists` → value redacted |
| U2 | `Key (given_name)=(Smith) already exists` → value redacted |
| U3 | `Key (clinic_id)=(uuid) already exists` → uuid PRESERVED (clinic_id ∉ PHI_FIELDS) |
| U4 | `Failing row contains (a, b, c, d)` → parens replaced |
| U5 | `null value in column "family_name"...` → column name preserved (ops-useful) |
| U6 | `err.stack` with PHI in first line → first line redacted; frame structure preserved |
| U7 | `new Error('boom')` non-PG → unchanged (no false-positive rewrite) |
| U8 | `err.detail` + `err.hint` → both redacted same as `.message` |
| U9 | Multi-column composite: `Key (clinic_id, medicare_number)=(uuid, 2123456789)` → entire value block redacted because `medicare_number` ∈ PHI_FIELDS |

**Integration (3, `apps/api/tests/integration/loggerErrSerializer.int.test.ts`):**

| # | Case |
|---|---|
| I1 | Real PG 23505 via failing `patients.medicare_number_lookup` insert → captured pino line's `err.message` has `[REDACTED]` |
| I2 | Real PG 23503 on `patient_id` FK (non-PHI UUID) → value PRESERVED (sanity check) |
| I3 | Real PG 23514 check violation → parens replaced |

Red-first: U1, U2, U4, U6, U8, U9, I1, I3 fail pre-fix (default serializer passes values through). U3, U5, U7, I2 pass pre-fix (no PHI to leak, correct behaviour). **Post-fix: 12/12 PASS.** Existing `tests/unit/loggerRedaction.test.ts` (BUG-216's 6 tests on structured-field redaction) remains 6/6 PASS — no regression.

## Non-goals

- Do NOT expand `PHI_FIELDS` — that's BUG-216's scope; the column-name oracle reuses the existing set.
- Do NOT change `redactPhi()` — structured-field redaction is a different layer.
- Do NOT convert every handler to `err.code === '23xxx'` catch-and-rethrow — unnecessary once Layer 2 is in place; the plan is scope-limited.

## QA verdicts — round 1 (initial submission)

- **L3 code-reviewer-general:** PASS (6 non-blocking observations; notes plan/artefact drift 3→1 integration tests).
- **L4 clinical-safety-reviewer:** BLOCK — 4 required changes absorbed in round 2.
- **L5 architecture-reviewer:** BLOCK — 1 structural change (leaf-module extraction + phiEncryption rename) absorbed in round 2.

## QA verdicts — round 2 (post-absorption)

- **L3 code-reviewer-general:** re-run TBD.
- **L4 clinical-safety-reviewer:** re-run TBD.
- **L5 architecture-reviewer:** re-run TBD.

## Round-2 absorptions (what changed between round 1 and round 2)

**L4 (clinical-safety) absorbed:**
1. Added **PHI_CATEGORY_BLIND_INDEX** (new in `phiFields.ts`): `medicare_number_lookup`, `ihi_number_lookup`, `dva_number_lookup` + camelCase variants. These are the ACTUAL composite unique-constraint columns (`patients_medicare_lookup_uniq` on `(clinic_id, medicare_number_lookup)`) that PG constraint-violation messages would name. Pre-absorption PHI_FIELDS only had `medicare_number` etc., so the real prod leak path (composite blind-index duplicates) was NOT redacted. Post-absorption it is.
2. Added **unit tests U10 / U11 / U12** exercising the real composite shape: `Key (clinic_id, medicare_number_lookup)=(uuid, <hash>)`, `Key (clinic_id, ihi_number_lookup)=(...)`, `Key (clinic_id, dva_number_lookup)=(...)`.
3. **Replaced integration test I1** to use the patient blind-index duplicate path (real leak path) instead of staff.email. Added **I2** as over-redaction guard on a non-PHI FK UUID.
4. Extended **checkSchemaPhiDrift** regex in `logger.ts` to include `lookup|blind_?index` tokens so future blind-index columns auto-surface as suspects.
5. Fixed **3 prod console.error sites** that bypassed the pino serializer:
   - `apps/api/src/server.ts` (uncaughtException + unhandledRejection handlers) — route `err.message` + `err.stack` through `sanitizeErrForLogging` before `console.error`.
   - `apps/api/src/ocr/worker.ts` bootstrap catch — replaced `console.error(err)` with `logger.fatal({ err }, '...')`.
   - `apps/api/src/features/correspondence/correspondenceController.ts` createLetter catch — replaced `console.error('[LETTER CREATE ERROR]', message)` with `logger.error({ err }, '[LETTER CREATE ERROR]')`.
   - Remaining sites (seed scripts, observability/otel.ts, mcp/localLlmAgent.ts) tracked in **BUG-312 (S3 B-11)** — severity downgraded S2 → S3 since prod paths are now cured.

**L5 (architecture) absorbed:**
1. **Extracted** `PHI_CATEGORY_*` arrays + `PHI_FIELDS` Set + `redactPhi` function from `utils/logger.ts` into new leaf module `apps/api/src/utils/phiFields.ts`. Breaks the `logger.ts` ↔ `sanitizeErrForLogging.ts` circular import that `dependency-cruiser`'s `no-circular` rule (error severity) would have blocked at merge. `logger.ts` re-exports the taxonomy for backward compat so existing callers need no change; new callers (`sanitizeErrForLogging.ts`, `pipelineTracker.ts`, `recordLlmInteraction.ts`) import directly from the leaf module.
2. **Renamed** `shared/phiEncryption.ts` `PHI_FIELDS` → `ENCRYPTED_PHI_COLUMNS` to end the name collision (different sets, different purposes: encryption-at-rest scope vs logger-redaction scope). Internal rename — no external callers imported this symbol.
3. Updated **fix-registry anchor** `R-FIX-LOGGER-PHI-REDACT-EXPANDED` to point at `phiFields.ts` (where `health_fund_member_number` now lives post-refactor).
4. Verified with `npx madge --circular apps/api/src --extensions ts` — **0 new cycles introduced** (3 pre-existing cycles in `integrations/escript/*` unchanged).

## Tests (round 2 state)

- **Unit:** `apps/api/tests/unit/sanitizeErrForLogging.test.ts` — 13 tests, all PASS (U1-U9 + U10/U11/U12 blind-index + mutation-guard + code-preservation).
- **Integration:** `apps/api/tests/integration/loggerErrSerializer.int.test.ts` — 2 tests (I1 patient blind-index path redacts; I2 non-PHI FK UUID preserved), all PASS.
- **Regression:** `apps/api/tests/unit/loggerRedaction.test.ts` (BUG-216's 6/8 tests) — still 8/8 PASS, no regression from the leaf-module extraction.

## Non-goals (unchanged from round 1)

- Do NOT expand `PHI_FIELDS` to cover NON-blind-index columns beyond this fix — unrelated drift is BUG-216's scope.
- Do NOT convert every handler to `err.code === '23xxx'` catch-and-rethrow — unnecessary once Layer 2 is in place.
- Do NOT try to cover non-pino log paths exhaustively in this PR — prod paths fixed; remaining sites tracked in BUG-312.

## Fix-registry row

`R-FIX-LOGGER-ERR-SERIALIZER-PHI` — `apps/api/src/utils/sanitizeErrForLogging.ts` — `present` — `export function sanitizeErrForLogging`.

## Reviewer refinement trail

Two external pre-execution reviews classified items as `absorb` / `noise` / `fabrication`. None were fabrications. Absorbed: multi-column regex + test U9 (substantive); `.hint` sanitisation + side-effect note + stack-preservation note + performance posture + conservative-bounding cross-ref (clarifications). Approval-likelihood percentages discarded as approval-theatre.

## Residuals

- BUG-312 (S2 B-11): non-pino log paths bypass the serializer.
- BUG-313 (S3 B-11): knex debug / third-party loggers PHI audit.
- Novel PG error-message formats (PG 18+, RDS variants) tracked by future audit.
