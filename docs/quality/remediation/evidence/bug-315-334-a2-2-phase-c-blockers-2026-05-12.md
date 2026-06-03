# BUG-315/BUG-334 A2-2 Phase C Blocker Evidence (2026-05-12)

## Scope

Lane: `A2`  
Step: `A2-2` Phase C enforcement readiness check  
Purpose: capture hard data before any `NOT NULL` enforcement attempt.

## Guard Posture (Structural)

Commands:

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
  allowNotNullEnforcement: false
```

Interpretation:

1. App/API contract blockers are cleared.
2. Phase C remains intentionally locked (`allowNotNullEnforcement=false`) pending backfill completion posture.

## Runtime Backfill Snapshot (Measured)

Command:

```bash
DB_HOST=localhost DB_PORT=5433 DB_USER=signacare_owner DB_PASSWORD=*** DB_NAME=signacaredb DB_APP_USER=app_user DB_APP_PASSWORD=*** JWT_ACCESS_SECRET=*** JWT_REFRESH_SECRET=*** npx tsx -e "import {dbAdmin} from './apps/api/src/db/db'; const run=async()=>{const a=await dbAdmin('clinical_notes').whereNull('consent_id').count<{c:string}>('* as c').first(); const b=await dbAdmin('clinics').whereNull('hpio').count<{c:string}>('* as c').first(); console.log('clinical_notes_null_consent_id',a?.c); console.log('clinics_null_hpio',b?.c); await dbAdmin.destroy();}; run().catch(async(e)=>{console.error(e); await dbAdmin.destroy(); process.exit(1);});"
```

Output:

```text
clinical_notes_null_consent_id 1928
clinics_null_hpio 63
```

## Decision

Phase C `NOT NULL` enforcement remains blocked. Enabling enforcement now would violate A2 safety gates and create insert/runtime outage risk.
