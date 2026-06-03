# BUG-315/BUG-334 A2-2 Phase C Closure Evidence (2026-05-12)

## Scope

Lane: `A2`  
Step: `A2-2` Phase C (`NOT NULL` enforcement)  
Bugs: `BUG-315`, `BUG-334`

## Phase C Preconditions (Measured)

Command:

```bash
DOTENV_CONFIG_PATH=apps/api/.env npx tsx -r dotenv/config -e "import {dbAdmin} from './apps/api/src/db/db'; const run=async()=>{const c=await dbAdmin('clinical_notes').whereNull('deleted_at').whereNull('consent_id').count('* as c').first(); const h=await dbAdmin('clinics').whereNull('hpio').count('* as c').first(); console.log('clinical_notes_null_consent_id_non_deleted',c?.c); console.log('clinics_null_hpio',h?.c); await dbAdmin.destroy();}; run().catch(async(e)=>{console.error(e); await dbAdmin.destroy(); process.exit(1);});"
```

Output:

```text
clinical_notes_null_consent_id_non_deleted 0
clinics_null_hpio 0
```

## Readiness Manifest Flip + Guards

Manifest:

- `.github/a2-not-null-readiness.json`
  - `allowNotNullEnforcement=true`
  - `BUG-315 backfillStatus=complete`
  - `BUG-334 backfillStatus=complete`

Guard commands:

```bash
npm run guard:a2-not-null-app-readiness
npm run guard:a2-not-null-readiness
```

Result:

```text
✓ check-a2-not-null-app-readiness
  BUG-315: blockers=0
  BUG-334: blockers=0
✓ check-a2-not-null-readiness
  allowNotNullEnforcement: true
```

## Migration Enforcement

Command:

```bash
npm run migrate:dev -w apps/api
```

Result:

```text
Migrations complete. Mode: ts-node. Batch 71.
Applied: 20260701000060_bug_clinical_roles_unique_name.ts, 20260701000061_bug_315_334_not_null_phase_c.ts
```

## Integration Proof

Command:

```bash
npm run test:integration -w apps/api -- tests/integration/clinicalNotesConsentFK.int.test.ts tests/integration/limitCeilings.int.test.ts tests/integration/reportsRoutesHealth.int.test.ts
```

Result:

```text
✓ tests/integration/clinicalNotesConsentFK.int.test.ts
✓ tests/integration/limitCeilings.int.test.ts
✓ tests/integration/reportsRoutesHealth.int.test.ts
```

`clinicalNotesConsentFK.int.test.ts` was updated for Phase C enforced semantics:

1. FK must be `convalidated=true`.
2. `consent_id` must be `NOT NULL`.
3. insert with `consent_id=NULL` must fail (`23502`).

## Lane Gate Snapshot (A2-2 Slice)

Commands run:

```bash
npm run guard:claude-discipline:ci
npm run typecheck
npx eslint apps/api/scripts/backfill-clinical-notes-consent-id-phase-c.ts apps/api/scripts/backfill-clinics-hpio-phase-c.ts apps/api/migrations/20260701000061_bug_315_334_not_null_phase_c.ts
npm run migrate:rehearsal
npm run guard:dr-drill-fingerprint
```

Result:

```text
PASS across all listed commands.
```

## DR Smoke Impact Note

Command:

```bash
npm run dr:restore-drill
```

Current result:

```text
Expected DR schema fingerprint missing or invalid.
Provide DR_EXPECTED_SCHEMA_FINGERPRINT or docs/quality/expected-schema-fingerprint.txt with a 64-char SHA-256 hash.
```

Interpretation:

1. A2-2 schema enforcement is complete.
2. DR drill fingerprint artifact remains a global release-evidence blocker (C3/shared gate), not a reason to revert A2-2 data-contract closure.
