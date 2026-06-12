# D50 — Post-Staging Deferred Hardening Local Implementation

Date: 2026-06-04

Scope: post-staging deferred bugs from `docs/quality/bugs-remaining.md` Section 4.

Confidence summary:

- HIGH: code changes are present in the original monorepo working tree and targeted guards/tests can verify local contracts.
- MEDIUM: BUG-051 and BUG-240 are implemented locally but are not closed until this staged tree has review-chain attestation, a commit SHA, push proof, and staging deploy proof.
- LOW: production telemetry-dependent deferred rows remain intentionally open/deferred until their live triggers occur.

## Implemented Locally, Pending Closure Evidence

### BUG-051 — Error Contracts

Local implementation:

- Replaced patient-app inline error responses with `AppError` where this slice touched patient-app public flow behavior, so the global error middleware owns response envelopes.
- Added long-running AI HTTP route classification for `/llm`, `/scribe`, `/voice`, and `/documents` so staging AI failures do not surface as normal 30-second request errors.
- Added global feature-flag read RLS policy so frontend bootstrap can see global feature flags under FORCE RLS without relying on runtime BYPASSRLS.

Closure gate:

- Requires review-chain PASS, commit SHA, push proof, and staging deploy verification before the ledger may move from `in_progress` to `fixed`.

### BUG-240 — Mobile Patient App Registration

Local implementation:

- Added `patient_app_registration_requests` migration with RLS, FORCE RLS, rollback, status check, tenant indexes, and a partial unique pending-request dedupe index.
- Added `POST /api/v1/patient-app/register` as a public, rate-limited, reviewed intake request path.
- Preserved safety: registration does not create live patients, patient-app accounts, or passwords. Activation remains invite-code based.
- Added explicit patient consent enforcement: omitted or false consent is rejected by schema validation, and the Flutter registration form now requires an explicit checkbox acknowledgement.
- Added PHI-at-rest protection on intake request fields via the existing PHI encryption helper; dedupe uses a hash fingerprint rather than plaintext lookup.
- Added tenant-scoped insert under `withTenantContext()` plus metadata-only audit logging for the intake request.
- Added integration coverage for registration create, dedupe, malformed payload validation, and omitted/false consent rejection.

Closure gate:

- Requires review-chain PASS, commit SHA, push proof, staging migration execution, and staging registration smoke before the ledger may move from `in_progress` to `fixed`.

## Deferred Rows Revalidated

These remain deferred because their closure trigger requires production telemetry or production feature enablement that is not available from code alone. Each row now carries an explicit confidence label and close-by trigger in `docs/quality/bugs-remaining.md`.

- `BUG-SA-109`
- `BUG-SA-110`
- `BUG-SA-111`
- `BUG-SCRIBE25-101`
- `BUG-SCRIBE25-102`
- `BUG-SCRIBE25-103`
- `BUG-SCRIBE25-104`

## Verification To Capture Before Closure

The following commands must be rerun against the final staged tree and, where practical, output captured before any closure claim:

- `npm run guard:error-envelope-consistency`
- `npm run guard:post-deploy-s2-readiness-contract`
- `npm run guard:generator-no-diff`
- `npm run build:check -w apps/api`
- `npm run test -w apps/api -- --run tests/unit/llmHttpTimeout.test.ts tests/unit/localLlmTimeoutContract.test.ts`
- `npm run test:integration -w apps/api -- patientAppAuth.test.ts`
- `npm run build -w apps/web`
- `flutter analyze` from `apps/patient-app`
- `npm run guard:no-column-ddl-in-raw-sql`
- `npm run guard:migration-index-discipline`
- `npm run guard:migration-rollback-discipline`
- `npm run guard:row-iface-drift`
- `npm run guard:row-iface-coverage-contract`
- `npm run guard:claude-discipline:ci`
- `npm run lint:changed`

Do not mark BUG-051 or BUG-240 fixed from this evidence file alone.
