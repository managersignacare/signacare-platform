# Plan — BUG-445: ReceptionistPage bulk-SMS fabricated success

[Plan agent invocation 2026-04-25 per PART 2 §B; first-principles per PART 6.1 #3.]

**Severity:** S1 (audit-flagged P0 clinical-safety per `findings-6a-silent-catch.md:42`)

## §0. Drift summary

`apps/web/src/features/receptionist/pages/ReceptionistPage.tsx:521-534` (`sendBulkReminders`) has empty `catch {}` that fabricates `{sent:0, failed:0, message:'Bulk reminders will be sent via in-app notifications…'}` on ANY apiClient throw. Because `failed===0`, the Alert at lines 563-569 renders `severity='success'` (green) with literal "Campaign created. SMS gateway not configured — campaign saved for manual sending." Clinician sees green-success banner, believes patients will be reminded, no SMS is sent, patient misses appointment.

**Aggravating factor:** backend route `/api/v1/patient-outreach/bulk-reminder` DOES NOT EXIST — verified via grep of `patientOutreachRoutes.ts` and full repo. Every production click hits 404, fabricates success. P0 patient-safety harm in active state today.

## §1. Verification (read-confirmed)

- Site exact text matches the fabrication shape cited.
- No upstream guard (button only `disabled` on `withPhone.length === 0`).
- `apiClient` exposes `error.message` from server (`SignacareApiError extends Error`, `apps/web/src/shared/services/apiClient.ts:141-175`).
- Frontend has NO `useToast` / `Snackbar` / pino logger. The file uses `console.warn` (9 sites). Reuse that pattern.
- ZERO existing tests for ReceptionistPage; web project has 2 total test files.
- **Critical constraint:** `apps/web/vitest.config.ts` runs WITHOUT jsdom (React 19 dual-instance issue). RTL `render()` doesn't work. Pure-logic helper tests are the path.
- Backend route `/bulk-reminder` is fictional — file BUG-518 follow-up.

## §2. Fix shape

### §2.1 Catch block

```tsx
catch (err) {
  const errMsg = err instanceof Error ? err.message : String(err);
  setResult({ sent: 0, failed: withPhone.length, message: `Failed to send reminders: ${errMsg}` });
  console.warn('ReceptionistPage: bulk-reminder send failed', { kind: 'bulk_sms_send_failed', err });
}
```

`failed: withPhone.length` flips Alert to error severity. No fabricated message. `console.warn` matches file convention.

### §2.2 Alert

```tsx
{result && (
  <Alert severity={result.failed > 0 ? 'error' : 'success'} sx={{ mt: 2, fontSize: 12 }}>
    {result.sent > 0 ? `${result.sent} reminders sent.` : null}
    {result.failed > 0 ? ` ${result.failed} failed to send.` : ''}
    {result.message ? ` ${result.message}` : ''}
  </Alert>
)}
```

Severity tightened `'warning' → 'error'` on any failure (red, not amber). Removed lying literals.

### §2.3 Helper extraction (for testability)

Extract `computeBulkResult(res, withPhoneCount)`, `computeBulkResultOnError(err, withPhoneCount)`, and `bulkResultSeverity(result)` as pure top-of-file helpers. Component calls them so tests cover the production path.

## §3. UNION-up-front

N/A.

## §4. §15

N/A.

## §5. Test plan

NEW co-located `apps/web/src/features/receptionist/pages/ReceptionistPage.test.ts` (5 tests, pure-logic):

- BS-1: happy path — `computeBulkResult({sentCount:5, failedCount:0}, 5)` → `{sent:5, failed:0}`; `bulkResultSeverity` → `'success'`.
- BS-2: server failure (PRE-FIX RED) — `computeBulkResultOnError(new Error('Network Error'), 5)` → `{sent:0, failed:5, message:'Failed to send reminders: Network Error'}`; severity `'error'`.
- BS-3: partial failure — `computeBulkResult({sentCount:3, failedCount:2}, 5)` → `{sent:3, failed:2}`; severity `'error'` (any failure = red, per anchor).
- BS-4: legacy server shape `{sent, failed}` (without `Count` suffix) — fallback path verified.
- BS-5: non-Error throw — `String(err)` branch verified.

Pre-fix RED: BS-2 fails (pre-fix returns `{sent:0, failed:0}` not `{sent:0, failed:5}`).

## §6. Fix-registry rows (4)

| Row ID | File | Mode | Pattern |
|---|---|---|---|
| `R-FIX-BUG-445-NO-FABRICATED-CAMPAIGN-CREATED` | `apps/web/src/features/receptionist/pages/ReceptionistPage.tsx` | absent | `Campaign created` |
| `R-FIX-BUG-445-NO-FABRICATED-IN-APP-MESSAGE` | `apps/web/src/features/receptionist/pages/ReceptionistPage.tsx` | absent | `Bulk reminders will be sent via in-app notifications` |
| `R-FIX-BUG-445-FAILED-COUNT-WHEN-CATCH-FIRES` | `apps/web/src/features/receptionist/pages/ReceptionistPage.tsx` | present | `failed: withPhone\.length` |
| `R-FIX-BUG-445-ERROR-SEVERITY-ON-FAILURE` | `apps/web/src/features/receptionist/pages/ReceptionistPage.tsx` | present | `severity=\{result\.failed > 0 \? 'error'` |

## §7. Files to modify

| File | Change |
|---|---|
| `apps/web/src/features/receptionist/pages/ReceptionistPage.tsx` | Catch + Alert fix; helper extraction |
| `apps/web/src/features/receptionist/pages/ReceptionistPage.test.ts` | NEW (5 tests) |
| `docs/quality/fix-registry.md` | 4 anchor rows |
| `docs/quality/bugs-remaining.md` | Atomic flip BUG-445 + file BUG-518/519/520 follow-ups |

## §8. PART 2 §H/§I trigger

- **L4** (clinical-safety): FIRES — flagged P0; patient-safety class.
- **L5** (architecture): touches fix-registry; FIRES.
- **L3**: unconditional.

## §9. Risks + follow-ups

- **BUG-518** (S1): backend `/bulk-reminder` route missing; feature dead. Fix shape: mount the route OR disable button behind feature flag.
- **BUG-519** (S2): silent `.catch(() => [])` fallbacks at lines 67/122/137/218/222/261/271/449/515 in same file (appointments + 8 other GETs).
- **BUG-520** (S1): sibling fabrication sites enumerated in `findings-6a-silent-catch.md:43-47` (PatientsPage:510, SummaryTab:1906, VivaTab:643+652, BedBoardPage:257). Roll-up if not already filed.

## §10. Acceptance

4 fix-registry pass; 5 unit tests ×3 GREEN; tsc + lint clean; L1+L2+L3+L4 PASS; atomic flip + BUG-518/519/520 follow-ups filed.

Per PART 6.1: no shortcut, no abstraction wrapper, root-cause failure-honest UI, no scope creep.
