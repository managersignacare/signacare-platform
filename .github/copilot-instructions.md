---
description: Workspace instructions for Signacare EMR. Use when writing code, reviewing PRs, creating migrations, or implementing features in this mental-health clinical system. Enforces schema correctness, multi-tenant isolation, safe error handling, and clinical-safety governance.
---

# Signacare EMR — Workspace Instructions

**Optimal code** for Signacare means: correct-first (schema + tenant + auth), safe (error → fail-loud), tested, and guarded. Every rule here exists because a production bug happened. Read [CLAUDE.md](CLAUDE.md) (17 sections, 5000 words) for context; use this file for quick reference.

---

## 1. DATABASE RULES (§1 CLAUDE.md)

**Column names must be verified against the migration.** TypeScript won't catch typos:
- ❌ `db('staff_role_assignments').where({ role_id })`  ← ghost column
- ✅ `db('staff_role_assignments').where({ clinical_role_id })`  ← verified in migration

**Before every query:** check `apps/api/src/db/schema-snapshot.json` or open the migration file. When uncertain, copy-paste the column name from the migration.

---

## 2. MULTI-TENANT ISOLATION (§1.3, §6.3 CLAUDE.md)

**Every query modifying or reading clinical data MUST include `clinic_id` in WHERE.**

```typescript
// ❌ WRONG — allows cross-tenant data leakage
db('patient_alerts').where({ id: alertId }).update(patch);

// ✅ RIGHT — application-level filtering (Layer 1) + RLS (Layer 2)
db('patient_alerts').where({ 
  id: alertId, 
  clinic_id: req.clinicId  // MANDATORY
}).update(patch);
```

**Every table with `clinic_id` must have:**
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
- RLS policy checking `clinic_id = current_setting('app.clinic_id', true)::uuid`
- Unique index on `clinic_id` (usually composite with FK)

See [database-schema.md](../../docs/guides/database-schema.md) for the full RLS template.

---

## 3. SOFT-DELETE FILTERING (§1.4 CLAUDE.md)

**Query soft-deleted records?** Only filter on tables that have `deleted_at` column.

**Tables WITH `deleted_at`:** Use `.whereNull('deleted_at')`  
**Tables WITHOUT `deleted_at`:** DO NOT add the filter — will crash with "column does not exist."

**Tables WITHOUT soft-delete** (use `is_active` or no deletion):  
`contact_records`, `hotspots`, `messages`, `pathology_results`, `patient_alerts`, `patient_attachments`, `patient_legal_orders`, `patient_providers`, `structured_observations`, `treatment_pathways`

Check the schema snapshot or migration file; don't guess.

---

## 4. SERVICE-LAYER CONTRACTS (§3.4, §16 CLAUDE.md)

Services return `Result<T, AppError>` for expected failures; throw only on unexpected crashes.

```typescript
// Service (safety-critical)
async function getMedication(auth: AuthContext, id: string): Promise<Result<Medication, AppError>> {
  const row = await repo.findById(auth.clinicId, id);  // throws on DB-down
  if (!row) return Result.err(new AppError('Not found', 404, 'NOT_FOUND'));
  return Result.ok(toResponse(row));
}

// Route (error propagation)
router.get('/medications/:id', async (req, res, next) => {
  try {
    const r = await medicationService.getMedication(buildAuthContext(req), req.params.id);
    if (isErr(r)) return next(r.error);  // expected → global error mapper
    res.json(MedicationResponseSchema.parse(r.value));  // Zod validate at boundary
  } catch (err) {
    next(err);  // unexpected → global mapper
  }
});
```

**Every route handler MUST have try/catch and call `next(err)` on error.** Do NOT use `res.status().json()` in catch — use `next(err)`.

---

## 5. FRONTEND — NO `/api/v1/` PREFIX

`apiClient.instance` already has `baseURL: '/api/v1'`.

```typescript
// ❌ WRONG — doubles prefix to /api/v1/api/v1/medications
apiClient.instance.post('/api/v1/medications', data)

// ✅ RIGHT
apiClient.instance.post('medications', data)
```

---

## 6. REACT QUERY — INVALIDATION KEYS MUST MATCH

Query keys and invalidation keys must be prefix-consistent:

```typescript
// Query key
useQuery({ queryKey: ['medications', patientId, episodeId] })

// ✅ RIGHT — matches full key
invalidateQueries({ queryKey: ['medications', patientId, episodeId] })

// ✅ ALSO RIGHT — prefix match with exact: false
invalidateQueries({ queryKey: ['medications', patientId], exact: false })

// ❌ WRONG — only 2 parts, doesn't match 3-part query
invalidateQueries({ queryKey: ['medications', patientId] })
```

Use [query-key factories](../../packages/shared/src/queryKeys.ts) to keep keys consistent.

---

## 7. MIGRATIONS (§12 CLAUDE.md)

**Location:** `apps/api/migrations/*.ts` (Knex-tracked). SQL files in `src/db/migrations/` are read-only reference.

**Builder-first for DDL the schema builder can express:**

```typescript
await knex.schema.createTable('example', (t) => {
  t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
  t.uuid('clinic_id').notNullable().references('id').inTable('clinics');
  t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  t.index(['clinic_id']);
});
```

**Use `knex.raw()` ONLY for:**
RLS policies, CHECK constraints, triggers, backfill data, GRANT/REVOKE, view/partition/extension, idempotency guards (`IF [NOT] EXISTS`).

**Every `knex.raw()` MUST be preceded by:**

```typescript
// @migration-raw-exempt: <category>
await knex.raw(`...`);
```

Valid categories: `rls_policy`, `check_constraint`, `data_backfill_insert`, `drop_policy_if_exists`, `grant`, `trigger_create`, `function_create`, etc. (See §12.4 CLAUDE.md for full list.)

**Every migration MUST have a `down()` function that reverses the changes.** Use `IF EXISTS` on all DROP statements. Empty `down()` functions are forbidden unless annotated `// @migration-down-noop: <reason>`.

**After adding a migration:** Run `npm run db:snapshot -w apps/api` and commit the updated `schema-snapshot.json`.

---

## 8. TRANSACTIONS & CONNECTION POOL (§2 CLAUDE.md)

**Inside a transaction, use `trx()` not `db()`.**

```typescript
// ❌ WRONG — opens NEW connection; leaks from pool
db.transaction(async (trx) => {
  await trx('escalations').insert({ ... });
  const esc = await escalationRepository.findById(clinicId, id);  // calls db()!
});

// ✅ RIGHT — pass trx to repo
db.transaction(async (trx) => {
  await trx('escalations').insert({ ... });
  const esc = await escalationRepository.findById(clinicId, id, trx);
});
```

**Repository methods must accept optional `trx?: Knex.Transaction` parameter.**

---

## 9. COMMON ANTI-PATTERNS (From L4 Reviewer Checklist)

### Silent Catch (BUG-445, BUG-446, BUG-520, BUG-521, BUG-523)

```typescript
// ❌ WRONG — collapses "failed" into "empty"
let data: Medication[] = [];
try { data = await fetchMeds(id); } catch { }
// UI renders "no data" instead of "error"

// ✅ RIGHT — explicit fail states
const r = await tryAsync(() => fetchMeds(id));
if (isErr(r)) return setStatus(UIStatus.failed(r.error, retry));
setStatus(UIStatus.fromResult(r, xs => xs.length === 0));
```

### Frontend Fail-Open (BUG-416)

```typescript
// ❌ WRONG — returns () => true on fetch error
useModuleVisibility({ ... }).getVisibility = () => true;  // exposes gated surfaces!

// ✅ RIGHT — fails closed; gated surfaces hidden on error
return matchVisibility(status, {
  error: () => emptySet,  // hide all gated; show core only
  loaded: (set) => set,
});
```

### Fire-and-Forget Async (§3.2, §9.6 CLAUDE.md)

```typescript
// ❌ WRONG — error is silently lost
void createAutoContactRecord({ ... });

// ✅ RIGHT — error is observed
try {
  await createAutoContactRecord({ ... });
} catch (err) {
  logger.warn({ err }, 'Non-critical op failed');
}
```

### Ghost Columns / Row Interface Drift (BUG-529, §15 CLAUDE.md)

```typescript
// ❌ WRONG — interface declares phantom columns
export interface WaitlistEntryDb {
  id: string;
  assigned_to_id: string;    // ← doesn't exist; real column is preferred_clinician_id
  date_added: string;         // ← doesn't exist; real column is added_date
}

// ✅ RIGHT — verified against schema snapshot
export interface WaitlistEntryDb {
  id: string;
  preferred_clinician_id: string;
  added_date: string;
}
```

All forward + reverse interface↔schema drift is mechanically verified. Check `apps/api/src/db/schema-snapshot.json`.

---

## 10. TASK-SPECIFIC WORKFLOWS

### Adding a New Feature

1. **DB schema first:** Create migration(s) with full RLS + CHECK + indexes (§7, §12 CLAUDE.md)
2. **Regenerate snapshot:** `npm run db:snapshot -w apps/api`
3. **Service layer:** AuthContext-first, return `Result<T, AppError>` for expected failures
4. **Route handler:** try/catch → `next(err)` on error; Zod-parse response before sending
5. **Frontend:** Use `UIStatus<T>` for safety-surface fetches; `useQuery` + `useMutation` with matching key factories
6. **Tests:** Vitest unit + integration test covering happy path + error case
7. **Fix-registry row:** Add entry to [docs/quality/fix-registry.md](../../docs/quality/fix-registry.md)
8. **Pre-commit:**
   ```bash
   npm run lint
   npm run test -w apps/api
   npm run test:integration -w apps/api
   npm run guard:*  # ~50 guards; ~2 sec total
   ```

### Adding a New Migration

1. **File location:** `apps/api/migrations/TIMESTAMP_description.ts`
2. **Builder-first DDL** for tables, columns, simple indexes, FKs, UNIQUE constraints
3. **Every `knex.raw()` annotated:** `// @migration-raw-exempt: <category>`
4. **RLS policies required:** All tables with `clinic_id` must have RLS
5. **Indexes required:** FK columns + `clinic_id` + `patient_id` must be indexed
6. **NOT NULL on required columns:** `clinic_id`, `patient_id`, `created_at` are never nullable
7. **Idempotent `down()`:** All DROP statements use `IF EXISTS`
8. **Regenerate snapshot:** `npm run db:snapshot -w apps/api`
9. **Verify before commit:**
   ```bash
   npm run migrate:dev -w apps/api
   npm run db:snapshot -w apps/api
   # Inspect the snapshot diff to verify column names/types
   ```

### Opening a PR

**PR checklist (enforced by merge gate):**

- [ ] TypeScript compiles: `npx tsc --noEmit` ✅
- [ ] Linters pass: `npm run lint` ✅
- [ ] Unit tests: `npm run test -w apps/api` ✅
- [ ] Integration tests: `npm run test:integration -w apps/api` ✅
- [ ] All 50+ guards pass: `npm run guard:*` ✅
- [ ] E2E smoke: `npm run test:e2e` ✅
- [ ] Health check: `curl localhost:4000/health` ✅
- [ ] Fix-registry updated: new row in [fix-registry.md](../../docs/quality/fix-registry.md) ✅
- [ ] Schema snapshot fresh: `apps/api/src/db/schema-snapshot.json` committed if migrations touched ✅
- [ ] No ghost columns: verified against snapshot ✅
- [ ] No cross-tenant reads: `clinic_id` in WHERE ✅
- [ ] No soft-delete false-presence: only on tables with `deleted_at` ✅
- [ ] No `void asyncCall()`: all async wrapped in try/catch ✅
- [ ] Service layer uses AuthContext: first param is `auth: AuthContext` ✅
- [ ] Response shape Zod-validated: `Schema.parse()` at route boundary ✅

---

## 11. LOCAL DEV SETUP

**Port pin:** Signacare's local Postgres listens on **5433** (not 5432) so it coexists with other Postgres versions.

**First-time setup:**
```bash
bash installer/setup-first-run.sh  # PostgreSQL 17 + signacaredb + RLS
npm install --workspaces
npm run dev  # API localhost:4000 + Web localhost:5173
npm run seed:good-health -w apps/api  # Load demo data
```

**Before committing:**
```bash
npm run build && npm run test -w apps/api && npm run test:integration -w apps/api && npm run lint && npm run guard:*
curl localhost:4000/health  # Quick sanity check
```

---

## 12. RELATED DOCUMENTATION

Link, don't embed:

- **[CLAUDE.md](CLAUDE.md)** — 17-section development bible (5000 words); **must-read for any contributor**
- **[L4 Reviewer Checklist](../../docs/quality/l4-reviewer-checklist.md)** — Recurring failure classes
- **[Fix Registry](../../docs/quality/fix-registry.md)** — Every bug fix has a regex anchor; CI verifies no regression
- **[Schema Guide](../../docs/guides/database-schema.md)** — Table design, RLS template, migration patterns
- **[Developer Guide](../../docs/guides/developer-guide.md)** — Step-by-step: add a route, add a feature, add a patient tab
- **[Bugs Remaining](../../docs/quality/bugs-remaining.md)** — Known issues by priority + status
- **[Deployment Guide](../../docs/guides/deployment-guide.md)** — Production setup, scaling, debugging

---

## 13. GUARD SUITE (50+ CI Checks)

All wired into the merge gate. Run locally before pushing:

```bash
npm run guard:*  # Runs all ~50 guards
```

**Key guards** (or run individually):
- `guard:knex-column-references` — Column names exist in schema
- `guard:soft-delete-filter` — `.whereNull('deleted_at')` only on tables with the column
- `guard:empty-where-on-mutation` — No UPDATE/DELETE without WHERE
- `guard:service-auth-context` — Service methods accept `auth: AuthContext`
- `guard:migration-rls-policy` — New tables have RLS
- `guard:migration-index-discipline` — FK + clinic_id + patient_id indexed
- `guard:migration-convention` — Knex builder used; `knex.raw()` annotated
- `guard:fix-registry` — Every known fix is still in place
- `guard:no-fire-and-forget` — No `void asyncCall()` patterns
- `guard:timer-try-catch` — `setInterval`/`setTimeout` callbacks wrapped

See `npm run guard:?` for full list.

---

## 14. CONFIDENCE LEVELS FOR CONTRIBUTORS

- **🟢 Level 0 (Script/Config):** Edits scripts, configs, docs. No code review required beyond lint.
- **🟡 Level 1 (Feature Addition):** New route + service + integration test. Requires L1 reviewer + all guards ✅.
- **🟠 Level 2 (Safety-Critical):** Medications, clinical notes, ECT, TMS, risk, advance directives, legal, clozapine. Requires L4 clinical-safety reviewer + all guards ✅.
- **🔴 Level 3 (Architectural):** Auth, DB, RLS, cache, job queue. Requires L5 architecture reviewer + all guards ✅.

See related agents: `code-reviewer-general`, `clinical-safety-reviewer`, `architecture-reviewer`.

---

## KEY PRINCIPLE

> **"Optimal code for Signacare is correctness-first:"**
>
> Schema correctness (verified against snapshot), multi-tenant isolation (`clinic_id` in every query), safe error handling (fail-loud, not silent), and clinical-safety governance (every rule from a real bug).
>
> When in doubt, ask: "Would this survive §1 (Database Rules), §3.4 (Service Contracts), or §6 (Security) review?"
> If not, refactor before committing.

**Questions?** See [CLAUDE.md](CLAUDE.md) (read the relevant section) or [developer-guide.md](../../docs/guides/developer-guide.md) (step-by-step examples).
