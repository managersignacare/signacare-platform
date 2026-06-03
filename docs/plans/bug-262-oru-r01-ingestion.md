# Plan — BUG-262 HL7 inbound ORU^R01 persistence (silent-drop fix)

## Context

**Why this change:** BUG-262 is an S0 clinical-safety bug. The inbound MLLP listener at `apps/api/src/integrations/pathology/mllpTransport.ts:108-152` accepts ORU^R01 lab-result messages, ACKs the lab immediately (line 137), and enqueues to BullMQ. The worker at `apps/api/src/jobs/workers/hl7Worker.ts:336-370` parses the message successfully, emits a WARN log, then throws `HL7_INBOUND_NOT_IMPLEMENTED` — the stub that closes the pipeline. Result: the lab believes delivery succeeded; Signacare has the data in a log line but nothing lands in `pathology_results`. Clinicians never see the result.

**What changes:** replace the stub with real ingestion — order lookup → DTO mapping → `createResult` (admin-pool variant) → critical-flag task creation when abnormal_flag matches. Add an application-level idempotency check to survive BullMQ retries.

**Scope boundary:** one-commit fix. MLLP ACK semantics stay as-is (ACK-on-enqueue; BullMQ durable). No migration in this commit — idempotency is application-level. Follow-up work for a DB-level unique constraint is noted but deferred.

## Existing code to reuse (grep-verified)

- [`apps/api/src/jobs/workers/hl7Worker.ts:53-78`](apps/api/src/jobs/workers/hl7Worker.ts#L53-L78) — `parseOruR01` already parses into `ParsedOruR01 { orderNumber, collectionDate, resultDate, performingLab, observations[] }`. Reuse unchanged.
- [`apps/api/src/jobs/workers/hl7Worker.ts:90-121`](apps/api/src/jobs/workers/hl7Worker.ts#L90-L121) — `mapHL7AbnormalFlag` + `mapHL7ResultStatus` already map HL7 codes to the `PathologyResultIngestDTO` enum. Reuse unchanged.
- [`apps/api/src/features/pathology/pathologyRepository.ts:152`](apps/api/src/features/pathology/pathologyRepository.ts#L152) — `findOrderByIdAdmin` demonstrates the `dbAdmin` + explicit clinic_id pattern for worker context. Mirror for the new `findOrderByNumberAdmin`.
- [`apps/api/src/features/pathology/pathologyRepository.ts:183-211`](apps/api/src/features/pathology/pathologyRepository.ts#L183-L211) — `createResult` is the write. Uses `db()` (RLS proxy). Need a `createResultAdmin` mirror that uses `dbAdmin` + explicit clinic_id.
- [`apps/api/src/features/pathology/pathologyService.ts:144-185`](apps/api/src/features/pathology/pathologyService.ts#L144-L185) — `ingestResult` is the request-path orchestrator (lookup order → create result → if critical, fan out to MDT task). Mirror for `ingestResultFromHl7` in worker context.
- [`packages/shared/src/pathology.schemas.ts:38-53`](packages/shared/src/pathology.schemas.ts#L38-L53) — `PathologyResultIngestSchema` + `PathologyResultIngestDTO` — DTO to map into.
- [`apps/api/src/features/tasks/taskService.ts:createTaskInternal`](apps/api/src/features/tasks/taskService.ts) — already used by `ingestResult` for the critical-flag task. Verified to work without AuthContext (internal helper).
- [`apps/api/src/utils/audit.ts:writeAuditLog`](apps/api/src/utils/audit.ts) — for the ingestion audit row.

## Change surface

### 1. `apps/api/src/features/pathology/pathologyRepository.ts`

Add three admin-variant exports (mirror the BUG-238 `*Admin` pattern with `dbAdmin` + explicit `clinic_id`):

- `findOrderByNumberAdmin(clinicId, orderNumber)` — query `pathology_orders` by `(clinic_id, order_number)` with `.whereNull('deleted_at')`. `order_number` has UNIQUE constraint on `(clinic_id, order_number)` — returns one row or undefined.
- `createResultAdmin(clinicId, patientId, dto, isCritical)` — mirror `createResult` at line 183 using `dbAdmin`.
- `findExistingResultAdmin(clinicId, pathologyOrderId, testCode, resultStatus, collectionDate)` — idempotency check. Returns the row if a matching result already exists (or undefined).
- `setFlagTaskIdAdmin(clinicId, resultId, taskId)` — mirror the existing `setFlagTaskId` for worker context.
- `updateOrderStatusAdmin(clinicId, orderId, status)` — mirror `updateOrderStatus` for worker context, for the "mark order complete when all observations ingested" step.

### 2. `apps/api/src/features/pathology/pathologyService.ts`

Add new exported function:

- `ingestResultFromHl7(clinicId, dto)` — mirror of `ingestResult` at line 144, but:
  - Uses `findOrderByIdAdmin` → no, uses `findOrderByNumberAdmin` (order resolved by number in worker path).
  - Actually — worker has looked up the order already and knows the `pathologyOrderId`. So `ingestResultFromHl7` can accept a pre-resolved order row instead of re-looking up.
  - Signature: `ingestResultFromHl7(clinicId, orderRow, dto)` → `PathologyResultResponse`.
  - Idempotency check: call `findExistingResultAdmin` first; if match, log info + return existing row unchanged.
  - Calls `createResultAdmin`, then critical-flag task creation (same as request path — `createTaskInternal` is already context-free).

### 3. `apps/api/src/jobs/workers/hl7Worker.ts:336-370`

Replace the stub with:

```typescript
export async function processInboundHl7Job(job: { data: { clinicId: string; hl7Message: string } }): Promise<void> {
  const { clinicId, hl7Message } = job.data;

  let parsed: ParsedOruR01;
  try {
    parsed = parseOruR01(hl7Message);
  } catch (e) {
    logger.error({ err: e, clinicId }, 'HL7 inbound ORU^R01: parse failed');
    throw new UnrecoverableError('HL7 ORU^R01 parse failed');
  }

  if (!parsed.orderNumber) {
    logger.error({ clinicId }, 'HL7 inbound ORU^R01: no order number');
    throw new UnrecoverableError('HL7 ORU^R01 missing order number');
  }

  const order = await pathologyRepo.findOrderByNumberAdmin(clinicId, parsed.orderNumber);
  if (!order) {
    logger.error({ clinicId, orderNumber: parsed.orderNumber }, 'HL7 inbound ORU^R01: order not found');
    await writeAuditLog({
      clinicId, staffId: null, action: 'HL7_INBOUND_ORDER_NOT_FOUND',
      tableName: 'pathology_orders', recordId: null,
      newData: { orderNumber: parsed.orderNumber, observations: parsed.observations.length },
    });
    throw new UnrecoverableError(`HL7 ORU^R01 order ${parsed.orderNumber} not found in clinic ${clinicId}`);
  }

  const ingestedIds: string[] = [];
  for (const obs of parsed.observations) {
    const dto: PathologyResultIngestDTO = {
      pathologyOrderId: order.id,
      testCode: obs.testCode,
      testName: obs.testName || obs.testCode,
      resultValue: obs.resultValue,
      resultUnit: obs.resultUnit,
      referenceRange: obs.referenceRange,
      abnormalFlag: mapHL7AbnormalFlag(obs.hl7Flag),
      resultStatus: mapHL7ResultStatus(obs.resultStatus),
      collectionDate: parsed.collectionDate,
      resultDate: parsed.resultDate,
      performingLab: parsed.performingLab,
      hl7Raw: hl7Message,
    };
    const result = await pathologyService.ingestResultFromHl7(clinicId, order, dto);
    ingestedIds.push(result.id);
  }

  // Mark the order complete once we've ingested all observations.
  await pathologyRepo.updateOrderStatusAdmin(clinicId, order.id, 'complete');

  await writeAuditLog({
    clinicId, staffId: null, action: 'HL7_INBOUND_INGESTED',
    tableName: 'pathology_results', recordId: order.id,
    newData: { orderNumber: parsed.orderNumber, resultCount: ingestedIds.length, resultIds: ingestedIds },
  });

  logger.info({ clinicId, orderNumber: parsed.orderNumber, results: ingestedIds.length }, 'HL7 inbound ORU^R01 ingested');
}
```

### 4. `apps/api/src/utils/audit.ts`

Extend `AuditAction` union with `HL7_INBOUND_INGESTED` and `HL7_INBOUND_ORDER_NOT_FOUND`.

### 5. New integration test `apps/api/tests/integration/hl7InboundIngest.int.test.ts`

- Seed: one pathology_order with known order_number (`ORD-TEST-001`), clinic_id = test clinic, patient_id = seeded patient.
- Construct: a synthetic ORU^R01 message with 2 observations — one normal (hl7Flag=N), one critical (hl7Flag=HH).
- Scenarios:
  - T1: pre-fix stub throws → FAIL expected (TDD evidence).
  - T2: post-fix `processInboundHl7Job` returns cleanly; 2 rows in `pathology_results` with correct `abnormal_flag` mapping; order status = `complete`; `HL7_INBOUND_INGESTED` audit row exists.
  - T3: critical result triggers a flag task (`flag_task_id` is set on the critical row; task exists with `priority='urgent'`).
  - T4: re-run the same job (simulate BullMQ retry) → 0 new rows created (idempotency); existing rows unchanged.
  - T5: invalid orderNumber → throws `UnrecoverableError`; `HL7_INBOUND_ORDER_NOT_FOUND` audit row exists; 0 `pathology_results` rows created.

## Test plan

TDD-first:
1. Write the test file with T1 expecting success.
2. Run against current code → expect `HL7_INBOUND_NOT_IMPLEMENTED` throw → FAIL. Capture pre-fix FAIL trace.
3. Apply the fix.
4. Re-run → expect all 5 scenarios PASS. Capture post-fix PASS trace.
5. Flake check ×3.

Adjacent suites that must remain green:
- `hl7Transport.int.test.ts` — outbound worker; untouched code path but shares file
- `pathologyRoutes` / `pathology*` integration tests — request-path `ingestResult` unchanged
- `healthEndpoints.test.ts` — `/ready` still OK

## Gate (10-check)

| # | Check | Applies |
|---|---|---|
| 1 | tsc all 3 workspaces | ✅ |
| 2 | eslint touched files | ✅ |
| 3 | 17 CI guards | ✅ |
| 4 | fix-registry updated (new anchor R-FIX-BUG-262-ORU-R01-INGEST) | ✅ |
| 5 | TDD pre-fix FAIL captured, post-fix PASS captured | ✅ |
| 6 | Adjacent suites green | ✅ |
| 7 | Flake ×3 zero | ✅ |
| 8 | L3 code-reviewer-general | ✅ — risky-class (integrations/, jobs/workers/, features/pathology/) |
| 9 | L4 clinical-safety-reviewer | ✅ — patient clinical data (pathology_results) written from an external source |
| 10 | L5 architecture-reviewer | ✅ — touches integrations/, features/, worker boundary |

## Risk + rollback

- `UnrecoverableError` for parse failure / order-not-found means BullMQ won't retry those. Correct semantic: no amount of retry fixes a malformed message or a wrong clinic.
- For transient failures (DB down, Redis down), the worker DOES retry per BullMQ default. Fine.
- Rollback: `git revert` restores the stub. Lab messages that arrived during the outage would have ACK'd but never ingested — no data lost from the LAB's perspective, but the clinic would have to re-request those results. This is an acceptable degraded mode identical to the pre-fix state.
- ACK-on-enqueue semantics unchanged. If future requirements demand ACK-after-persistence, that's a second-order change (separate bug).

## Out of scope for this commit (explicit, with location)

- **DB-level unique constraint** on `(pathology_order_id, test_code, result_status, collection_date)` → tracked as follow-up BUG in `docs/quality/bugs-remaining.md` S2 section. Application-level idempotency check covers BullMQ retry; the DB constraint would be defence-in-depth.
- **ACK-after-persistence** — would require restructuring the MLLP listener to wait for BullMQ completion before writing the ACK. Not in this commit's scope.
- **Result-status versioning** (preliminary → final → corrected creates new append rows) — already works correctly because each status is a separate row (idempotency only triggers on EXACT match including `result_status`).
- **Out-of-order delivery** (corrected arrives before final) — accepted as a known edge case; clinical-review queue sorts by `result_date` and surfaces the most recent.

## Verification

Pre-commit commands:

```bash
# L1 tsc + eslint
npx tsc --noEmit -p apps/api/tsconfig.json
npx eslint apps/api/src/features/pathology/{pathologyService,pathologyRepository}.ts apps/api/src/jobs/workers/hl7Worker.ts apps/api/src/utils/audit.ts apps/api/tests/integration/hl7InboundIngest.int.test.ts

# L1 guards
npm run guard:row-iface-drift
npm run guard:code-columns
bash .github/scripts/check-fix-registry.sh

# L2 TDD trace
cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/hl7InboundIngest.int.test.ts

# L2 adjacent
node apps/api/scripts/run-integration-tests.mjs 2>&1 | tail -30

# L2 flake
for i in 1 2 3; do cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/hl7InboundIngest.int.test.ts; done
```
