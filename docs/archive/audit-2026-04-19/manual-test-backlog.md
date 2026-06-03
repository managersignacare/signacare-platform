# Manual Test Backlog — human-only validation scenarios

**Scope:** tests that CAN'T be automated (subjective UX, complex multi-step workflows, perception of clinical safety) OR that require richer seed data than current fixtures provide.

The automated probes (route-crawler, save-round-trip, button-smoke, chaos, etc.) cover the mechanical signals. This doc lists the remaining human-only tests.

**Owner:** whoever is running the manual validation session. Mark each item as `done` / `pass` / `fail` with findings inline.

---

## Per-persona flows

### Persona A — Clinician (sarah.chen@signacare.local)

**Goals:** day-in-the-life — manage caseload, see 3-4 patients, document notes, prescribe.

1. `☐` Log in → land on dashboard → **does the dashboard show the widgets a clinician actually uses** (today's appointments, unread messages, overdue tasks, risk alerts)? Any widget empty or showing stale data is a bug.
2. `☐` Open patient list → filter to "my caseload" → pick one patient → verify the patient card shows clinician + team + key worker correctly (BUG-002 regression check).
3. `☐` On that patient's detail page, walk every tab in order: Overview → Episodes → Medications → Clinical Notes → Risk → Pathology → Correspondence → Alerts & Plans → Physical Health → Documents → Viva → Outcomes → Lived Experience → 91-Day Review → TMS → ECT → Clozapine → Inpatient Care → Allergies → Legal → Referrals → Summary. Note any tab that crashes, shows "undefined", shows raw JSON, or takes >5s to load.
4. `☐` Edit the patient in Overview → change 3 fields (preferred name, phone, email) → save. Does the save succeed visually? After page refresh, do the fields persist? (BUG-003 regression check.)
5. `☐` Open the active episode → click "Edit MDT" on the banner → change primary clinician + add a member → save → close dialog → re-open. Do the changes persist? (Bug 4 check.)
6. `☐` Medications tab → prescribe a new medication → fill dose / frequency / indication → Submit. Double-click Submit fast. Do you get 1 row or 2? (Double-submit race check.)
7. `☐` Clinical Notes → add a new note → fill content → Save Draft. Close, re-open, verify draft persists → Sign. After signing, attempt to edit — is the Edit button disabled? (CLAUDE.md §1 sign-immutability check.)
8. `☐` Assessments / Outcomes → select a rating scale from the dropdown. Is the dropdown populated with BPRS, HAM-D, MADRS, PANSS, Y-BOCS etc.? (BUG-013 check.)
9. `☐` Physical Health tab → record BP + weight + heart rate → Save. Does the row appear in history without a manual refresh? (Bug 6 invalidation check.)
10. `☐` Alerts & Plans → Recovery Star → pick a score → Save. Does the score appear in the history chart? (Bug 5 check.)
11. `☐` Correspondence → click Letters chip. Are only letters visible (no messages)? Are top-level "Send SMS" / "Compose Letter" buttons GONE? (Bug 9 check.)
12. `☐` Try to log out via the sidebar sign-out button. Does it redirect to login? Try to access a patient URL after logout — redirected back to login?

### Persona B — Admin (tom.obrien@signacare.local)

**Goals:** administrative surfaces — power settings, staff, reports, audit log.

13. `☐` Log in → verify sidebar shows admin-only items (Reports, Audit Log, Power Settings, Org Settings, Staff Assignments).
14. `☐` Open **Power Settings** — does every sub-section load? Are clinic branding, module toggles, scribe consent mode reachable?
15. `☐` Open **Audit Log** — search for recent login events. Results render? Pagination works? Filters respect date range?
16. `☐` Open **Reports** → run one of the standard reports (occupancy, episode outcomes, appointment DNA). Does it render? Download as CSV?
17. `☐` Attempt to navigate to `/clozapine`, `/lai`, `/clinical-notes`, `/risk` — all should render (admin has universal access).
18. `☐` Attempt to impersonate a clinician — is the action visible anywhere? (If not, BUG-026: admin impersonation has no frontend.) Test via API `POST /api/v1/admin/impersonate/:staffId` directly if in dev mode.

### Persona C — Superadmin (admin@signacare.local)

**Goals:** vendor-level surfaces — model registry, training platform, canary deploys.

19. `☐` Log in → verify `/admin/training/*` endpoints are reachable. Is there a UI page for them? (If not, BUG-026 for training platform.)
20. `☐` Attempt the 4-eyes approval flow on a destructive action (e.g. delete staff). Does the superadminGuard middleware actually present the approval request?

### Persona D — Nurse (role clinician, but nursing discipline)

Currently `e2e/fixtures/auth.ts` only seeds 2 clinicians + 2 admins. Nurse / psychologist / receptionist roles not seeded. **Blocker:** extend seed-e2e-fixtures.ts further if you want per-role persona tests.

---

## Deep-link + navigation edge cases

21. `☐` Paste `/patients/<id>?tab=medications` directly into the URL bar. Does the medications tab open (not overview)?
22. `☐` On a patient detail tab, press browser back — does it navigate to the previous tab OR to the patient list? Unexpected behaviour is a UX bug.
23. `☐` Open an edit dialog, fill 3 fields, press F5. Expected: a "you have unsaved changes" prompt. If the dialog closes silently and data is lost = BUG.
24. `☐` Log in → wait past the session idle timeout (configured at `SESSION_IDLE_MINUTES`, usually 30min; you can simulate by clearing cookies mid-session). Try to save something. Expected: clean redirect to login. Actual?
25. `☐` Open 2 tabs of the same patient. Edit a field in tab 1 → save. Refresh tab 2. Does the value propagate? (Concurrency UX check.)

## Validation edge cases

For every form, try:

26. `☐` Empty a required field → submit. Clear error message + field highlighted?
27. `☐` Paste 5000 characters into a short text field → submit. Client-side length limit enforced?
28. `☐` Enter `<script>alert(1)</script>` as a name → save → view the record. XSS not executed? Input displayed literal or escaped?
29. `☐` Enter `'; DROP TABLE patients; --` as a search term. Backend returns empty result (not 500)?
30. `☐` Enter emoji 👨‍⚕️ in a name field → save → reload. Emoji preserved?
31. `☐` Enter a date like `2028-02-29` (leap-year) → save. Valid?
32. `☐` Enter a date like `2026-10-03` (Australia DST day) → save. Does the rendered time respect the user's timezone?
33. `☐` Enter a negative number for "sessions completed" → validation error?
34. `☐` Enter whitespace only in a name field → validation error?

## Subjective UX

35. `☐` Walking through the patient-creation wizard — is the step order logical? Any step that asks for info before context is established?
36. `☐` The global search bar (if present) — what happens when you type 2 letters? 20? Debounced or not?
37. `☐` Toast notifications — when a save succeeds, does the toast appear top-right for 3s with "Saved" text? When it fails, does the error toast appear with the actual error (not "Error")?
38. `☐` Keyboard-only navigation — can a power user Tab through a form without the mouse? Is focus visible at every step?
39. `☐` Colour-blind review — the clinical-severity chips (red/amber/green) — can a colour-blind user distinguish them? (Use a colour-blind simulator.)
40. `☐` Dark mode, if present — does the entire UI respect dark mode, or do certain surfaces break?

## RBAC visibility

41. `☐` Log in as clinician. Are admin-only items (Reports, Audit Log, Power Settings) HIDDEN from the sidebar — not just gated on click?
42. `☐` As clinician, paste `/audit` into the URL. Expected: redirect or 403 fallback. Actual?
43. `☐` As clinician, paste `/admin/training` (backend-only per BUG-026). Expected: 404 or redirect. Any leak = S0 bug.

## Accessibility (manual, complements axe)

44. `☐` Load the login page with VoiceOver or NVDA on. Listen to how the page is announced. Is the form's purpose clear? Are errors announced?
45. `☐` Complete the patient-create wizard with keyboard only. Is focus trapped in the dialog? Does Escape close it? After closing, does focus return to the button that opened it?
46. `☐` Colour contrast check on the clinical status chips (e.g. "Active", "Discharged", "Waitlisted") — do they pass WCAG AA (4.5:1) at text size?
47. `☐` Screen reader: announce the Dashboard widgets in order. Are they announced with meaningful labels or as "Widget 1, Widget 2"?

## Clinical-safety-specific

48. `☐` Attempt to prescribe a medication with a known interaction (e.g. warfarin + NSAID). Does the interaction-check dialog appear? Is the warning dismissable only with an explicit reason?
49. `☐` Set a patient's risk to "high" → does the alert reach the treating team's inbox/task-list within 60 seconds?
50. `☐` Attempt to discharge a patient with an active MHA order. Does the system block with a clear error, or silently discharge (S0 bug)?

---

## How to record findings

For each `☐` above, after testing:
- `✓ pass` — behaviour matches expectation.
- `✗ fail — <short description>` — behaviour is wrong. ALSO file a new BUG-NNN in `bug-catalogue.md` with the same description, with YOU as the discovery-method.
- `⚠ partial — <short description>` — works but has UX issue.

---

## Personas still to seed

These 3 roles are not currently in `seed-e2e-fixtures.ts`; extend the fixtures file to cover them for a fuller persona matrix:
- nurse (role: `clinician`, discipline: `Nursing`)
- psychologist (role: `clinician`, discipline: `Psychology`)
- receptionist (role: `receptionist`)

All three would unblock items 13+ on this list.

---

## Timing guidance

This backlog is ~50 manual checks. At ~5 min/check that's ~4 hours of focused testing. Split across a full-suite tester + 2 personas each = ~1.5 hrs per tester over 3 tester-sessions.
