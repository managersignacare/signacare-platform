# Signacare EMR — Development Rules

These rules are derived from 112 bugs found across 7 audit methods. Every rule exists because its absence caused a real bug in production code. Follow these to prevent the same classes of bugs from recurring.

---

## 1. DATABASE QUERIES

### 1.1 Column names must match the migration schema exactly
**Why:** 17 bugs were caused by code referencing columns that don't exist (`created_by` instead of `author_id`, `role_id` instead of `clinical_role_id`, `group_name` instead of `name`). These crash at runtime with no compile-time warning. NEW-S1-A/B/CASCADE-A/B (2026-04-30) closed 4 more in the same class — `lr.order_id` (actual `pathology_order_id`), `m.recipient_id` (column doesn't exist), `tasks.due_at` (actual `due_date`), `mtp.clinic_id` + `mtp.staff_id` (clinic_id doesn't exist on participants; participant col is `user_id`).

**Rule:** Before writing any query, open the migration file and verify the exact column name. Never guess. Copy-paste from the migration.

```typescript
// WRONG — guessing column names
db('staff_role_assignments').where({ role_id: roleId })

// RIGHT — verified against migration
db('staff_role_assignments').where({ clinical_role_id: roleId })
```

**Enforcement (Phase R1 PR-R1-13):** the `check-knex-column-references` guard (`npm run guard:knex-column-references`) AST-walks every TS file under `apps/api/src/{features,mcp,integrations,jobs}/`, parses every Knex builder column-string reference (`.where('a.col', val)` / `.where({a.col: val})` / `.whereRaw('col …')` / `.join('t', 'a.col', 'b.col')` / `.orderBy('col')` / `.groupBy(...)` / `.having(...)` / `.select('col as alias')` / `.distinct(...)` / `.returning(...)` / `db.raw('JOIN ... ON a.col = b.col')`), and cross-checks every column reference against `apps/api/src/db/schema-snapshot.json`. Two-stage validation: Stage 1 strict (dotted alias.column form, zero false-positives) + Stage 2 best-effort (bare column against bound table from preceding `db('table')` opener, with positional variable-binding tracking for `q.clone().where(...)` patterns). SQL fragments (`CURRENT_DATE`, `count(*)`, `CASE WHEN ... END`, etc.) and SQL keywords (`ELSE`, `WHEN`, `ASC`, etc.) are whitelisted. Inline `// @knex-col-exempt: <reason>` (REQUIRES non-empty reason) opt-out for legitimate edge cases. 30 baseline ghost-column references allowlisted in `scripts/guards/check-knex-column-references.allowlist` under `BUG-NEW-S1-CASCADE-DRAIN-KNEX-COLUMN-REFS` — drains as files are next touched per CLAUDE.md §15 incremental adoption. NEW ghost-column references cannot regress (mechanically blocked).

### 1.2 Every table reference must exist in the database
**Why:** 10 bugs were caused by code referencing tables that don't exist (`mha_orders` instead of `legal_orders`, `medications` instead of `patient_medications`, `users` instead of `staff`).

**Rule:** Before referencing a table name, verify it exists in the v2_baseline migration or a subsequent migration. If the table doesn't exist, create a migration first — never write code that references a table you haven't created.

### 1.3 Always include `clinic_id` in UPDATE, DELETE, and SELECT WHERE clauses
**Why:** 20+ queries were missing `clinic_id`, allowing cross-tenant data modification even with RLS as defense-in-depth.

**Rule:** Every query that modifies or reads patient/clinical data MUST include `clinic_id` in the WHERE clause. Never rely solely on RLS — application-level filtering is the first line of defense.

**Enforcement (Phase R1 PR-R1-15 belt):** the `check-empty-where-on-mutation` guard (`npm run guard:empty-where-on-mutation`) catches the ZERO-CLAUSE class — UPDATE / DELETE / .del() chains with NO `.where*` clause at all (which would unconditionally affect every row). 0 baseline violations on first run (codebase clean — `check-query-has-clinic-id.ts` already enforces the §1.3 main rule). Inline `// @empty-where-exempt: <reason>` opt-out for legitimate admin "factory reset" flows. Pure prevention guard for future regressions.

```typescript
// WRONG
db('patient_alerts').where({ id: alertId }).update(patch)

// RIGHT
db('patient_alerts').where({ id: alertId, clinic_id: req.clinicId }).update(patch)
```

### 1.4 Always filter soft-deleted records — but ONLY on tables that have the column
**Why:** ~30 queries returned deleted records because they were missing `.whereNull('deleted_at')`. Conversely, adding `.whereNull('deleted_at')` to tables that DON'T have the column causes 500 errors.

**Enforcement (Phase R1 PR-R1-13 + PR-R1-14):**
- **Phase R1 PR-R1-13** `check-knex-column-references.ts` catches the FALSE-PRESENCE half — `.whereNull('deleted_at')` on tables WITHOUT the column (the column-existence check rejects this as a ghost-column reference).
- **Phase R1 PR-R1-14** `check-soft-delete-filter.ts` catches the FALSE-ABSENCE half — SELECT chains on the 61 tables WITH `deleted_at` that lack `.whereNull('deleted_at')` / `.whereRaw('deleted_at IS NULL')` / `.whereNotNull('deleted_at')` (audit-only) / `.where('deleted_at', null)` etc. UPDATE / DELETE / INSERT chains are out of scope (they target specific rows by primary key intentionally regardless of soft-delete state — e.g., recovery flows). Inline `// @soft-delete-exempt: <reason>` opt-out for legitimate admin / audit / recovery surfaces (REQUIRES non-empty reason). 154 baseline violations allowlisted under `BUG-PR-R1-14-CASCADE-DRAIN-SOFT-DELETE` for incremental adoption when files are next touched.

**Rule:** Before adding `.whereNull('deleted_at')`, VERIFY the table actually has a `deleted_at` column. Not all tables use soft-delete — some use `is_active` (e.g., `hotspots`, `patient_alerts`, `patient_team_assignments`) or have no deletion mechanism at all (e.g., `messages`, `patient_providers`, `patient_legal_orders`, `patient_attachments`, `pathology_results`, `contact_records`, `structured_observations`, `treatment_pathways`).

**Tables WITHOUT deleted_at (DO NOT use `.whereNull('deleted_at')` on these):**
`contact_records`, `hotspots`, `messages`, `pathology_results`, `patient_alerts`, `patient_attachments`, `patient_legal_orders`, `patient_providers`, `structured_observations`, `treatment_pathways`

```typescript
// WRONG
db('episodes').where({ patient_id: patientId })

// RIGHT
db('episodes').where({ patient_id: patientId }).whereNull('deleted_at')
```

### 1.5 Never use `/api/v1/` prefix in `apiClient.instance` calls
**Why:** `apiClient.instance` already has `baseURL: '/api/v1'`. Adding `/api/v1/` to the URL doubles the prefix to `/api/v1/api/v1/...`, causing 404 errors. This bug appeared in 6 file upload endpoints (pathology, documents, physical health, alerts, ECT, legal).

**Rule:** When using `apiClient.instance.post()` or `.get()`, use relative paths: `patients/${id}/attachments`, NOT `/api/v1/patients/${id}/attachments`.

### 1.6 Every INSERT on an RLS-protected table MUST include `clinic_id`
**Why:** 111 tables have Row Level Security enabled. RLS policies check `clinic_id = current_setting('app.clinic_id')`. An INSERT without `clinic_id` will be rejected with "new row violates row-level security policy". This caused pathology upload, MDT allocation, and referral team assignment failures.

**Rule:** Before writing any INSERT, check if the table has RLS enabled. If yes, include `clinic_id: req.clinicId` in the INSERT. Never assume `clinic_id` is optional.

### 1.7 Data stored in JSONB must be extracted in GET responses
**Why:** Several tables store extended data in JSONB columns (`milestones`, `content`, `contact_meta`). When the frontend expects these as top-level fields (e.g., `pathway_type`, `total_sessions`), the GET endpoint must extract them from the JSONB. Returning the raw JSONB column and expecting the frontend to parse it causes crashes.

**Tables with JSONB data that needs extraction:**
- `treatment_pathways.milestones` → `pathwayType`, `totalSessions`, `completedSessions`, `startDate`, `endDate`
- `templates.content` → array of form fields (likert, score, heading, etc.)
- `contact_records.content` → `team`, `location`, `contactMedium`, `program`, `serviceRecipients`
- `escalations.description` → ISBAR fields (TEXT column today; legacy doc — JSON content stored in `content` JSONB siblings)

**Enforcement (Phase R1 PR-R1-4):** the `check-jsonb-extraction` guard (`npm run guard:jsonb-extraction`) auto-discovers JSONB columns by parsing `apps/api/migrations/*.ts` for `t.jsonb('col')` declarations within `createTable`/`alterTable` blocks (68 tables × N JSONB columns currently). For every TS file under `apps/api/src/features/` that queries a JSONB-bearing table (via `db('<table>')`, `dbRead(...)`, `trx(...)`, `.from('<table>')`, `.into('<table>')`), the guard asserts the same file contains a `*ToResponse(...)` mapper that references at least one of the JSONB column names — proof that JSONB extraction is in place. Files that genuinely don't need extraction (write-only flows; raw audit dumps where extraction would lose forensic data) annotate with `// @jsonb-extraction-exempt: <reason>`. The 73-entry baseline allowlist (`scripts/guards/check-jsonb-extraction.allowlist`) tracks pre-existing files under `BUG-JSONB-EXTRACTION-MIGRATE-CONSUMERS` — drains as routes migrate per CLAUDE.md §1.7 incremental adoption.

### 1.8 Never interpolate user input into SQL — even inside parameterized queries
**Why:** SQL injection was found where `req.params` were template-interpolated into LIKE pattern strings, and LIKE wildcards (`%`, `_`) in search terms were not escaped.

**Rules:**
- Never use template literals inside `db.raw()`, `whereRaw()`, or LIKE patterns
- Always escape LIKE wildcards in search input using `escapeLike()` utility
- Use parameterized `?` placeholders for all dynamic values

```typescript
// WRONG — interpolation inside parameter value
.whereRaw("content LIKE ?", [`%"sourceId":"${params.sourceId}"%`])

// RIGHT — escape and parameterize
.whereRaw("content::jsonb->>'sourceId' = ?", [params.sourceId])

// WRONG — unescaped LIKE wildcard
.whereRaw("name ILIKE ?", [`%${searchTerm}%`])

// RIGHT — escaped
.whereRaw("name ILIKE ?", [`%${escapeLike(searchTerm)}%`])
```

### 1.6 Use atomic operations for counters and state transitions
**Why:** 5 race conditions were found where read-then-write patterns allowed concurrent requests to overwrite each other.

**Rules:**
- Use `db.raw('column + 1')` for counter increments, never read → increment in JS → write
- Use `FOR UPDATE` when checking a status before changing it
- Add unique constraints for business rules that require uniqueness (one team per patient, one active episode per type)

```typescript
// WRONG — race condition
const pathway = await db('treatment_pathways').where({ id }).first();
await db('treatment_pathways').where({ id }).update({ completed_sessions: pathway.completed_sessions + 1 });

// RIGHT — atomic
await db('treatment_pathways').where({ id }).update({ completed_sessions: db.raw('completed_sessions + 1') });
```

**Optimistic locking on multi-writer clinical tables (BUG-371):**
- Tables with concurrent writers from multiple surfaces (prescriber + dispenser + pharmacist; multiple-clinician edits during handover) MUST have a `lock_version` integer column.
- All single-row UPDATEs on such tables MUST go through `updateWithOptimisticLock()` from `apps/api/src/shared/db/optimisticLock.ts`, which enforces `WHERE id = ? AND clinic_id = ? AND lock_version = ?` + `lock_version = lock_version + 1` atomically.
- 0-row UPDATE → throws `AppError(409, 'OPTIMISTIC_LOCK_CONFLICT')` carrying `{ table, where, expectedLockVersion }` so the frontend can surface a "Another clinician edited this — refresh and retry" toast.
- Currently locked: `clinical_notes` (HAZARD-006 inline; BUG-371-FOLLOWUP-4 will refactor to consume the helper), `prescriptions`, `patient_medications`, `episodes` (BUG-371), `treatment_pathways` (BUG-402), `risk_assessments` (BUG-564 — preventive), `medication_administrations` (BUG-PR-R1-12-FIX-S0-medication_administrations — preventive; S0), `restrictive_interventions` (BUG-PR-R1-12-FIX-S0-restrictive_interventions — REQUIRED on `/end`; S0), `mha_reviews` (BUG-PR-R1-12-FIX-S1-mha_reviews — preventive), `escalations` (BUG-PR-R1-12-FIX-S1-escalations — REQUIRED on update/resolve/addNote; acknowledge keeps legacy posture per BUG-371c asymmetric), `lai_given` (BUG-PR-R1-12-FIX-S1-lai_given — preventive; INSERT-only repository today), `clinical_note_codes` (BUG-PR-R1-12-FIX-S1-clinical_note_codes — REQUIRED on updateCode accept/reject; AHPRA attribution chain), `clinical_note_evidence` (BUG-PR-R1-12-FIX-S1-clinical_note_evidence — preventive; no feature handler today), `phone_triage` (BUG-PR-R1-12-FIX-S1-phone_triage — REQUIRED on receptionist PUT + nurse PATCH /clinical-triage), `shift_handovers` (BUG-PR-R1-12-FIX-S1-shift_handovers — REQUIRED on nurse PATCH; AHPRA Standard 6 handover record).
- `expectedLockVersion` is REQUIRED in the Zod DTO for prescribing surfaces (prescriptions, patient_medications) and for `treatment_pathways` (single-deploy admin web mutators only; atomic flip safe). It is OPTIONAL with structured pino warn-log for `episodes` (transition strategy; tightening tracked in BUG-371-FOLLOWUP-3). Asymmetric posture is harm-class-driven, not stylistic.
- BUG-402 — `treatment_pathways` row mutations merge `milestones` JSONB inside the repository (`pathwayRepository.update` does the shallow merge then calls the helper) so concurrent `+1 session` calls cannot both win. R-FIX-BUG-402-CLAUDEMD
- Helper rejects misuse: caller-supplied `lock_version` or `updated_at` in patch (would silently double-increment), `expectedLockVersion <= 0`, missing `id` / `clinic_id` in WHERE, empty patch, empty `returning`. Each rejection throws a plain `Error` (programmer-misuse signal, NOT user-facing 4xx).

---

## 2. TRANSACTIONS & CONNECTION POOL

### 2.1 Every query inside a transaction MUST use the transaction object
**Why:** 4 connection pool leaks were caused by calling `db()` inside a `db.transaction()` block. `db()` opens a NEW connection from the pool; only `trx()` uses the transaction's connection.

**Rule:** Inside any `db.transaction(async (trx) => { ... })` block, every query must use `trx()`, never `db()`. If calling a repository method inside a transaction, that method must accept and use the `trx` parameter.

```typescript
// WRONG — leaks a connection
db.transaction(async (trx) => {
  await trx('escalations').insert({ ... });
  const esc = await escalationRepository.findById(clinicId, id); // uses db(), not trx!
});

// RIGHT
db.transaction(async (trx) => {
  await trx('escalations').insert({ ... });
  const esc = await escalationRepository.findById(clinicId, id, trx); // passes trx
});
```

**Enforcement (Phase R1 PR-R1-5 cycle-2):** the `check-trx-not-db-inside-transaction` guard (`npm run guard:trx-not-db-inside-transaction`) AST-walks every TS file under `apps/api/src/features/`, locates every `db.transaction(callback)` / `dbRead.transaction(callback)` invocation, and REJECTs three leak shapes inside the callback body:

  - **Direct call** — `db(...)` / `dbRead(...)` / `db.raw(...)` / `dbRead.raw(...)` (the easy half).
  - **Repo-helper without trx** — `xxxRepository.method(...)` / `xxxRepo.method(...)` not passing the transaction parameter as an argument. CLAUDE.md §2.1's canonical example (`escalationRepository.findById(clinicId, id)` without `trx`) is exactly this shape — a repo helper that internally calls `db(...)` and silently opens a fresh pool connection.
  - **Pure helpers exempt** — `mapXxxToResponse`, `parseDate`, `dateToIso`, etc. don't end in `Repository`/`Repo` and aren't flagged. Inline `// @trx-not-needed: <reason>` opt-out for repos that legitimately don't touch the DB on a particular method (rare).

**Out of scope (intentional, documented in the guard's header):**
- `apps/api/src/middleware/` and `apps/api/src/shared/` — these layers use raw pool primitives (`appPoolRaw`, `dbAdmin`) outside the §2.1 identifier convention.
- Aliased imports of `db` (`import { db as database } from ...`) — codebase uses unaliased `db` everywhere; tracked as `BUG-PR-R1-5-FOLLOWUP-ALIASED-DB-IMPORT`.

**Baseline (cycle-2):** 3 pre-existing repo-helper leaks were surfaced and fixed in this same PR (templateRepository.findById ×2 + appointmentAttendeeRepository.listForAppointment). Both repo signatures were extended with optional `trx?: Knex.Transaction` parameters and the transaction-internal call sites updated to propagate the trx. After cycle-2 fixes: 0 violations across 276 files. Future regressions of either leak class are mechanically prevented.

### 2.2 Never fire-and-forget async operations inside request handlers
**Why:** 4 services used `void createAutoContactRecord()` which outlives the request transaction, can hold connections after the response is sent, and silences errors.

**Rule:** Every async operation in a request handler must be `await`ed. If the operation is non-critical (like ABF contact record creation), wrap it in try/catch but still `await` it. If it truly must be non-blocking, use a job queue (BullMQ/Redis), not `void`.

```typescript
// WRONG — fire and forget
void createAutoContactRecord({ ... });

// RIGHT — await with error isolation
try {
  await createAutoContactRecord({ ... });
} catch (err) {
  logger.error({ err }, 'Non-critical: contact record creation failed');
}
```

### 2.3 SAVEPOINT operations must be in try/finally
**Why:** SAVEPOINT RELEASE without try/catch can leave the parent transaction in an undefined state if it fails.

```typescript
await db.raw('SAVEPOINT sp');
try {
  // ... operations ...
  await db.raw('RELEASE SAVEPOINT sp');
} catch (err) {
  await db.raw('ROLLBACK TO SAVEPOINT sp').catch(() => {});
  throw err; // or handle gracefully
}
```

---

## 3. EXPRESS ROUTE HANDLERS

### 3.1 Every async route handler MUST have try/catch and call next(err)
**Why:** 25+ handlers were missing error handling. An unhandled async error in Express (pre-v5) becomes an unhandled promise rejection that crashes the server.

**Rule:** Every async handler must follow this pattern:

```typescript
router.post('/endpoint', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // ... handler logic ...
    res.json({ data });
  } catch (err) {
    next(err); // ALWAYS pass to error middleware
  }
});
```

**Never:**
- Omit the `next` parameter
- Use `res.status(500).json()` in catch without also calling `next(err)`
- Leave async handlers without try/catch

L4 reviewer checklist canonical at `docs/quality/l4-reviewer-checklist.md` (silent-catch / lie-about-success / cascade-scan classes).

### 3.2 Wrap setInterval/setTimeout callbacks in try/catch
**Why:** Timer callbacks run outside Express error handling. An error inside a `setInterval` crashes the process.

```typescript
setInterval(async () => {
  try {
    await someOperation();
  } catch (err) {
    logger.error({ err }, 'Scheduled task failed');
  }
}, interval);
```

**Enforcement (Phase R1 PR-R1-24):** the `check-timer-try-catch` guard (`npm run guard:timer-try-catch`) walks every TS file under `apps/api/src/` (skipping migrations, dist, tests), strips comments + string literals to suppress false-positives on documentation/error-message mentions, then finds every `\b(?:setInterval|setTimeout)\s*\(\s*async\b` opener. The body-locator state-machine (`findCallbackBodyStart`) handles all four async callback forms: (a) arrow `async () => { ... }`, (b) typed-arrow `async (ctx: Context): Promise<void> => { ... }`, (c) anonymous function `async function () { ... }`, (d) named function `async function name(): Promise<void> { ... }`. Return-type annotations are skipped via depth-tracked walk through `()`, `[]`, `<>`, `{}` so `Promise<{r:number}>` doesn't false-match its inner `{` as the body. Once the body is located, the guard asserts it contains at least one `\btry\s*\{` block. Inline `// @timer-try-catch-exempt: <reason>` (REQUIRES non-empty reason) opt-out for legitimate trivial async bodies (e.g., calling an infallible Promise). Scope is async callbacks only — synchronous timer callbacks (`setTimeout(r => r, 100)` Promise-resolvers, `setTimeout(() => process.exit(1), 3000)` graceful shutdowns) don't have rejected-promise paths and are out of scope. Baseline: 2 async timer sites in 2 files, both already wrapped — purely preventive enforcement. **Documented v1 lenience (tracked in BUG-PR-R1-24-FOLLOWUP-FIRST-STATEMENT-TRY, S3):** the check accepts ANY `try {` block in the body, including nested ones inside an `if` branch — this means a timer that wraps only part of its work would currently PASS. A future tighter check could require the body's FIRST non-comment statement to be `try {`. The 2 known sites both wrap-immediately, so this lenience is currently inert.

### 3.3 Add .on('error') to all streams
**Why:** 3 `createReadStream` calls had no error handler, causing unhandled errors on file access failures.

```typescript
const stream = fs.createReadStream(path);
stream.on('error', (err) => {
  logger.error({ err, path }, 'Stream read failed');
  if (!res.headersSent) res.status(500).json({ error: 'File read failed' });
});
```

**Enforcement (Phase R1 PR-R1-23):** the `check-stream-error-handler` guard (`npm run guard:stream-error-handler`) walks every TS file under `apps/api/src/` (skipping migrations, dist, tests), strips line + block comments to suppress false-positives on commented-out examples, then finds every `\bcreate(?:Read|Write)Stream\s*\(` opener. Two detection paths: (1) chained `fs.createReadStream(p).on('error', ...)` directly on the return value (200-char window after closing paren); (2) variable-bound `const s = fs.createReadStream(p); s.on('error', ...)` where the assignment LHS is captured via backward-walk to the closest non-comparison `=` token (skipping `:` Type-annotation tokens to avoid capturing `ReadStream` from `fs.ReadStream`), then `<varName>.on('error', ...)` checked within a 2500-char forward window that terminates early when the same variable is rebound to another stream (prevents shadowing false-negatives). Inline `// @stream-error-exempt: <reason>` (REQUIRES non-empty reason) opt-out; empty reasons rejected. Baseline: 6 stream sites in 4 files, ALL already have handlers attached at guard-landing time — purely preventive enforcement. Allowlist `scripts/guards/check-stream-error-handler.allowlist` is empty.

### 3.4 Service-layer expected failures: return Result<T, AppError>, do NOT throw
**Why (BUG-530, 2026-04-26):** the BUG-445 / BUG-446 / BUG-520 / BUG-521 / BUG-523 cluster all share the same shape — a service either threw (caller forgot to wrap) or returned `null | undefined | []` (caller forgot to narrow). Both lose the *expected vs unexpected* distinction. `Result<T, AppError>` from `@signacare/shared` makes the distinction explicit and the type system enforces narrowing.

**Rule:** at the service layer (`apps/api/src/features/<X>/<X>Service.ts`):
- **Expected failures** — validation, NOT_FOUND, business-rule violations, optimistic-lock conflicts, foreign-key conflicts: return `Result.err(new AppError(...))`. The route narrows via `isErr(r)` and surfaces `r.error` to the client.
- **Unexpected failures** — DB connection lost, OOM, programming bugs: let them throw. The Express outer try/catch + `next(err)` handler at the route boundary (§3.1) catches them and the global error middleware in `apps/api/src/shared/errors.ts` maps to a wire response.

The two-rail discipline is:
```typescript
// service
async function getMedication(auth: AuthContext, id: string): Promise<Result<Medication, AppError>> {
  const row = await medicationRepository.findById(auth.clinicId, id);  // throws on DB-down
  if (!row) return Result.err(new AppError('Medication not found', 404, 'NOT_FOUND'));
  return Result.ok(toResponse(row));
}

// route
router.get('/medications/:id', async (req, res, next) => {
  try {
    const r = await medicationService.getMedication(buildAuthContext(req), req.params.id);
    if (isErr(r)) return next(r.error);  // expected — surfaced via global error mapper
    res.json(r.value);
  } catch (err) {
    next(err);  // unexpected — same global error mapper
  }
});
```

The canonical replacement for `try { x = await foo(); } catch { x = []; }` (BUG-445 root shape) is `tryAsync(() => foo())` — see §16.2. The ESLint rule `signacare-rules/no-empty-catch-on-safety-surface` (BUG-531; lives in `eslint-plugins/signacare-rules/`, wired in `.eslintrc.cjs` as `error`) flags empty catches on safety surfaces and offers a suggestion-mode autofix that points at this shape.

---

## 4. REACT QUERY (FRONTEND)

### 4.1 Mutation invalidation keys must exactly match query keys
**Why:** 10 hooks had mismatched invalidation keys, causing "data saves but doesn't appear in the UI" bugs.

**Rule:** When a mutation's `onSuccess` calls `invalidateQueries`, the key must be a prefix of or exactly match the query key used by the component that displays the data.

```typescript
// Query
useQuery({ queryKey: ['medications', patientId, episodeId] })

// WRONG invalidation — doesn't match the 3-part key
invalidateQueries({ queryKey: ['medications', patientId] })

// RIGHT — matches as prefix OR full key
invalidateQueries({ queryKey: ['medications', patientId, episodeId] })
// OR invalidate all medication queries for this patient:
invalidateQueries({ queryKey: ['medications', patientId], exact: false })
```

### 4.2 Every save button must call an API
**Why:** 2 save buttons only updated React state without persisting to the backend. Data was lost on page refresh.

**Rule:** Every button labeled "Save", "Create", "Submit", "Update", or "Confirm" MUST trigger a `useMutation` that calls the backend API. Local state updates alone are never sufficient.

**Verify:** After clicking Save, refresh the page. If data disappears, the save isn't persisting.

### 4.3 Every mutation must invalidate related queries
**Rule:** After a successful mutation, invalidate ALL queries that display the affected data. Use query key factories to keep keys consistent.

```typescript
// Define keys in one place
export const medicationKeys = {
  all: ['medications'] as const,
  list: (patientId: string, episodeId?: string) => ['medications', patientId, episodeId] as const,
  detail: (id: string) => ['medications', 'detail', id] as const,
};

// Use consistently
useQuery({ queryKey: medicationKeys.list(patientId, episodeId) });
// Invalidation
invalidateQueries({ queryKey: medicationKeys.all }); // broad
invalidateQueries({ queryKey: medicationKeys.list(patientId) }); // specific
```

---

## 5. API CONTRACTS

### 5.1 Backend responses must match shared schema types
**Why:** 8 mismatches were found between frontend expectations and backend response shapes (wrong enum values, flat vs nested objects, missing fields).

**Rules:**
- Define response types in `packages/shared/src/` — this is the single source of truth
- Backend services must map database rows to the shared response type (never return raw DB rows)
- Frontend must import types from `@signacare/shared` (never define duplicate interfaces)
- Enum values must match exactly between frontend and backend

```typescript
// WRONG — returning raw DB row
res.json({ note: row }); // row has snake_case: note_type, signed_by_id

// RIGHT — map to shared response type
res.json({ note: mapNoteRowToResponse(row) }); // camelCase: noteType, signedById
```

### 5.2 Backend must map snake_case DB columns to camelCase response fields
**Why:** The codebase has no automatic conversion. Every manual mapping is a potential bug.

**Rule:** Every GET endpoint must explicitly map DB column names to camelCase response fields. Never pass raw Knex rows directly to `res.json()`.

### 5.3 Response-shape Zod validation MANDATE (Phase R1 PR-R1-9)
**Why (BUG-638 + BUG-623 + BUG-613/618/622 closing class):** the response-shape guard (PR-R1-1.5+) enforces structural canonicality on every `res.json()`, but a route can still ship without a Zod-validated shape if the mapper itself returns the wrong fields. The MANDATE elevates the rule from "do this for new mappers" (advisory in cycle-1 §5.2) to "every NEW route handler MUST end with a Zod-validated response, no exceptions; existing 884-entry allowlist drains as routes migrate per BUG-638-CASCADE-MIGRATE-MAPPER-CONSUMERS".

**Rule (canonical shape for every NEW route handler):**

```typescript
import { z } from 'zod';
import { MedicationResponseSchema } from '@signacare/shared';

router.get('/medications/:id', async (req, res, next) => {
  try {
    const r = await medicationService.getMedication(buildAuthContext(req), req.params.id);
    if (isErr(r)) return next(r.error);
    // CANONICAL: parse before sending — guarantees response shape matches contract
    res.json(MedicationResponseSchema.parse(r.value));
  } catch (err) {
    next(err);
  }
});
```

The `Schema.parse(value)` call is REQUIRED for any NEW route handler; the existing response-shape guard catches non-canonical literals (mapper / Schema.parse / safe-literal). The mandate makes Zod-parsing the PRIMARY pattern; `*ToResponse(row)` mappers are an acceptable alternative IF they themselves return Zod-validated shapes (the recommended canonical mapper signature is `(row: XRow): XResponse` where the function body internally calls `XResponseSchema.parse(...)` before returning).

**Acceptance criteria for NEW routes (per PR-R1-9 mandate):**
- Response shape defined in `packages/shared/src/<feature>.schemas.ts` as a Zod schema (ResponseSchema convention).
- Service layer returns canonical TypeScript types (inferred from the Zod schema via `z.infer<typeof XResponseSchema>`).
- Route handler ends with either:
  1. `res.json(XResponseSchema.parse(value))` — preferred, validates at the boundary
  2. `res.json(mapXxxToResponse(row))` — acceptable IF the mapper internally Zod-parses
- Status responses (`res.json({ ok: true })` / `res.status(204).end()`) remain exempt — the response-shape guard's safe-literal allowlist already covers these.

**Drain plan:** the 912-entry response-shape allowlist tracked under `BUG-638-CASCADE-MIGRATE-MAPPER-CONSUMERS` drains as routes migrate to the canonical shape. The mandate ensures NEW routes cannot be added to the allowlist (they must ship Zod-parsed from day one).

**Enforcement layering:**
- **Layer 1 (already shipped):** response-shape guard rejects non-canonical `res.json(rawRow)` per §5.2.
- **Layer 2 (PR-R1-9 mandate doc):** this section in CLAUDE.md is the canonical reference for L3 reviewers — any NEW route without the Zod parse pattern is REJECTed at code-review time.
- **Layer 3 (Phase R2):** subset-rewrite of 5 feature groups via the mapper-at-boundary + Zod-at-response pattern; each group rewrite drains its allowlist entries.

---

## 6. SECURITY

### 6.1 Never use innerHTML with dynamic content
**Why:** XSS vulnerability found in BedBoardPage where patient names were rendered via innerHTML without escaping.

**Rule:** Use `textContent` for plain text, `DOMPurify.sanitize()` for HTML. Never use `.innerHTML` with data from API responses or user input.

### 6.2 Never hardcode secrets, passwords, or API keys
**Why:** 3 hardcoded secrets found (default password, DB password fallback, API key fallback).

**Rules:**
- Secrets come from environment variables only — no fallback values
- If an env var is missing, the feature must fail loudly (throw), not silently use a default
- Default passwords are forbidden — generate random credentials with `crypto.randomBytes()`

### 6.3 Every table with clinic_id must have RLS policies
**Why:** 101 of 103 tables had no Row Level Security, relying entirely on application code for tenant isolation.

**Rule:** When creating a new table with `clinic_id`, ALWAYS add in the same migration:
```sql
ALTER TABLE new_table ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_new_table_tenant ON new_table
  FOR ALL
  USING (clinic_id = current_setting('app.clinic_id', true)::uuid)
  WITH CHECK (clinic_id = current_setting('app.clinic_id', true)::uuid);
```

**Enforcement (Phase R1 PR-R1-17):** the `check-migration-rls-policy` guard (`npm run guard:migration-rls-policy`) walks every Knex migration file under `apps/api/migrations/*.ts` (skipping `@migration-squashed-baseline` files), parses every `createTable` body, and for any table declaring `t.uuid('clinic_id')` asserts the same migration file ALSO contains `ALTER TABLE <table> ENABLE ROW LEVEL SECURITY` AND `CREATE POLICY ... ON <table>` raw SQL blocks. Inline `// @migration-rls-exempt: <reason>` (REQUIRES non-empty reason) opt-out for non-tenant-scoped tables where clinic_id is a coincidental column name. 0 baseline violations on first run (codebase clean post-BUG-454). Pure prevention guard for future regressions.

### 6.4 File uploads must validate MIME type, not just extension
**Why:** Extension-only validation allows renaming `.exe` to `.pdf` to bypass filters.

**Rule:** Check both file extension AND MIME type. Use the `file-type` package for content-based validation when possible. Add upload-specific rate limits (separate from API rate limits).

### 6.5 Frontend security gates fail CLOSED, not OPEN
**Why (BUG-416, 2026-04-26):** `useModuleVisibility` returned `() => true` predicates on upstream-fetch error, exposing specialty-gated clinical surfaces (ECT, TMS, MHA, legal, advance-directives, oncology, surgery, paediatrics, O&G, endocrinology, GIM-chronic-disease) to clinicians without the entitlement on transient network blips. Mirrors the backend BUG-444 license-middleware fail-OPEN class.

**Rule:** Any frontend hook or component that gates UI on a permissions / entitlements / specialty fetch MUST fail CLOSED on `isError`: hide gated surfaces, keep core / alwaysOn / unlisted surfaces visible, and surface the error state (`isError: true`) so consumers can render an error banner. **Never `return () => true` from an `isError` branch.** The shared `isPatientTabVisible(_, emptySet)` / `isNavItemVisible(_, emptySet)` helpers in `packages/shared/src/moduleRegistry.ts` already encode the correct policy (core + alwaysOn + unlisted visible, gated hidden) — delegate to them rather than synthesising a permissive fallback predicate.

**Anti-pattern resurrection prevention:** the `R-FIX-BUG-416-FAIL-OPEN-ABSENT` and `R-FIX-BUG-416-NO-TRUE-PREDICATE-IN-ERROR` fix-registry anchors fail CI on any future re-introduction of a `failOpen` function or `() => true` predicate inside this hook.

---

## 7. DATABASE SCHEMA

### 7.1 Every table with patient_id or clinic_id must have an index
**Why:** 20 tables had no patient_id index, causing slow queries. 164 FK columns had no index, causing slow JOINs.

**Rule:** When creating a table with foreign key columns, always add indexes:
```typescript
t.uuid('patient_id').notNullable().references('id').inTable('patients');
t.uuid('clinic_id').notNullable().references('id').inTable('clinics');
t.index(['patient_id']);  // ALWAYS add
t.index(['clinic_id']);   // ALWAYS add
```

**Enforcement (Phase R1 PR-R1-16):** the `check-migration-index-discipline` guard (`npm run guard:migration-index-discipline`) walks every Knex migration file under `apps/api/migrations/*.ts` (skipping `@migration-squashed-baseline` files), parses every `createTable` / `alterTable` body, extracts every column with `.references('id').inTable(...)` (FK declaration) + every `t.uuid('clinic_id')` / `t.uuid('patient_id')` declaration, and asserts each has a corresponding `t.index([...])` (alone or as the first element of a composite index). Primary-key columns are skipped (implicitly indexed by Postgres). Inline `// @migration-index-exempt: <reason>` (REQUIRES non-empty reason) opt-out for legitimate small-lookup-table cases. 44 baseline violations allowlisted under `BUG-PR-R1-16-CASCADE-DRAIN-MIGRATION-INDEXES` for incremental drain via ad-hoc index-add migrations. NEW migrations cannot regress.

### 7.2 Business uniqueness rules must have database constraints
**Why:** Race conditions allowed duplicate team assignments, duplicate staff emails, and appointment double-booking because uniqueness was only checked in application code.

**Rule:** If a business rule says "only one X per Y", enforce it with a UNIQUE constraint:
```typescript
t.unique(['patient_id', 'org_unit_id']); // one team assignment per patient per unit
t.unique(['clinic_id', 'email']);         // one staff email per clinic
```

### 7.3 Critical columns must be NOT NULL
**Why:** 143 columns that should be NOT NULL (patient_id, clinic_id, created_at) were nullable, allowing orphaned records.

**Rule:** `patient_id`, `clinic_id`, and `created_at` are ALWAYS `.notNullable()`. Only make a foreign key nullable if the relationship is genuinely optional (e.g., `episode_id` on a note that may not be linked to an episode).

### 7.3.1 Prescribing-tables checklist — discipline barrier is mandatory
**Why:** BUG-040 landed AHPRA discipline-barrier triggers on `patient_medications` (blocks psychologists / RNs / social-work etc. from being recorded as prescribers). BUG-292 extended the barrier to `prescriptions` (eScript) and BUG-293 to the clozapine tables. Any FUTURE table that carries a `prescribed_by_staff_id` column MUST attach the same barrier in its CREATE TABLE migration, or the gap re-opens. This is exactly the regression class BUG-290 was filed to prevent.

**Rule:** when creating a table with `prescribed_by_staff_id`, the same migration MUST:

1. Attach `BEFORE INSERT` and `BEFORE UPDATE OF prescribed_by_staff_id` triggers that call the shared SQL function `is_prescribing_eligible_discipline(slug text)` (defined in migration `20260421000003_prescriber_discipline_barrier.ts`).
2. Name the trigger function `<table>_prescriber_discipline_check()` for clarity.
3. Raise `'prescriber discipline "%" not authorised to prescribe (BUG-040)'` on reject — matches BUG-040's existing message shape so operators see consistent errors across prescribing surfaces.
4. Allow NULL `prescribed_by_staff_id` (legacy/transient rows) — the barrier only fires when the column is being SET to a non-NULL value.
5. Trigger fires for ALL roles including `dbAdmin` (FORCE ROW LEVEL SECURITY equivalent — defence against compromised owner role or direct SQL bypass).
6. Add integration tests mirroring BUG-040's 10-test pattern: psychiatrist / NP / GP allow × psychologist / RN block × UPDATE-swap raises × NULL allowed × app-layer 403.

Also update the service layer with `requirePrescribingDiscipline(auth: AuthContext)` from `apps/api/src/shared/authGuards.ts` at every write path — Layer A to the DB trigger's Layer B (defence in depth).

```sql
-- Canonical shape (from BUG-292 migration)
CREATE TRIGGER <table>_prescriber_discipline_before_insert
  BEFORE INSERT ON <table>
  FOR EACH ROW EXECUTE FUNCTION <table>_prescriber_discipline_check();

CREATE TRIGGER <table>_prescriber_discipline_before_update
  BEFORE UPDATE OF prescribed_by_staff_id ON <table>
  FOR EACH ROW EXECUTE FUNCTION <table>_prescriber_discipline_check();
```

Reviewers must REJECT any new migration adding a `prescribed_by_staff_id` column that doesn't attach this trigger — the column is the audit-evidence record of who wrote a prescription; accepting an unlicensed discipline as a prescriber is AHPRA non-compliance. Audit the 2026-04-19 catalogue allow-list of prescribing disciplines: `psychiatry`, `general-practice`, `nurse-practitioner`. Future additions (midwives, dentists, podiatrists, optometrists, vaccinating-pharmacists) require a CAB decision and update to `is_prescribing_eligible_discipline` — they are NOT assumed.

### 7.4 Migration SQL must never hardcode database or role names
**Why:** On 2026-04-15 a local-dev login failure surfaced a three-way naming drift between `.env.production`, `apps/api/.env.example`, the working-tree `apps/api/.env`, and `apps/api/src/db/migrations/20260329_rls_app_user.sql`, which hardcoded `GRANT ... ON DATABASE signacareemr` and `ALTER DEFAULT PRIVILEGES FOR ROLE signacare` — names that only ever existed aspirationally. The migration would have failed the next production deploy. Phase 0.5 rewrote that migration to be name-agnostic and added `.github/scripts/check-no-stray-db-names.sh` to prevent recurrence.

**Rule:** Migration SQL must never hardcode a database name or owner role in `GRANT`, `REVOKE`, or `ALTER DEFAULT PRIVILEGES` statements. Use `current_database()` for the DB, and `current_setting('app.owner_role')` (set via `SET LOCAL app.owner_role = current_user` at the top of the migration) for the owner. The canonical names (`signacare_owner`, `app_user`, `signacaredb`) live in `.env.example` and `docs/guides/deployment-guide.md §2` and nowhere else.

**Exception:** bootstrap statements — `CREATE ROLE`, `CREATE DATABASE`, and the one-time rename migration `apps/api/migrations/20260505000000_rename_db_and_role.ts` — may use the literal canonical names, and are whitelisted in the CI guard. No other file may mention `nous`, `nousdev`, `nousemr`, `noususer`, or `signacareemr`.

```sql
-- WRONG — hardcoded literals
GRANT CONNECT ON DATABASE signacareemr TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE signacare IN SCHEMA public
  GRANT SELECT ON TABLES TO app_user;

-- RIGHT — dynamic, works against any canonical name
SET LOCAL app.owner_role = current_user;
GRANT CONNECT ON DATABASE current_database() TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE current_setting('app.owner_role') IN SCHEMA public
  GRANT SELECT ON TABLES TO app_user;
```

---

## 8. TESTING VERIFICATION

Before merging any PR, verify:

1. **TypeScript compiles:** `npx tsc --noEmit` — zero errors in changed files
2. **Server starts:** `npm run dev` — both API and web start without errors
3. **Health check:** `curl localhost:4000/health` returns `{"status":"ok"}`
4. **Smoke test:** Login → view patient → core workflow for the affected module
5. **Query keys:** After saving data, verify the UI updates without manual refresh
6. **Soft deletes:** Soft-deleted records should NOT appear in any list or dropdown
7. **Multi-tenant:** Test with two different clinic logins — each should only see their own data

---

## 9. PROCESS

### 9.1 Schema changes require migration + code update in same PR
Never merge a migration without updating all code that references the affected tables/columns. Never merge code changes that reference new columns without the migration.

### 9.2 New features require both frontend and backend
Never merge a frontend button/form without a working backend endpoint. Never merge a backend endpoint without frontend UI that calls it.

### 9.3 Every new table needs: RLS policy, clinic_id index, patient_id index (if applicable), NOT NULL on required columns, unique constraints for business rules
This is the "new table checklist" — no exceptions.

### 9.4 Every frontend `apiClient` URL must resolve to a backend handler
**Why:** Deep audit on 2026-04-16 found three `apiClient.get('risk-assessments/templates[/*]')` and one `apiClient.get('risk-assessments/patient/:id')` call that returned 404 because no backend router declared those paths. The "no dead mounts" guard (`check-mounted-routes-have-callers.sh`) catches the reverse direction — routes without callers — but the forward direction (callers without routes) was invisible and the bugs lived silently for weeks.

**Rule:** Every `apiClient.instance.(get|post|put|delete|patch)('some/path')` and every `apiClient.(get|post|put|delete|patch)('some/path')` call must target a path that's declared by at least one `router.(get|post|…)(…)` inside `apps/api/src/features/**/*Routes.ts` (after the mount prefix from `server.ts` is applied). A dynamic URL (`${ids.join(',')}`) that can't be resolved at parse time must be registered in an allowlist file with a rationale.

**Enforcement:** `scripts/guards/check-frontend-calls-backend-route.ts` walks every frontend `apiClient.*` call site, resolves the literal URL, and asserts a matching backend handler exists. Wired into the merge gate alongside the other guards. Dynamic URLs that can't be resolved at parse time are registered in the guard's allowlist with a rationale.

### 9.5 Every bug fix must add or update a `docs/quality/fix-registry.md` row
**Why:** The registry guard catches silent unwinding of *known* fixes. It cannot catch fixes that were never registered — every pre-existing bug found by a future audit is a fix that wasn't registered. The audit of 2026-04-16 found 7 real bugs; 0 had registry rows before the audit, 7 do now.

**Rule:** Every PR that lands a code fix must add at least one new row in `docs/quality/fix-registry.md` with a single-line regex anchor (tested by `git grep -E` via `.github/scripts/check-fix-registry.sh`). The row type is usually `present` (pattern must exist in the file) or `absent` (pattern must NOT exist). A PR with no registry delta is a PR that has silently chosen to be un-guarded against future regression.

**Exception:** pure refactor PRs that touch no observable behaviour, scaffolding-only PRs that add no production code, and doc-only PRs don't need a registry row. Everything else does.

**Catalogue uniqueness (Phase R1 PR-R1-6):** the `check-bugs-remaining-uniqueness` guard (`npm run guard:bugs-remaining-uniqueness`) parses `docs/quality/bugs-remaining.md`, extracts the BUG-ID from every row's "Bug" / "BUG" column, and asserts each ID appears in EXACTLY ONE row. The BUG-633 / BUG-634b history (same numeric ID appearing as both "open" and "fixed" rows simultaneously, creating a split-state catalogue that confused L3 reviewers and required dedicated absorb cycles) is structurally prevented. Cascade siblings (`BUG-XXX-CASCADE-N`, `BUG-XXX-FOLLOWUP-Y`) are distinct IDs and counted separately. 5 pre-existing split-state pairs (BUG-368/369/489/547/548) are allowlisted in `scripts/guards/check-bugs-remaining-uniqueness.allowlist` with EXPECTED-COUNT pinning (`BUG-XXX expected=N`) and tracked under `BUG-PR-R1-6-CASCADE-CATALOGUE-CLEANUP` for dedicated catalogue-hygiene cleanup. Hard-coded `MAX_ALLOWLIST_SIZE = 5` cap prevents silent allowlist growth. NEW split-states cannot be allowlisted as a workaround.

**Anchor decisiveness (Phase R1 PR-R1-7):** the `check-fix-registry-decisiveness` guard (`npm run guard:fix-registry-decisiveness`, CI-only ~38s) walks every `present`-type row in `docs/quality/fix-registry.md`, runs `git grep -E -c <pattern> <file>`, and REJECTs anchors whose match count exceeds `MAX_DECISIVE_HITS = 5`. A pattern like `function` matching 1000+ lines is silently un-decisive — the registry guard would still PASS even after the fix is removed. The decisiveness guard makes the looseness visible. 80 pre-existing legitimate cases (allowlist-size pins, file-content pins, many-sites defence patterns, vitest-spec self-references) are allowlisted with `cycle-1 hits=N` annotations in `scripts/guards/check-fix-registry-decisiveness.allowlist` so a future drift in their match count is observable via re-running the seed helper. NEW anchors with > 5 hits should be tightened to pin the unique fix-shape (typically 1-3 lines), not allowlisted.

### 9.6 Fire-and-forget async calls must carry a `.catch` and unhandled promises must fail lint
**Why:** Audit M1 + L2 (2026-04-16) found four `void asyncCall(...)` and `setImmediate(() => void asyncCall(...))` patterns in request handlers that silently ate Redis / Postgres / network failures. Each would have been caught at pre-commit time by `@typescript-eslint/no-floating-promises`, which was not wired into the lint config.

**Rule:** No `void someAsyncCall()` pattern in any request handler, worker body, or middleware. If the call MUST not block (session idle window update, patient-outreach background work, FHIR bulk-export kickoff), chain `.catch(err => logger.{warn|error}({ err, ... }, 'op failed'))` so every failure is observable. Every `setInterval` / `setTimeout` body wraps its contents in try/catch per §3.2. Every async route handler calls `next(err)` per §3.1.

**Enforcement:** `scripts/guards/check-no-fire-and-forget.ts` statically rejects `void asyncCall()` + unwrapped `setInterval(async …)` patterns. Paired with `check-no-silent-catches.sh` which rejects `.catch(() => {})` and friends. Both wired into the merge gate. `@typescript-eslint/no-floating-promises` ESLint rule is a v1.4 follow-up once the allowlist is drained.

---

## 11. PREVENTIVE OBSERVABILITY

The seven deep-audit findings (2026-04-16) landed over four PRs. Five of the seven would have been caught earlier by stricter tooling. This section documents the layering strategy for preventing the next audit from finding anything.

**Layer 0a — agent-discipline checks (claim-time, pre-commit, sub-second per check; introduced 2026-05-03 per plan Phase 0a):**

Four NEW agents enforce claim-honesty before code/docs even reach Layer 1. They prevent the failure mode where the agent (Claude itself) self-approves work without artifact backing — a class that L1-L5 cannot catch because L1-L5 review the artifacts, not the claims about coverage / completeness / confidence.

- **`shortcut-detector`** (`.claude/agents/shortcut-detector.md`) — flags banned phrases ("should work", "looks correct", "likely", "probably", "comprehensive", "audited", "the chain is intact", "complete" without deliverable identifier, "moving on" without phase sign-off). Requires per-item coverage tally for "comprehensive" claims. BLOCK on missing artifact backing. 5 fixture test cases at `.claude/agents/__fixtures__/shortcut-detector-fixtures.md`.
- **`confidence-label-enforcer`** (`.claude/agents/confidence-label-enforcer.md`) — verifies every claim has HIGH/MEDIUM/LOW/UNKNOWN label. Blocks promotion LOW→HIGH without re-verification artifact in diff. Mechanical evidence-vs-label match. 5 fixture test cases at `.claude/agents/__fixtures__/confidence-label-enforcer-fixtures.md`.
- **`dod-completion-checker`** (`.claude/agents/dod-completion-checker.md`) — reads deliverable's DoD from plan file; verifies each checkbox satisfied with artifact (file path, command output, commit SHA, fix-registry anchor, L1-L5 PASS reference). PASS / PARTIAL / BLOCK verdict. 5 fixture test cases at `.claude/agents/__fixtures__/dod-completion-checker-fixtures.md`.
- **`gold-standard-enforcer`** (`.claude/agents/gold-standard-enforcer.md`) (Phase 0a.9, 2026-05-03) — detects band-aid framing, multi-approach recommendations chosen by effort/time/risk reasoning, silent deferrals without BUG citation, grandfather patterns, monitoring-as-substitute-for-fix. BLOCK unless gold-standard chosen explicitly OR operator-authorized exception with operator-stated reasoning is cited. Mechanical complement: companion guard `scripts/guards/check-no-band-aid-annotations.ts` (`npm run guard:no-band-aid-annotations`) — content-time enforcement that any `// TODO` / `// FIXME` / `for now` / `interim` / `out of scope` / `// @*-exempt: temporary` annotation in source code, plan files, or quality docs cites a BUG-XXX identifier OR carries `permanent: <reason>` rationale. Baseline doc-meta entries allowlisted at `scripts/guards/check-no-band-aid-annotations.allowlist` with per-entry `permanent: doc-meta-*` rationale across 5 categories (`doc-meta-self-referential` / `doc-meta-historical` / `doc-meta-cascade-row` / `doc-meta-template-language` / `doc-meta-plan-scope-section`); see `npm run guard:no-band-aid-annotations` output for current count + the allowlist file itself for per-entry breakdown. NEW band-aid annotations cannot regress. 5 fixture test cases at `.claude/agents/__fixtures__/gold-standard-enforcer-fixtures.md`.

These agents pair with 6 memory entries that persist the discipline across sessions: `feedback_audit_vs_walkthrough.md`, `feedback_per_deliverable_dod.md`, `feedback_phase_boundary_signoff.md`, `feedback_confidence_labels.md`, `feedback_honesty_triggers.md`, `feedback_absolute_gold_standard.md` (the canonical reference for gold-standard-enforcer's rubric).

DoD template canonical at `docs/quality/deliverable-dod-template.md`.

**Agent registration**: agent files live in `.claude/agents/<name>.md`. As of 2026-05-03, project-level Claude Agent SDK registration may require restart OR user-level config — tracked as `BUG-AGENT-REGISTRATION` (S2). Until resolved, fixture validation falls back to operator review (read fixture + agent rubric; mentally verify expected output).

**Discipline umbrella + CI mode (Phase 0a.9b + 0a.10)**: `npm run guard:claude-discipline` runs all 4 Phase 0a guards (discipline-files-structural + allowlist-expiry + rules-coverage + no-band-aid-annotations) + the runtime-evidence-staleness guard. CI variant `npm run guard:claude-discipline:ci` sets `SIGNACARE_DISCIPLINE_SKIP_MEMORY=1` to skip the 5 memory file checks + 5 MEMORY.md index checks (which require `~/.claude/projects/.../memory/` access; not available in GitHub Actions runners). Local mode validates 18 file-correctness checks; CI mode validates 8 (in-repo only). Memory-skipped runs print explicit `NOT VERIFIED IN THIS RUN` disclosure rather than silently passing — prevents fail-OPEN.

**Runtime evidence (Phase 0a.10)**: `docs/quality/runtime-verification-evidence.md` captures actual probe verdicts for 4 Layer 0a agent runtime probes + 5 memory recall probes. Each row carries content-hash of the underlying agent / memory file + `STATUS: VERIFIED_THIS_SESSION` (with session-id + timestamp + invocation reference) OR `STATUS: PENDING_FRESH_SESSION` (with explicit reason + close-by date). Companion guard `npm run guard:runtime-evidence-staleness` recomputes hashes on every CI run + FAILs if any recorded hash != current hash (forces re-verification when agent prompt or memory file changes). Stale-on-prompt-change is the structural enforcement of "evidence stays honest as the discipline scaffold evolves".

**Trigger-commit review-chain attestation (BUG-PRECOMMIT-REVIEW-CHAIN-FOR-S1, 2026-05-06)**: hybrid pre-commit + commit-msg hook pair structurally enforces "review chain ran for THIS staged diff". Three layers:

1. **Trigger detection** (`scripts/guards/lib/detectTriggerCommit.ts`): a commit is a TRIGGER COMMIT if ANY of: (a) staged diff touches `apps/api/migrations/*.ts`; (b) staged diff modifies ≥3 files under `apps/api/src/features/`; (c) commit message claims closure of `BUG-XXX (S0|S1|S2)` — the cf3f567 failure-mode signature.

2. **Pre-commit elevated mechanical set** (`.husky/pre-commit`): on migration-touched trigger, runs the migration-quality 4-guard set (`migration-rls-policy` + `migration-index-discipline` + `migration-rollback-discipline` + `migration-convention`). The cf3f567 cycle-2 L5 review observed that `guard:claude-discipline` does NOT include the first 3 — they ARE in CI but were not in pre-commit. This block closes that gap.

3. **Commit-msg review-attestation guard** (`.husky/commit-msg` + `scripts/guards/check-review-attestation.ts`): on any trigger commit, requires a tree-hash-bound JSON artifact at `.git/signacare-review-attestation.json` (outside repo tree; cannot be accidentally committed). Artifact records cycle-1 quartet (conf-label / shortcut / gold-standard / dod) + L3 + L5 verdicts; L4 conditional per subject-matter rubric in `feedback_l4_subject_matter_test.md` (else `verdict: "N/A"` with FREE-TEXT `rationale` field per Q5 operator decision 2026-05-06). `git write-tree` recomputed at commit time MUST equal the artifact's `treeHash` — if the staged tree changes after attestation, the artifact invalidates and reviewer chain must re-run on the new diff. NO bypass mechanism per Q3 operator decision; `git commit --no-verify` is the OS-level escape (visible in git log forever). Schema spec: `docs/quality/review-attestation-format.md`. Phase-2 expansion (auth-sensitive paths) deferred to BUG-PRECOMMIT-REVIEW-CHAIN-PHASE-2-AUTH-PATHS (S3) per Q4. The artifact is AGENT-DRIVEN per Q1: Claude invokes each reviewer subagent in sequence and writes the artifact directly — no wrapper-script orchestrator.

**Layer 1 — static (pre-commit, sub-second):**
- `npx tsc --noEmit` in `apps/api`, `apps/web`, `packages/shared` — blocks commit if any workspace fails.
- Planned: `npm run lint` with `@typescript-eslint/no-floating-promises` + `no-misused-promises` + the existing naming-convention rules. Blocks commit on any floating promise.

**Layer 2 — CI guards (pre-merge, ~5 sec each, ALL wired into the merge gate per Phase 0.7.5 Commit 10):**
- `check-fix-registry.sh` — every known fix is still in place.
- `check-no-stray-db-names.sh` — no drift in the `signacare_owner` / `app_user` / `signacaredb` naming.
- `check-no-telecom.sh` — no SMS / telephony imports except the allowlisted eRx + ACS outreach paths.
- `check-acs-callers.sh` — every ACS import comes from `patient-outreach/patientOutreachService.ts` only.
- `check-naming-conventions.sh` — no `/api/v1/` prefix in frontend `apiClient` calls, no `parseInt()` without radix, no Knex camelCase aliases.
- `check-mounted-routes-have-callers.sh` — no dead routes.
- `check-query-key-factories.sh` — no literal `queryKey: [...]` arrays outside `queryKeys.ts` factories. Scans both `apps/web/src/features/**` AND `apps/web/src/shared/**`.
- `check-no-duplicate-api-types.sh` — frontend `types/*.ts` files must not re-declare anything from `@signacare/shared`. Grandfather list is empty.
- `check-frontend-calls-backend-route` — every frontend `apiClient.*` URL must resolve to a backend handler (§9.4).
- `check-no-fire-and-forget` — no `void asyncCall()` or `setInterval(async … )` without a `.catch` (§9.6).
- `check-no-silent-catches.sh` — no `.catch(() => {})` / `.catch(() => [])` / `.catch(() => null)` / `.catch(() => undefined)` in production code. Every rejection must be observable (§3.1 + §9.6).
- `check-no-orphan-migrations.sh` — every `.sql` in `apps/api/src/db/migrations/` has a ledger-only `.ts` wrapper in `apps/api/migrations/` (§12).

**Layer 3 — unit tests (pre-merge, ~3 sec total):**
- Vitest on every repository / service / pure function. 175+ tests today. Every bug fix lands with at least one regression test (the billing race-condition fix in commit `619310b` is the canonical example — 7 tests pin the fix shape without needing a live DB).

**Layer 4 — integration tests (pre-merge, ~30 sec total):**
- `test:integration` runs the supertest suites against a real Postgres + Redis in docker-compose. Wired into the merge gate — runs on every PR (Phase 0.7.5 Commit 10).

**Layer 5 — live smoke (pre-merge, ~2 min, REQUIRED per Phase 0.7.5 Commit 10):**
- Playwright E2E that exercises the golden path for every high-traffic surface (login, patient list, patient detail, episode create, clinical note create, medication prescribe). Wired into the merge gate. The class of bug that used to live in-tree for weeks (e.g. a dead URL in SummaryTab.tsx) now fails CI on the first PR.

**The budget:** a bug caught at Layer 1 costs nothing. Layer 2 costs a minute. Layer 3 costs a test run. Layer 4 costs 30 s of CI. Layer 5 costs 2 min before every release. A bug that escapes Layer 5 and lands on a clinician is the failure mode every earlier layer exists to prevent. Each layer should catch everything the previous one missed — the layering strategy is additive, not either/or.

**The forcing function:** a bug that is caught at Layer N+1 when it could have been caught at Layer N means the Layer N tooling has a gap that's worth closing. The seven audit findings are the audit trail of those gaps. Every future finding at a late layer should drive a tightening of an earlier layer, not just a point fix.

---

## 10. LOCAL-DEV POSTGRES PORT PIN

**Why:** Many developers have multiple Homebrew Postgres versions installed (`postgresql@16`, `postgresql@17`, etc.) because other local projects use different majors. Both default to listening on port 5432, so only one can run at a time and developers waste hours figuring out why "the database disappeared" after `brew services restart`. Phase 0.7 (2026-04-15) made Signacare's local-dev install pin postgresql@17 to **port 5433** so it can coexist with any other Postgres on 5432.

**Rule:** On a developer machine, Signacare's Postgres (postgresql@17 with `signacaredb` + `signacare_owner` + `app_user`) listens on **5433**. The default `apps/api/.env` and `apps/api/.env.example` use `DB_PORT=5433`. The installer (`installer/setup-first-run.sh`) writes `port = 5433` into `/opt/homebrew/var/postgresql@17/postgresql.conf` on first run, idempotently.

**Production:** Single-Postgres production environments can keep `DB_PORT=5432` in their own `.env.production` — the pin only applies where the machine has multiple Postgres versions side-by-side.

**Manual fix (if you need to set the pin on an existing dev machine):**
```bash
sed -i.bak 's/^#port = 5432.*/port = 5433\t# Signacare local-dev pin/' \
  /opt/homebrew/var/postgresql@17/postgresql.conf
brew services restart postgresql@17
psql -h localhost -p 5433 -U signacare_owner -d signacaredb -c "SELECT version()"
```

If you stop seeing `signacaredb` after a restart and `psql -p 5432 ...` connects to a different cluster (e.g. another project's), check whether postgresql@17 has lost the port pin and re-apply.

---

## 12. ONE MIGRATIONS DIRECTORY

**Why:** On 2026-04-15, 9 SQL migration files were committed to `apps/api/src/db/migrations/` instead of the Knex-tracked `apps/api/migrations/` directory. Knex only scans `./migrations/` for `.ts` files (per `knexfile.ts:21`), so the SQL files were never tracked in `knex_migrations`. A fresh `migrate:latest` from empty skipped them entirely — RLS policies, FK constraints, audit triggers, and app_user grants were all missing from the reproducible migration path. Phase 0.7.1 converted them to tracked `.ts` wrappers.

**Rule:** All database DDL changes go through `apps/api/migrations/` as Knex `.ts` files. The SQL content in `apps/api/src/db/migrations/` is kept as reference (read by the `.ts` wrappers via `readFileSync`) but no NEW migration SQL should be added there. Every DDL change must have a corresponding `.ts` file in the Knex-tracked directory.

**Enforcement:** CI guard `check-no-orphan-migrations.sh` verifies every `.sql` file in `src/db/migrations/` has a corresponding `.ts` wrapper in `migrations/`.

### 12.1. MIGRATION CONVENTION — builder-first, raw only for primitives the builder can't express

**Why:** Phase R (2026-04-18) — during Phase 0.7.5 c24 I (Claude) wrote 4 migrations using `knex.raw(\`ALTER TABLE foo ADD COLUMN bar text\`)` for simple DDL the Knex schema builder expresses trivially. Builder-first is the house style across 82 existing migrations. CI guard `check-migration-convention.ts` now enforces this mechanically at commit time so reviewer discipline is not required.

**Use the schema builder for:**

| Operation | Builder pattern |
|---|---|
| `CREATE TABLE` / `ALTER TABLE … ADD/DROP COLUMN` | `knex.schema.createTable('<n>', (t) => { … })` / `knex.schema.alterTable(...)` |
| Simple `CREATE INDEX` on one or more columns | `t.index(['<col1>', '<col2>'], '<idx_name>')` |
| Foreign keys | `t.uuid('x').references('id').inTable('y').onDelete('CASCADE')` |
| Basic `UNIQUE` constraints | `t.unique(['<cols>'])` |
| Primary keys | `t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))` |
| `NOT NULL`, `DEFAULT`, simple `ALTER COLUMN` | `t.string('x').notNullable().defaultTo('y').alter()` |
| `DROP TABLE` / `DROP INDEX` | `knex.schema.dropTableIfExists('x')` / `t.dropIndex(['col'], 'idx_name')` |

**Use `knex.raw()` ONLY for operations the builder cannot express:**

- RLS policies (`CREATE POLICY`, `ENABLE/DISABLE ROW LEVEL SECURITY`)
- Partial indexes (`CREATE INDEX … WHERE deleted_at IS NULL`)
- Functional/expression indexes (`LOWER(col)`, `(col->>'k')`, `((true))` for singletons)
- `CHECK` constraints with free expressions
- Triggers / functions (`CREATE TRIGGER`, `CREATE FUNCTION`)
- Views (`CREATE VIEW`, `CREATE MATERIALIZED VIEW`, `REFRESH`)
- Extensions (`CREATE EXTENSION pg_trgm`)
- Partitioning (`PARTITION OF`, `PARTITION BY RANGE`)
- Data backfills (`INSERT INTO`, `UPDATE …`, `DELETE FROM`)
- Access control (`GRANT`, `REVOKE`, `ALTER DEFAULT PRIVILEGES`)
- Schema introspection (`SELECT … FROM information_schema`, `pg_roles`, etc.)
- Dynamic identifiers via template interpolation (canonical-name renames etc.)
- Idempotency guards (`IF NOT EXISTS`, `IF EXISTS`) on operations where the builder doesn't offer an equivalent

**Exemption:** for rare cases that don't fit either bucket, annotate the `knex.raw(...)` call with a leading `// @migration-raw-exempt: <category>` comment. The category MUST be from the fixed taxonomy in §12.4 — free-form reasons are rejected by `check-migration-convention`. See §12.4 for the canonical template + full taxonomy.

### 12.2. CODE MUST WRITE REAL COLUMNS

**Why:** Phase R (2026-04-18) — `.insert({...})` and `.update({...})` accept any object type the TS type checker can't narrow to exact columns, so ghost-column writes (code writing `updated_at` to a table without that column, or `is_active` where the real column is `status`) compile cleanly but are silently dropped at runtime by Knex, or crash at INSERT time if a required column is missed. This was the root cause of 62 confirmed schema-drift bugs (SD39–SD62) plus another 53 discovered when the Phase R guard first ran.

**Rule:** Every `.insert({...})` / `.update({...})` object literal must only contain columns that exist on the target table per `apps/api/src/db/schema-snapshot.json`.

**Enforcement:** CI guard `check-code-writes-real-columns.ts` walks every `.insert`/`.update` call, resolves the bound table via backward-search for `db('<table>')` / `trx('<table>')`, and cross-checks every top-level object key against the snapshot. Violations fail CI with near-match suggestions.

**Exemption:** for transient states (e.g. Phase R2 consolidated baseline is the actual fix), annotate with a leading `// @code-columns-exempt: <honest reason>` comment. The exemption mechanism is the documented inventory of known drift, not a hiding place.

### 12.3. SNAPSHOT MUST BE FRESH

**Why:** Both `guard:row-iface-drift` and `guard:code-columns` consume `apps/api/src/db/schema-snapshot.json`. If a PR adds a migration but forgets to regenerate the snapshot, those guards run against the PREVIOUS schema — new columns look like drift, new tables look missing.

**Rule:** Every PR that touches `apps/api/migrations/` must also regenerate and commit `apps/api/src/db/schema-snapshot.json`.

**Enforcement:** CI guard `check-snapshot-freshness.ts` compares the most recent git-commit time of `apps/api/migrations/` against the same for `apps/api/src/db/schema-snapshot.json`. Migrations committed more recently than the snapshot fail CI with the fix command: `npm run db:snapshot --workspace=apps/api`.

### 12.4. GOLD-STANDARD MIGRATION SKELETON

**Why:** 2026-04-19 consistency audit — the Tier 4-5 migrations shipped with stylistic drift: redundant `.notNullable()` after `.primary()`, free-form exemption reasons, mixed CHECK+RLS raw blocks. §12.1 listed the allowed categories but didn't give a canonical template, so "gold-standard" was implicit. This section makes it explicit.

**Rule (six sub-rules, all mechanically enforced by `check-migration-convention`):**

1. **Every `knex.raw()` call MUST be preceded by** a taxonomy annotation on the line directly above:
   ```typescript
   // @migration-raw-exempt: <category>
   await knex.raw(`...`);
   ```
   where `<category>` is EXACTLY one of:
   | Category | Use for |
   |---|---|
   | `rls_policy` | `CREATE POLICY`, `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` |
   | `drop_policy_if_exists` | `DROP POLICY IF EXISTS` |
   | `check_constraint` | `ADD CONSTRAINT ... CHECK` |
   | `drop_constraint_if_exists` | `DROP CONSTRAINT IF EXISTS` |
   | `column_comment` | `COMMENT ON COLUMN` / `COMMENT ON TABLE` |
   | `data_backfill_insert` | `INSERT INTO ... SELECT` / `VALUES` |
   | `data_backfill_update` | `UPDATE ... SET` |
   | `data_backfill_delete` | `DELETE FROM` |
   | `idempotency_guard` | `IF [NOT] EXISTS` on ADD/DROP COLUMN etc. |
   | `view_create` / `view_drop` | `CREATE [MATERIALIZED] VIEW` / `DROP VIEW` |
   | `trigger_create` / `trigger_drop` | `CREATE TRIGGER` / `DROP TRIGGER` |
   | `function_create` / `function_drop` | `CREATE FUNCTION` / `DO $$` / `DROP FUNCTION` |
   | `extension_create` | `CREATE EXTENSION` |
   | `partition_attach` / `partition_detach` | `ATTACH/DETACH PARTITION`, `PARTITION OF` |
   | `index_partial` | `CREATE INDEX ... WHERE` |
   | `index_functional` | expression/JSON-path/cast index |
   | `grant` / `revoke` | `GRANT` / `REVOKE` / `ALTER DEFAULT PRIVILEGES` |
   | `introspection` | `SELECT FROM pg_* / information_schema` |
   | `session_local` | `SET LOCAL` / `SET search_path` |
   | `dynamic_identifier` | template-interpolated table/column names |

   Free-form reasons (e.g. `// @migration-raw-exempt: RLS policy + CHECK`) are rejected. The category MUST be a single identifier from the table above.

2. **Primary keys use `t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))`** — `.primary()` already implies `NOT NULL`; do NOT chain `.notNullable()`. The same goes for single-column `.primary()` on FK columns.

3. **Group raw statements by concern.** A single raw block may contain multiple statements ONLY when they belong to the SAME category (e.g. two CHECK constraints in one block, two RLS policies in one block). Do not mix categories:
   ```typescript
   // WRONG — mixes CHECK + RLS under one annotation
   // @migration-raw-exempt: check_constraint
   await knex.raw(`
     ALTER TABLE x ADD CONSTRAINT x_status_check CHECK (status IN (...));
     ALTER TABLE x ENABLE ROW LEVEL SECURITY;
     CREATE POLICY rls_x_tenant ON x ...;
   `);

   // RIGHT — one block per concern, one annotation per block
   // @migration-raw-exempt: check_constraint
   await knex.raw(`ALTER TABLE x ADD CONSTRAINT x_status_check CHECK (...)`);
   // @migration-raw-exempt: rls_policy
   await knex.raw(`ALTER TABLE x ENABLE ROW LEVEL SECURITY; CREATE POLICY rls_x_tenant ...`);
   ```

4. **up() order**: schema-builder DDL → RLS → CHECK → backfill INSERTs. **down() order**: the exact mirror, with `IF EXISTS` on every DROP so the down path is re-runnable.

5. **Naming conventions:**
   - RLS policy: `rls_<table>_tenant`
   - CHECK constraint: `<table>_<column>_check`
   - Composite + functional indexes: explicitly named (`idx_<table>_<cols>`); knex default is acceptable for single-column builder indexes.

6. **File-level `@migration-squashed-baseline` directive** — consolidated baseline files (e.g. `20260701000000_baseline.ts` with 437 raw calls from 82 squashed migrations) opt out of per-call annotation by adding this comment at the top of the file. Per-call category-match is still enforced; only the annotation is waived.

**Canonical skeleton — new table + RLS + CHECK + seed:**

```typescript
import { Knex } from 'knex';

/** What, why, audit reference. */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('example_table', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.string('status', 20).notNullable().defaultTo('pending');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id']);
  });

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE example_table
      ADD CONSTRAINT example_table_status_check
      CHECK (status IN ('pending','approved','rejected'))
  `);

  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE example_table ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_example_table_tenant ON example_table
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // @migration-raw-exempt: data_backfill_insert
  await knex.raw(
    `INSERT INTO example_table (clinic_id, status)
     SELECT id, 'pending' FROM clinics WHERE ...`,
  );
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: drop_policy_if_exists
  await knex.raw('DROP POLICY IF EXISTS rls_example_table_tenant ON example_table');
  // @migration-raw-exempt: drop_constraint_if_exists
  await knex.raw('ALTER TABLE example_table DROP CONSTRAINT IF EXISTS example_table_status_check');
  await knex.schema.dropTableIfExists('example_table');
}
```

**Canonical skeleton — alterTable + new columns + CHECK:**

```typescript
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('example_table', (t) => {
    t.text('new_col').notNullable().defaultTo('default_value');
  });
  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE example_table
      ADD CONSTRAINT example_table_new_col_check
      CHECK (new_col IN ('default_value','other_value'))
  `);
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: drop_constraint_if_exists
  await knex.raw('ALTER TABLE example_table DROP CONSTRAINT IF EXISTS example_table_new_col_check');
  await knex.schema.alterTable('example_table', (t) => {
    t.dropColumn('new_col');
  });
}
```

**Enforcement:** `check-migration-convention` (`npm run guard:migration-convention`) refuses to merge a PR that:
- adds a raw() call without a taxonomy annotation on the line directly above (outside squashed-baseline files),
- uses a free-form or unknown category string,
- uses raw() for DDL the schema builder can express (CREATE TABLE, ALTER TABLE ADD/DROP/ALTER COLUMN, simple CREATE/DROP INDEX).

**Rollback enforcement (Phase R1 PR-R1-3):** the `check-migration-rollback-discipline` guard (`npm run guard:migration-rollback-discipline`) AST-walks every `apps/api/migrations/*.ts` file and refuses to merge a PR that:
- adds a migration without an `export async function down(knex: Knex)` declaration,
- adds a migration whose `down()` body is empty / no-op (unless explicitly annotated `// @migration-down-noop: <reason>` for the rare append-only cases like `lock_version` columns whose rollback would silently disable conflict detection),
- emits raw SQL `DROP TABLE/POLICY/CONSTRAINT/INDEX/TRIGGER/FUNCTION/VIEW/TYPE/SCHEMA/MATERIALIZED VIEW` without `IF EXISTS`,
- uses Knex builder `dropTable(...)` instead of `dropTableIfExists(...)`.

The `@migration-down-noop:` opt-in is restrictive by design — it requires the migration author to write down the reason in the body, so that a future contributor reading the migration sees why no `down()` exists, and so reviewers spot mis-applied opt-ins. Live up→down→up cycle (runtime verification) is filed as `BUG-PR-R1-3-FOLLOWUP-LIVE-ROLLBACK-CYCLE` for the integration-test layer.

---

## 13. SERVICE-LAYER AUTHCONTEXT

**Why:** The 19-point audit found RBAC enforced at HTTP middleware only — services accepted raw `(clinicId, staffId)` strings without verifying the caller's access. A background job or internal API calling `patientService.getById(anyClinicId, anyPatientId)` bypassed all authorization.

**Rule:** Every NEW service method must accept `AuthContext` (from `@signacare/shared`) as its first parameter. Methods that accept raw `(clinicId: string, actorId: string, ...)` are forbidden in new code.

**Pattern:**
```typescript
import type { AuthContext } from '@signacare/shared';
import { requirePermission, requirePatientRelationship } from '../../shared/authGuards';

async function create(auth: AuthContext, dto: CreateDTO) {
  requirePermission(auth, 'resource:create');
  await requirePatientRelationship(auth, dto.patientId);
  // ... business logic uses auth.clinicId, auth.staffId
}
```

**Guards available** (in `apps/api/src/shared/authGuards.ts`):
- `requirePermission(auth, 'permission:string')` — checks role + permissions
- `requireClinicMatch(auth, resourceClinicId)` — prevents cross-tenant access
- `requireSpecialty(auth, ['psychiatry'])` — blocks psychologists from prescribing
- `requirePatientRelationship(auth, patientId)` — verifies clinician-patient relationship via episode, team, or appointment

**Services already migrated:** patientService, medicationService, clinicalNoteService, ectService, tmsService, AI agent.

**Incremental adoption:** Remaining services (episodes, referrals, escalations, etc.) adopt AuthContext when their files are next touched. The `buildAuthContext(req)` utility in controllers produces the context from `req.user` + `req.clinicId`.

**Enforcement (Phase R1 PR-R1-2):** the `check-service-auth-context` guard (`npm run guard:service-auth-context`) walks every `apps/api/src/features/(* /)*Service.ts` file's AST, finds every exported method on the service constant + every top-level `export async function`, and asserts the first parameter is `auth: AuthContext`. Knex first-param helpers (`_db: Knex`, `db: Knex`, `trx: Knex.Transaction`) are grandfathered for repository utilities co-located with services. Existing 180 baseline violations are allowlisted in `scripts/guards/check-service-auth-context.allowlist` (fingerprint-format, line-shift-resilient per PR-R1-1.5) under `BUG-AUTHCONTEXT-MIGRATE-SERVICE-CONSUMERS`. Any NEW non-conforming method fails the merge gate. Allowlist drains as services migrate per CLAUDE.md §13 incremental adoption.

---

## 15. ROW/DB INTERFACE MUST MATCH THE DB SCHEMA (BIDIRECTIONAL)

**Why:** Phase 0.7.5 c24 investigated a repeated pattern — TS row interfaces drifting from the migrations. The root cause analysis found **11 CRITICAL runtime bugs** (SD12–SD21 + SD28). Each interface declared fields that didn't exist in the DB; `.insert({ ...row })` crashed at runtime with `column "foo" does not exist`; TypeScript compiled cleanly because the interface IS the declaration. Examples:

- `WaitlistEntryDb` declared `assigned_to_id`, `date_added`, `target_date` → DB has `preferred_clinician_id`, `added_date`, `target_appointment_by`. Every waitlist create crashed.
- `ReportRunRow` declared `errormessage`, `generatedat`, `reporttype`, `requestedbyid`, `resultdata`, `totalrows` (no underscores) → DB has the snake_case versions. Every report save crashed.
- `PrescriptionRow` declared `medication_id`, `prescribed_by_id`, `method`, `repeats_remaining`, `dispensing_instructions`, `authority_required`, `authority_number` → DB uses `patient_medication_id`, `prescribed_by_staff_id`, `authority_code`. Every prescribe crashed.

The 11 SD-class bugs above were forward-direction drift (interface declares a field that doesn't exist in the DB). BUG-529 (2026-04-25) added the reverse direction: BUG-458 / BUG-489 (`AppointmentDb`) and the broader silent-drop class — when the interface OMITS a real DB column, downstream mappers fabricate a literal (`null`, `false`, `''`) for that column and silently drop the source-of-truth value on every write. Compiles cleanly; fails clinically. Both directions are now mechanically enforced.

**Rule (forward direction):** Every `export interface X(Row|Db)` in `apps/api/src/**` that is bound to a DB table via `db<X>('<table>')` (or equivalent cast / class-generic pattern) must declare fields that all exist as columns on that table in the current schema.

**Rule (reverse direction, BUG-529):** The same interface must also declare every column that exists on the bound table — unless the interface is annotated with a sub-projection exemption or specific columns are listed in the per-column allowlist.

**Whole-interface exemptions:** If the interface is not meant to map 1:1 with a single row, annotate the JSDoc with exactly one of:

```typescript
/**
 * @schema-drift-exempt select-aliased
 * `staff_name` is populated by CONCAT(given_name, ' ', family_name) AS staff_name
 * in the SELECT join — not a column on this table.
 */
export interface XxxRow { ... }
```

Valid reasons:

| Reason            | Skips                  | When to use                                                                             |
|-------------------|------------------------|-----------------------------------------------------------------------------------------|
| `select-aliased`  | both directions        | columns come from `SELECT col AS alias` — interface isn't a row at all                  |
| `aggregation`     | both directions        | derived shape (GROUP BY, JSON agg, view) — no backing table row                         |
| `response-shape`  | both directions        | API response after service-layer mapping — not a DB row                                 |
| `partial-shape`   | **reverse only**       | IS a row; deliberate sub-projection. Forward direction is still enforced (a sub-projection still must not declare phantom columns). Cite the work-item BUG ID that tracks eventual flattening or formalisation. |

The asymmetry of `partial-shape` is intentional — a sub-projection is still a row, so writing an undeclared column is still a bug, but the row may legitimately omit columns the repository does not consume.

**Per-column allowlist (BUG-529):** for surgical cases where most columns SHOULD be declared but specific ones are deliberately excluded (e.g. write-only audit columns, full-text indexes the interface intentionally hides from read paths), add a row to `scripts/guards/check-row-interface-matches-db.allowlist` in the form:

```
<table>.<column>  # BUG-NNN — reason
```

The allowlist is self-cleaning: if the listed column or table is removed/renamed, the next guard run exits with code 2 ("stale entry") so the allowlist cannot silently outlive the schema it was scoped to.

**Enforcement (two layers):**

1. **CI guard** — `scripts/guards/check-row-interface-matches-db.ts`. Bidirectional. Parses every file, binds interface → table via `db<X>('t')` / `as X` + preceding `db('t')` / class-generic, cross-checks against `apps/api/src/db/schema-snapshot.json`. Fails the merge gate if drift exists in either direction (exit 1) or if the allowlist is malformed/stale (exit 2). Snapshot is regenerated via `npm run db:snapshot --workspace=apps/api` after every migration — the guard detects a stale snapshot too.

2. **Integration test** — `apps/api/tests/integration/schemaDrift.test.ts`. Same logic but queries the live Postgres in the `test-integration` CI job, in both directions. Catches drift that slipped past the snapshot (e.g. a migration landed but the author forgot to regenerate).

**Fix-registry rows:** `ROW-IFACE-DRIFT`, `R-FIX-BUG-529-REVERSE-CHECK-EXISTS`, `R-FIX-BUG-529-PARTIAL-SHAPE-EXEMPTION`, `R-FIX-BUG-529-ALLOWLIST-RECOGNIZED`, `R-FIX-BUG-529-CLAUDE-MD-BIDIRECTIONAL`, `R-FIX-BUG-529-NO-FORWARD-ONLY-COMMENT`.

**When a new migration lands:** run `npm run db:snapshot --workspace=apps/api`, commit the updated `schema-snapshot.json` in the same PR. CI fails otherwise.

---

## 16. UI STATUS + SERVICE RESULT (CANONICAL)

**Why (BUG-530, 2026-04-26):** BUG-445 / BUG-446 / BUG-520 / BUG-521 / BUG-523 are sibling instances of the same lie-about-success class. Frontend `try { fetch() } catch { setData([]) }` collapses `failed` into `empty`; the UI renders "no data" or even "saved successfully" instead of failing loud. Two-state `isLoading: boolean` collapses idle / loading / empty / failed into the negation of one bit, allowing the silent failure mode. BUG-530 lands the canonical SSoT in `@signacare/shared` to make `failed` and `empty` first-class states the renderer MUST handle exhaustively.

### 16.1 Five-state UIStatus is mandatory for safety-surface fetch UIs

**Rule:** any safety-surface UI that fetches data (medications, clinical notes, prescriptions, alerts, MHA orders, ECT/TMS, risk assessments, advance directives, legal orders, scribe sessions) MUST express its state via `UIStatus<T>` from `@signacare/shared` (path: `packages/shared/src/ui/statusMachine.ts`). Existing 2-state `{ isLoading, isError }` boolean code is migrated by dedicated BUGs (BUG-446, BUG-521 follow-ups) — adoption is opt-in per BUG, not bulk.

```typescript
import { UIStatus, matchUIStatus } from '@signacare/shared';

const status: UIStatus<Medication[]> = data
  ? UIStatus.fromResult(data, (xs) => xs.length === 0)
  : isLoading ? UIStatus.loading() : UIStatus.idle();

return matchUIStatus(status, {
  idle:    () => <PromptToFilter />,
  loading: () => <Spinner />,
  ready:   (medications) => <MedList items={medications} />,
  empty:   (reason) => <EmptyState reason={reason} />,
  failed:  (error, retry) => <ErrorBanner error={error} onRetry={retry} />,
});
```

The compiler refuses to compile a `matchUIStatus` call that omits any of the 5 handlers — this is the structural guarantee that prevents the BUG-445 silent-fallback class. Removing `failed` from the handlers fails the build; the renderer cannot silently fall back to `<EmptyState />`.

The 5 states are:
- **`idle`** — user has not asked for data yet (deferred queries, search-on-submit boxes).
- **`loading`** — request in flight.
- **`ready`** — request succeeded, carries the data.
- **`empty`** — request succeeded, genuinely zero rows. NOT `ready` with `data: []` — empty is a first-class state so the renderer's exhaustiveness check guarantees the empty-UI is wired separately. Optional `reason: 'no-results' | 'not-yet-loaded' | 'filtered-out'`.
- **`failed`** — request failed; carries an `AppError` (status / code / message / details) and an optional `retry` callback.

### 16.2 Result<T, AppError> is the canonical service-layer outcome wrapper

**Rule:** at the service layer, return `Result<T, AppError>` from `@signacare/shared` for *expected* failures. Use `tryAsync(fn)` to wrap any throw-prone async call.

```typescript
import { tryAsync, isErr, AppError } from '@signacare/shared';

// BANNED — collapses failure into success-shape (BUG-445 root cause)
let data: Medication[] = [];
try { data = await fetchMedications(patientId); } catch { data = []; }

// CANONICAL — type system forces narrowing before consuming the value
const r = await tryAsync(() => fetchMedications(patientId));
if (isErr(r)) {
  setStatus(UIStatus.failed(r.error, () => refetch()));
  return;
}
setStatus(UIStatus.fromResult(r, (xs) => xs.length === 0));
```

`tryAsync` always returns `Result<T, AppError>` regardless of what was thrown — `AppError` instances pass through; native `Error` / strings / unknowns are wrapped via `fromUnknown` with `code: 'UNKNOWN_THROWN'` (so observability dashboards can distinguish "deliberate AppError" from "accidental native Error"). The ESLint rule `signacare-rules/no-empty-catch-on-safety-surface` (BUG-531) autofixes `} catch { ... fabricate }` patterns toward this shape via suggestion-mode (developer reviews before accepting; not auto-applied by `eslint --fix`). The rule honours `// (intentional silent|allowed silent) — <reason>` comment-allowlist for legitimate best-effort cases (e.g. JSON.parse fallbacks); other comment forms (`/* TODO: handle */`, `/* ignore */`) are NOT honoured because those WERE the BUG-441/442/443/444 anti-pattern shape.

§3.4 documents the symmetric backend rule: services return `Result.err(AppError)` for expected failures (validation / not-found / business-rule); throws are reserved for unexpected failures (DB lost / OOM).

### 16.3 Adoption rule: opt-in per BUG

**Rule:** new safety-surface code SHOULD use UIStatus + Result. Existing code is migrated by dedicated migration BUGs (BUG-446, BUG-521, BUG-525 follow-ups). Do NOT bulk-migrate without a BUG — each migration carries its own pre-fix RED gate + L4/L5 review + atomic catalogue flip. The SSoT itself (BUG-530) lands inert; opt-in adoption is the explicit transition strategy.

**Fix-registry rows:** `R-FIX-BUG-530-UI-STATUS-EXPORT`, `R-FIX-BUG-530-RESULT-EXPORT`, `R-FIX-BUG-530-FIVE-STATES`, `R-FIX-BUG-530-TRY-ASYNC`, `R-FIX-BUG-530-CLAUDE-MD-SECTION-16`.

---

## 17. DATA RETENTION + ANONYMISATION SCOPE (BUG-374)

**Why (locked policy 2026-04-26):** patient + clinical record retention is **minimum 25 years** with no purge before that floor. Per-subscription configurable upward via Power Settings. The retention purge runs **annually** (1st January 04:00 AEST) under triple-lock arming (env DRY_RUN gate + per-clinic enable flag + manager approval with segregation of duties + 30-day TTL).

### 17.1 Anonymisation scope is patient-row identity wipe ONLY (Q-C policy)

**Rule:** when the retention floor is exceeded, anonymisation scrubs the patient row's identity columns (names, DOB → `'1900-01-01'` sentinel, contact details, identifiers, lookups, emergency, GP, NOK, viva_triage, health_fund, photo, emr_number) and sets `purged_at`. **Free-text content in `clinical_notes` (and other clinical narrative tables) is PRESERVED as clinical record** — narrative columns (content, content_html, foi_content, soap_*, title) are NOT scrubbed.

**Why this is the locked policy** (Q-C, user-explicit 2026-04-26):
- Clinical narrative has aggregate research / quality-improvement value; bulk-scrubbing destroys that.
- The patient row's identity columns ARE the canonical name-to-real-person map. Once those are wiped, free-text mentions of "John Smith" within a clinical note become un-anchored references — there is no `patients` row that maps that name back to a real person.
- No PHI egress channel exists for `clinical_notes` content (training-export uses its own `phiScrubberService`); free-text never leaves the system.
- AHPRA Code of Conduct §8.4 + state Health Records Acts permit minimum-retention with anonymisation; full clinical-record de-identification is a stricter posture not currently demanded.

**What this means for future contributors:**
- **DO NOT** add `loadScrubRules` or `scrubClinicalNotes` hooks to `AnonymisePatientContext`. The compile-time absence of those hooks is the structural enforcement of this policy.
- **DO NOT** add a `phiScrubber` import or call inside `anonymisePatientService.ts`. Fix-registry anchors `R-FIX-BUG-374B-NO-FREE-TEXT-SCRUB` (absent on `'clinical_notes')` table-binding) and the policy comment block guard against re-introduction.
- If regulatory pressure later demands free-text scrubbing, file a NEW BUG (with policy update memo) rather than silently extending `anonymisePatientService`.

### 17.2 Triple-lock production arming (Q-F)

The cron purge predicate requires ALL THREE gates simultaneously:
1. `RETENTION_DRY_RUN=false` env var (default `'true'` — operations must explicitly disable on production deploys after BUG-374c review).
2. `clinic.retention_purge_enabled=true` set by superadmin in Power Settings.
3. `clinic.retention_purge_manager_approved_at` is non-null AND within 30 days AND `manager_approved_by_staff_id !== retention_purge_enabled_by_staff_id` (segregation of duties — different staff member than the enabler).

**Cron behaviour on gate fail:** structured WARN log with `kind: 'RETENTION_CLINIC_SKIPPED'` / `'RETENTION_MANAGER_APPROVAL_MISSING'`, NO mutation. Dry-run mode (gate #1) logs `'RETENTION_DRY_RUN_CANDIDATE'` per row but never calls anonymise.

### 17.3 Idempotency (Q-E)

`patients.purged_at IS NOT NULL` is the bright line. Once purged, the row is NEVER re-anonymised — even if scrubber rules later change. Service short-circuits with `Result.ok({ mutated: false })`. Cron candidate query filters with `whereNull('purged_at')` so already-purged rows are not re-enumerated.

### 17.4 Minor + deceased clocks (Q1b/Q2b)

3-clock retention predicate:
```
purgeable_at = MAX(
  last_contact_at + MAX(25, configured_years),
  date_of_birth + (MAX(25, configured_years) + 7),  // minor protection
  deceased_date + MAX(25, configured_years),        // when deceased
)
```
Patient is purge-eligible only when ALL applicable clocks have expired. The minor-protection +7y clock is HPP 4.2 compliant. The `MAX(25, ...)` floor is the L5 belt below Zod L1+L2 + service L3 + DB CHECK L4.

**Fix-registry rows:** `R-FIX-BUG-374B-NO-FREE-TEXT-SCRUB`, `R-FIX-BUG-374B-PRESERVE-CONSENT`, `R-FIX-BUG-374B-DOB-SENTINEL`, `R-FIX-BUG-374B-3-CLOCK-PREDICATE`, `R-FIX-BUG-374B-SQL-FLOOR-MAX-25`, `R-FIX-BUG-374B-MANAGER-APPROVAL-CHECK`, `R-FIX-BUG-374B-SEGREGATION-OF-DUTIES`, `R-FIX-BUG-374B-APPROVAL-30D-TTL`, `R-FIX-BUG-374B-DRY-RUN-DEFAULT`, `R-FIX-BUG-374B-PER-CLINIC-FLAG-CHECK`, `R-FIX-BUG-374B-CLAUDEMD-SECTION-17`.
