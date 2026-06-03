# Plan — BUG-458 REPLAY: Appointment service fabricates null/false for 7 real DB columns

[Plan agent invocation 2026-04-25 per `~/.claude/plans/sleepy-roaming-meteor.md` PART 2 §B; first-principles re-derivation per PART 6.1 #3 — no read of any reverted commit. Atomic-scope per PART 11. Applying BUG-456 absorb-1 + BUG-457 lessons: parse-on-emit with `details: { appointmentId, zodIssues }`, `^`-anchored fix-registry shapes (BUG-510 escaped-pipe defect avoided), atomic catalogue flip in same commit, UNION-up-front review.]

**Severity:** S1 deploy-blocker (pre-staging)
**Replay queue position:** PART 1 Tier-3 #20 (after BUG-457)
**Sibling shipped at HEAD:** BUG-456 (`718c72e`), BUG-457 (`18f6c3b`).

## §0. Drift summary

The audit (`docs/archive/audit-2026-04-24/findings/findings-6b-shared-types.md:19`) phrased the defect as "DB columns don't exist." That premise is **outdated**.

Verified at HEAD (2026-04-25):
1. `apps/api/migrations/20260701000000_baseline.ts:4708-4717` declares all 7 columns.
2. Live DB `information_schema.columns` confirms all 7 present.
3. `appointmentRepository.findById` (`.first()`, no `.select(...)`) and `list` paths DO return the columns at runtime.

**The actual defect is three-layered:**
- **Mapper layer** (`appointmentService.ts:65 mapDbToResponse()`) — discards 7 fields, substitutes hardcoded null/false (lines 79-86).
- **Repository layer** (`appointmentRepository.ts:59-78 APPOINTMENT_COLUMNS`) — 18-column `.returning(...)` array used by create/update EXCLUDES the 7 columns.
- **Row-interface layer** (`appointmentRepository.ts:15-34 AppointmentDb`) — declares 18 fields, omits the 7 (column-exists-but-undeclared §15 quality gap).

**Net consequence:** `GET /api/v1/appointments/:id` for a row with `reminder_sent = true` returns `reminderSent: false` — false-negative on reminder delivery; the reschedule-lineage (`rescheduled_from_id`) and outlook-event-id are silently dropped.

## §1. Verification — Read-confirmed

| Path | File:line | Behavior |
|---|---|---|
| `findById` | `appointmentRepository.ts:105-111` | `.first()`, returns ALL columns ✓ |
| `list` (no clinicianId) | `:144-157` | no `.select(...)`, returns ALL ✓ |
| `list` (with clinicianId) | `:124-141` | `select('a.*')`, returns ALL ✓ |
| `create` | `:84-89` | `.returning(APPOINTMENT_COLUMNS)` — STRIPS 7 columns ✗ |
| `update` | `:91-103` | `.returning(APPOINTMENT_COLUMNS)` — STRIPS 7 columns ✗ |

SSoT (`packages/shared/src/appointment.schemas.ts:74-97`) already declares all 7 fields with right Zod shapes. No SSoT change needed.

Zero existing tests assert on these 7 fields by camelCase name (verified via grep across `apps/api/tests/`).

## §2. Fix shape — Path A

1. Widen `AppointmentDb` interface — add 7 fields.
2. Widen `APPOINTMENT_COLUMNS` array — add 7 column names.
3. Rewire `mapDbToResponse()` to read 7 real columns. `reminder_sent_at` needs Date→ISO conversion.
4. Add `AppointmentResponse.safeParse()` parse-on-emit + `AppError(500, 'RESPONSE_SHAPE_ERROR')` wrap with `details: { appointmentId, zodIssues }`.
5. NEW integration test `appointmentResponseShape.int.test.ts` with 5 cases.
6. 5 fix-registry rows (`^`-anchored).

Path B (drop the 7 fields from response shape) REJECTED — they're real DB data; `reminder_sent` is the only clinician-visible reminder-delivery indicator; cascades into frontend changes.

## §3. UNION-up-front review

| Field | Knex returns | Zod expects | Conversion |
|---|---|---|---|
| `telehealth_provider` | `string \| null` | `z.string().nullable().optional()` | direct `?? null` |
| `telehealth_passcode` | `string \| null` | `z.string().nullable().optional()` | direct `?? null` |
| `rescheduled_from_id` | `string \| null` | `z.string().uuid().nullable().optional()` | direct `?? null` |
| `reminder_scheduled` | `boolean` | `z.boolean()` | `Boolean(row.reminder_scheduled)` |
| `reminder_sent` | `boolean` | `z.boolean()` | `Boolean(row.reminder_sent)` |
| **`reminder_sent_at`** | **`Date \| null`** | **`z.string().datetime().nullable().optional()`** | **`(row.reminder_sent_at as Date \| null)?.toISOString() ?? null`** |
| `outlook_event_id` | `string \| null` | `z.string().nullable().optional()` | direct `?? null` |

No SSoT widening needed.

## §4. AppointmentDb row interface — §15 contract drift (atomic)

Add exactly the 7 BUG-458 columns. Do NOT widen for the unrelated ~10 columns (`start_time`, `end_time`, `duration_minutes`, `mode`, `mbs_item`, `patient_response`, `location`, `telehealth_link`, `recurrence_*`) — file as **BUG-489** (S2) per PART 3.

## §5. Integration test plan (5 cases — `appointmentResponseShape.int.test.ts`)

| # | Test | Pre-fix | Post-fix |
|---|---|---|---|
| AI-1 | Seed appointment with defaults, GET, assert all 7 hardcoded defaults appear | PASS (same observable) | PASS |
| AI-2 | Seed `reminder_sent=true, reminder_sent_at='2026-04-25T10:00:00Z'`, GET | **REGRESSES** | PASS |
| AI-3 | Seed two appointments, second with `rescheduled_from_id=<A.id>`, GET B | **REGRESSES** | PASS |
| AI-4 | Seed `telehealth_provider='zoom', telehealth_passcode='123456', outlook_event_id='AAMkAD...'`, GET | **REGRESSES** | PASS |
| AI-5 | Full Zod parse `AppointmentResponse.safeParse(res.body).success === true` | PASS | PASS |

3× flake; integration suite required (touches row interface + repository).

## §6. Fix-registry rows (5, all `^`-anchored)

| Row ID | File | Mode | Pattern |
|---|---|---|---|
| `R-FIX-BUG-458-NO-FABRICATED-REMINDER` | `appointmentService.ts` | absent | `^    reminderScheduled: false,$` |
| `R-FIX-BUG-458-NO-FABRICATED-RESCHEDULE` | `appointmentService.ts` | absent | `^    rescheduledFromId: null,$` |
| `R-FIX-BUG-458-NO-FABRICATED-OUTLOOK` | `appointmentService.ts` | absent | `^    outlookEventId: null,$` |
| `R-FIX-BUG-458-MAPPER-SSOT-PARSE` | `appointmentService.ts` | present | `AppointmentResponse\.safeParse\(` |
| `R-FIX-BUG-458-AUDIT-DETAILS-PAYLOAD` | `appointmentService.ts` | present | `appointmentId.*zodIssues` (multiline) |

## §7. Files to modify

| File | Change |
|---|---|
| `apps/api/src/features/appointments/appointmentService.ts` | Rewire `mapDbToResponse()` lines 65-90; add safeParse + AppError |
| `apps/api/src/features/appointments/appointmentRepository.ts` | Widen `AppointmentDb` (lines 15-34) + `APPOINTMENT_COLUMNS` (lines 59-78) |
| `apps/api/tests/integration/appointmentResponseShape.int.test.ts` | NEW |
| `docs/quality/fix-registry.md` | 5 rows |
| `docs/quality/bugs-remaining.md` | Atomic flip BUG-458 → fixed |

No migration. No SSoT change. No frontend change.

## §8. PART 2 §H/§I trigger assessment

- **L4:** `apps/api/src/features/appointments/` is NOT in §13.5 path list. Diff is read-shape only — no fail-open↔fail-closed, no audit-write, no patient-safety gate. **L4 does NOT fire.**
- **L5:** YES — modifies fix-registry, modifies row interface (§15 contract), adds parse-on-emit pattern (third instance after BUG-456/457).
- **L3:** unconditional.

## §9. Risks + follow-ups (file via PART 3)

- **Risk 1:** consumers depend on fabricated defaults → empirically dispelled (zero response-reads on these fields).
- **Risk 2:** `mapDbToResponse` is single → verified.
- **BUG-489** (S2): residual `AppointmentDb` ↔ DB drift on ~10 other columns.
- **BUG-491** (S2): `rowToInsert` doesn't persist `telehealth_provider/passcode` from DTO.

## §10. Acceptance

5 fix-registry pass; 5 integration tests ×3 GREEN; tsc/lint clean; L1 guards (incl. `check-row-interface-matches-db.ts`) green; no L2 regression; L3+L5 PASS; bugs-remaining flipped atomic; progress.md appended.

Per PART 6.1: no shortcut, no abstraction wrapper, no scope creep, no `--no-verify`, no `--amend`, no `--force` to main.
