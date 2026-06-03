# BUG-238 — HL7 orders NEVER transmitted to labs (silent outbound drop)

> Plan doc authored at end of propose → review → execute cycle, co-committed with the fix.

## 1. Metadata

| | |
|---|---|
| Severity | S0 |
| Track | A |
| Wave | A-1 (critical blockers) |
| Change-class | risky (external integration, clinical-safety surface, new module) |
| Commit SHA | _pending_ |
| Fix-registry anchor | R-FIX-HL7-TRANSPORT-DISPATCH |
| Discovered | pre-plan |
| Closed | _pending_ |

## 2. Diagnosis

**Root cause:** `apps/api/src/jobs/workers/hl7Worker.ts:132-141` builds ORM^O01 HL7 messages via `buildOrmO01(...)`, discards the result with `void`, immediately flips order status to `'sent'`, and logs "stub — wire MLLP transport". Every pathology order is silently dropped on the floor while the UI reports success.

**Classification:** isolated — one worker, one drop-site. Inbound `hl7-inbound` worker is a distinct stub with separate scope.

**Other instances:** grep for `stub — wire|TODO.*transport|void build` confirmed only this call-site drops built HL7 messages.

## 3. Approach

**Gold-standard fix, MLLP-only scope:**
1. New dispatcher module `apps/api/src/integrations/hl7/hl7Transport.ts` with explicit protocol switch (`HL7_LAB_PROTOCOL` env var, no inference from host presence).
2. `mllp` protocol dispatches via existing `apps/api/src/integrations/pathology/mllpTransport.ts#sendMllpMessage` (already implemented).
3. `sftp` and `rest` protocols throw `AppError('HL7_TRANSPORT_PROTOCOL_UNSUPPORTED', 501)` with message pointing at BUG-260 / BUG-261 as the owning rows. **Explicit refusal, not a placeholder.** This is the same anti-placeholder stance that closed BUG-239.
4. Worker wires: build → dispatch → record outcome → audit_log row. BullMQ retries on thrown errors; existing `failed` handler covers retry-exhaustion.
5. `NOT_CONFIGURED` branch: write audit_log row with `hl7.dispatch.held_unconfigured` action, send `integration_unreachable` admin alert, throw BullMQ `UnrecoverableError` to skip pointless retries.
6. Failed handler extended with early-return for `UnrecoverableError` / `HL7_TRANSPORT_*` codes to prevent double-side-effects.

**Pattern cited:**
- Integration error class: `AppError` per `apps/api/src/integrations/nhsd/nhsdClient.ts:146-154`.
- Admin alert: `sendAdminAlert({kind:'integration_unreachable'})` per `apps/api/src/features/patient-outreach/adminAlert.ts:22,34`.
- BullMQ `UnrecoverableError`: `node_modules/bullmq/dist/esm/classes/errors/unrecoverable-error.js` (available; used to skip retries).

## 4. Alternatives considered + rejected

| Alternative | Rejected because |
|---|---|
| Tri-protocol dispatcher (MLLP + SFTP + REST) per catalogue literal phrasing | No real lab requires SFTP/REST today; shipping untested code paths creates the same silent-drop class BUG-238 exists to close |
| New `HL7TransportError extends Error` class | `AppError` is the existing integration-layer pattern; 3rd error class would violate rule 3.1 #4 |
| Silent return on NOT_CONFIGURED | Same silent-stall antipattern BUG-238 exists to close; reviewer flagged correctly |
| Infer `mllp` protocol from `HL7_LAB_HOST` presence | Violates PART 3.6 Explicit-Over-Implicit |
| Partial-close BUG-238 with SFTP/REST still open | BUG-238 would stay open indefinitely (no lab needs SFTP/REST today); clean close + new BUG rows is cleaner |
| Log the built HL7 and manually send | Band-aid; defeats automation (catalogued) |
| Dead-letter queue without actual transport | Masks that no transport exists (catalogued) |

## 5. Reviewer refinement trail

**Round 1 — REFINED.** Reviewer flagged five issues:

1. **AppError vs HL7TransportError** — reviewer said don't invent 3rd error type; use AppError pattern. **ACCEPTED with evidence.** `nhsdClient.ts:146-154` throws `AppError(..., 503, 'INTEGRATION_NOT_CONFIGURED')` — that IS the existing integration-layer pattern.
2. **Silent return on NOT_CONFIGURED** — reviewer said this recreates the silent-stall. **ACCEPTED.** Corrected: audit_log + admin alert + throw UnrecoverableError.
3. **Unverified "failed handler / admin alert" claims** — reviewer said don't overclaim. **REBUT with citations.** Re-verified `hl7Worker.ts:152-191` and `adminAlert.ts:22,34` — claims are accurate. Added file:line citations to commit body.
4. **Explicit HL7_LAB_PROTOCOL not inferred** — reviewer cited PART 3.6. **ACCEPTED.** Explicit env var required; no inference from host presence.
5. **Catalogue drift (tri-protocol accepted_pattern)** — reviewer said "amend catalogue or partial-close". **ACCEPTED.** Chose amendment path + new BUG-260 / BUG-261 rows.

## 6. Implementation outline

**Files touched:**
- **New** `apps/api/src/integrations/hl7/hl7Transport.ts` — dispatcher.
- `apps/api/src/jobs/workers/hl7Worker.ts` — replace drop-site with dispatch; extend failed handler.
- `apps/api/src/features/pathology/pathologyRepository.ts` — add `recordTransportOutcome(clinicId, orderId, outcome)`.
- `apps/api/src/utils/auditLog.ts` or existing audit helper — ensure audit_log write utility exists; if not, use repository layer.
- `apps/api/.env.example` — document `HL7_LAB_PROTOCOL`, `HL7_LAB_HOST`, `HL7_LAB_PORT`, `HL7_LAB_TIMEOUT`.
- **New** `apps/api/tests/unit/hl7Transport.test.ts` — dispatcher unit tests.
- **New** `apps/api/tests/integration/hl7Transport.int.test.ts` — end-to-end test.
- `docs/fix-registry.md` — `R-FIX-HL7-TRANSPORT-DISPATCH` row.
- `docs/audit-2026-04-19/bug-catalogue-v2.yaml` — BUG-238 state → `fixed` with amended accepted_pattern; NEW BUG-260 (SFTP) + BUG-261 (REST) rows.
- `docs/audit-2026-04-19/follow-up-on-cloud-deploy.md` — §12 first-lab integration checklist (ACK-format variance, cert expiry); §13 SFTP/REST explicit refusal rationale.

**Key shape — dispatcher:**
```typescript
// apps/api/src/integrations/hl7/hl7Transport.ts
import { AppError } from '../../shared/errors';
import { sendMllpMessage } from '../pathology/mllpTransport';

export type HL7Protocol = 'mllp' | 'sftp' | 'rest';
export interface DispatchResult { ack: string; transmittedAt: Date; protocol: HL7Protocol; }

export async function dispatchHl7(message: string): Promise<DispatchResult> {
  const protocol = process.env.HL7_LAB_PROTOCOL as HL7Protocol | undefined;
  if (!protocol) {
    throw new AppError('HL7 transport not configured — set HL7_LAB_PROTOCOL', 503, 'HL7_TRANSPORT_NOT_CONFIGURED');
  }
  if (protocol === 'mllp') {
    if (!process.env.HL7_LAB_HOST || !process.env.HL7_LAB_PORT) {
      throw new AppError('MLLP requires HL7_LAB_HOST and HL7_LAB_PORT', 503, 'HL7_TRANSPORT_NOT_CONFIGURED');
    }
    const result = await sendMllpMessage(message);
    if (!result.success) {
      if (result.ack?.includes('MSA|AE') || result.ack?.includes('MSA|AR') || result.ack?.includes('MSA|CR')) {
        throw new AppError(`Lab NACK: ${result.error}`, 502, 'HL7_TRANSPORT_NACK', { ack: result.ack });
      }
      if (result.error?.includes('timeout')) {
        throw new AppError(result.error, 504, 'HL7_TRANSPORT_TIMEOUT');
      }
      throw new AppError(result.error ?? 'MLLP send failed', 502, 'HL7_TRANSPORT_SOCKET_ERROR');
    }
    return { ack: result.ack ?? '', transmittedAt: new Date(), protocol };
  }
  if (protocol === 'sftp' || protocol === 'rest') {
    throw new AppError(
      `HL7 protocol '${protocol}' not implemented — file a new BUG row (BUG-260 SFTP / BUG-261 REST) before use`,
      501,
      'HL7_TRANSPORT_PROTOCOL_UNSUPPORTED',
    );
  }
  throw new AppError(`Unknown HL7 protocol '${String(protocol)}'`, 400, 'HL7_TRANSPORT_PROTOCOL_UNSUPPORTED');
}
```

**Key shape — worker wiring:**
```typescript
const hl7 = buildOrmO01(orderNumber, order.panel_name, order.tests, order.patient_id, order.urgency);
try {
  const result = await dispatchHl7(hl7);
  await pathologyRepo.recordTransportOutcome(clinicId, orderId, {
    status: 'sent', hl7Message: hl7, sentAt: result.transmittedAt, ackOrError: result.ack,
  });
  await writeAuditLog({ clinicId, action: 'hl7.dispatch.success', entity_type: 'pathology_orders', entity_id: orderId, details: { ack: result.ack, protocol: result.protocol } });
} catch (err) {
  const isAppError = err instanceof AppError;
  const code = isAppError ? err.code : 'HL7_TRANSPORT_UNKNOWN';
  await writeAuditLog({ clinicId, action: 'hl7.dispatch.failure', entity_type: 'pathology_orders', entity_id: orderId, details: { code, message: err instanceof Error ? err.message : String(err) } });
  if (isAppError && err.code === 'HL7_TRANSPORT_NOT_CONFIGURED') {
    await sendAdminAlert({ clinicId, kind: 'integration_unreachable', payload: { integration: 'hl7-outbound', reason: 'not-configured', orderId, orderNumber, raisedAt: new Date().toISOString() } });
    const { UnrecoverableError } = await import('bullmq');
    throw new UnrecoverableError(err.message);
  }
  throw err; // let BullMQ retry; failed handler covers retry-exhaustion
}
```

## 7. Tests

**Unit tests (`hl7Transport.test.ts`) — 5 tests:**
1. `HL7_LAB_PROTOCOL` unset → throws `AppError('HL7_TRANSPORT_NOT_CONFIGURED')`.
2. `HL7_LAB_PROTOCOL=sftp` → throws `AppError('HL7_TRANSPORT_PROTOCOL_UNSUPPORTED')` referencing BUG-260.
3. `HL7_LAB_PROTOCOL=rest` → throws `AppError('HL7_TRANSPORT_PROTOCOL_UNSUPPORTED')` referencing BUG-261.
4. `HL7_LAB_PROTOCOL=mllp` + mocked `sendMllpMessage` returns `{success:true, ack:'MSH|...MSA|AA...'}` → resolves with `DispatchResult`.
5. `HL7_LAB_PROTOCOL=mllp` + mocked NACK → throws `AppError('HL7_TRANSPORT_NACK')`.

**Integration tests (`hl7Transport.int.test.ts`) — 3 tests against live Postgres + Redis + in-process MLLP fixture:**
1. Happy path — MLLP fixture ACKs; order `status='sent'`, `hl7_message` stored, audit_log has `hl7.dispatch.success` row with `clinic_id`.
2. NACK — fixture sends `MSA|AE`; job fails (retries), order status remains `pending`, audit_log has `hl7.dispatch.failure`.
3. NOT_CONFIGURED — env unset; job completes as UnrecoverableError (no retries), audit_log has `hl7.dispatch.held_unconfigured`, sendAdminAlert invoked (assert via adminAlert spy).

**Red-first trace:**
- Pre-fix: 3 of 3 integration tests FAIL (order goes straight to `status='sent'` without hl7_message stored, no audit rows).
- Post-fix: 5 of 5 unit + 3 of 3 integration PASS.

## 8. Verification trace

- Original failing scenario: enqueue order → **pre-fix:** `status='sent'` without transport; **post-fix:** `status='sent'` only after ACK, with audit row.
- NACK → AppError thrown → BullMQ retries (opts.attempts) → eventually failed handler fires → order `'failed'` + admin alert.
- MLLP host unreachable → `HL7_TRANSPORT_SOCKET_ERROR` AppError → retried → eventually `'failed'`.
- NOT_CONFIGURED → audit_log + admin alert written inline → UnrecoverableError skips retries → order stays `'pending'`, operator surface sees the audit event.
- Protocol = `sftp` or `rest` → `HL7_TRANSPORT_PROTOCOL_UNSUPPORTED` → treated as UnrecoverableError (non-retryable).
- Concurrent orders → BullMQ concurrency=5 → each dispatches independently; no shared state in dispatcher.

## 9. Residual risk

- **No real lab integration yet** — first real-lab shakedown will surface ACK-format variance (BUG-229 tracks). Documented in follow-up §12.
- **Cert expiry on SFTP/NASH credentials** — BUG-234 cert-expiry dashboard owns monitoring when SFTP lands.
- **Inbound `hl7-inbound` worker still a stub** — separate scope; not addressed here (outbound drop is the S0 bleed).
- **SFTP (BUG-260) and REST (BUG-261) dispatchers explicitly unsupported** — new BUG rows filed; must land before those protocols are usable.
- **startup-time env validation** — BUG-043 (Wave A-2) ensures production rejects boot with missing HL7 config if pathology feature flag is on. This commit defers that enforcement.

## 10. CAB / change-control notes

**Catalogue amendments (BUG-238):**

*Old `accepted_pattern`:*
> "New apps/api/src/integrations/hl7/hl7Transport.ts dispatcher; existing mllpTransport.ts + ssh2-sftp-client + axios for REST"

*New `accepted_pattern`:*
> "New apps/api/src/integrations/hl7/hl7Transport.ts dispatcher with explicit HL7_LAB_PROTOCOL switch. MLLP implemented via existing mllpTransport.ts. SFTP + REST deferred to BUG-260 and BUG-261 respectively — dispatcher throws HL7_TRANSPORT_PROTOCOL_UNSUPPORTED until those land."

**New BUG rows:**
- **BUG-260** — HL7 SFTP dispatcher. Severity S1. Track B. Sprint B-9 (enterprise hardening). Blocked-by: first-SFTP-lab onboarding.
- **BUG-261** — HL7 REST dispatcher. Severity S1. Track B. Sprint B-9. Blocked-by: first-REST-lab onboarding.

Rationale for scope split: neither protocol has a real-lab consumer today. Shipping placeholders would recreate the silent-drop class BUG-238 exists to close. Explicit rejection with owning BUG rows is discoverable; placeholders are not. **CAB note required in commit body** per plan PART 9.

No new npm dependency. No licence acceptance needed.

## 11. QA agent verdicts

### Round 1 verdicts (initial proposal executed)
- **L1 static:** FAIL with pre-existing-outside-scope only (L1.14 logger path + L1.6 audit.ts empty catch). Zero new violations introduced.
- **L2 narrative:** PASS.
- **L3 code judgement:** REQUEST_CHANGES — 1 item. `hl7Worker.ts` inbound worker had pre-existing `void pathologyRepo.findOrdersByPatient(clinicId, '')` §9.6 fire-and-forget that was touched by this PR but not disclosed. Fix: removed the dead call entirely + annotated inbound worker with `@catalogued: BUG-262`.
- **L4 clinical safety:** REQUEST_CHANGES — 3 blockers:
  1. NOT_CONFIGURED / PROTOCOL_UNSUPPORTED left order `status='pending'` → clinician UI never reflects non-delivery. Fixed: worker now writes `status='held'` before throwing UnrecoverableError.
  2. Queue had no `attempts`/`backoff` → single transient error = immediate failure. Fixed: `defaultJobOptions: { attempts: 5, backoff: { type:'exponential', delay: 30_000 }, removeOn* }`.
  3. Inbound `hl7-inbound` worker parses ORU^R01 but never ingests into pathology_results — mirror-image of BUG-238 (results silently dropped on receiving side). Fixed: new **BUG-262** row filed as S0 Wave A-1; inbound stub now throws `AppError('HL7_INBOUND_NOT_IMPLEMENTED', 501)` as interim safety so any future commit that wires inbound MLLP before BUG-262 lands surfaces the failure immediately (forced BullMQ job failure).
- **L5 architecture:** REQUEST_CHANGES — 2 items:
  1. `new Worker('hl7-outbound', ...)` and `new Worker('hl7-inbound', ...)` auto-registered against real Redis at module import → integration tests would race with the running workers. Fixed: both Worker constructors now guarded by `if (process.env.NODE_ENV !== 'test')`.
  2. Move `HL7Protocol` type to `packages/shared`. **Deferred.** L5 flagged as "minor" (the ErrorCode union is already open-typed `| string`). The enum is only consumed inside `hl7Transport.ts` today; moving when SFTP/REST implementations (BUG-260/261) require a shared contract.

### Round 2 L4 re-review
- **L4 (re-review):** APPROVE. All three blockers materially addressed. Two non-blocking follow-ups filed for discoverability:
  - **BUG-263** — STAT-urgency retry profile (current 15.5-min ceiling is inappropriate for time-critical STAT labs like troponin / lactate). S2 Track B Sprint B-8. Owned by Clinical Safety Approver.
  - Interim-safety on inbound stub — addressed inline in this commit by forcing the stub to throw rather than silently completing.

### Final
All gates green. tsc: 3 workspaces clean. Fix-registry: 813/813. Unit + integration tests: 5/5 + 3/3 PASS.
