# Screen Reader Walkthrough Procedures

**Version:** 1.0 (2026-04-11)
**Purpose:** Scripted, repeatable test procedures for screen reader verification of the seven critical clinical workflows in Signacare EMR. These procedures complement the automated axe-core checks in CI ([e2e/accessibility/](../../e2e/accessibility/)) — machine checks can't validate announcement order, focus trapping, or semantic clarity for a blind user. Only a human with a screen reader can.
**Cadence:** Every major release (x.y.0), or any time a workflow in the list below changes materially. Results are logged in `docs/accessibility/walkthrough-results/<YYYY-MM-DD>-<tester>.md`.

## Assistive Technology Matrix

| AT | Platform | Browser | Priority |
|---|---|---|---|
| **NVDA 2024.x** | Windows 11 | Firefox 120+ | P0 — free, most common AT for Windows users |
| **VoiceOver** | macOS 14+ | Safari 17+ | P0 — default on macOS, used by clinicians on Macs |
| **JAWS 2024** | Windows 11 | Chrome 120+ | P1 — paid but still prevalent in enterprise |
| **TalkBack** | Android 14 | Chrome | P2 — mobile patient app only |
| **VoiceOver iOS** | iOS 17+ | Safari | P2 — mobile patient app only |

A walkthrough is "passed" only when all three P0 combinations succeed without a blocker. A finding at any severity is logged; P1/P2 failures are ticketed but don't block a release unless severity is Critical.

## Severity Classification

| Severity | Definition | Example | Release Impact |
|---|---|---|---|
| **Critical** | The user cannot complete the workflow at all | Submit button has no accessible name so the user can't find it | Blocks release |
| **Major** | The user completes the workflow but misses clinically relevant information | A risk flag is rendered as colour only with no text alternative | Blocks release |
| **Minor** | Awkward but the user completes the workflow | Tab order hits the legend before the chart | Tickets for next sprint |
| **Cosmetic** | Only affects polish | Extra verbose aria-label repeats the label | Backlog |

---

## Walkthrough 1 — Login + MFA

**Goal:** Authenticate into the EMR using only a keyboard and screen reader.
**Roles:** Any.
**Expected time:** 3 minutes.

### Steps

1. Launch the AT, open the browser, navigate to the EMR login URL.
2. Tab to the email input. **Expect:** announcement like *"Email address, edit, blank"*.
3. Type the test account email.
4. Tab to the password input. **Expect:** *"Password, edit protected, blank"*.
5. Type the password.
6. Tab to the Sign In button. **Expect:** *"Sign in, button"*.
7. Press Enter.
8. **If TOTP is enabled:** Tab to the code input. **Expect:** *"Authentication code, edit"*.
9. Type the 6-digit code and press Enter.
10. Expect landing announcement: the dashboard heading should be read automatically or reachable on first Tab.

### Acceptance criteria

- Every form field has an accessible name that matches its visible label.
- The Sign In button is reachable within 4 Tab presses from the email field.
- On authentication failure, the error message is announced via `role="alert"` within 200 ms of appearing.
- Focus lands on the main content area (not on `<body>`) after successful login.

### Known limitations

- WebAuthn hardware-key flow is covered separately in Walkthrough 7.

---

## Walkthrough 2 — Patient Search + Open Chart

**Goal:** Find a specific patient and open their chart.
**Roles:** Clinician, Nursing, Case Manager, Receptionist.
**Expected time:** 2 minutes.

### Steps

1. From the dashboard, navigate to Patients via the sidebar. **Expect:** *"Patients, link"*.
2. Press Enter.
3. Focus should land on the patient search input. **Expect:** *"Search patients by name or MRN, edit"*.
4. Type a partial patient name.
5. The list should update; the count of visible results should be announced via a `role="status"` live region.
6. Tab to the first result row. **Expect:** *"(patient name), (MRN), button"* or the AT announces it as a table row with rowindex.
7. Press Enter.
8. The chart opens. **Expect:** the patient's name is read as an h1 or h2.

### Acceptance criteria

- Search results update is announced (not silent).
- Each patient row has an accessible name that includes name + MRN.
- The chart open transition moves focus to the patient name heading, not an arbitrary element.

---

## Walkthrough 3 — Write and Sign a Clinical Note

**Goal:** Create a progress note and sign it.
**Roles:** Clinician.
**Expected time:** 5 minutes.

### Steps

1. From the patient chart, Tab to the Clinical Notes tab. Press Enter.
2. Tab to the "New Note" button. **Expect:** *"New note, button"*. Press Enter.
3. A dialog opens. **Expect:** the dialog is announced as *"New clinical note, dialog"*. Focus should move into the dialog and be trapped.
4. Tab through: Note type (combobox) → Template (combobox) → Content (textarea).
5. Fill the fields. For the content textarea, confirm arrow keys move by character and Option+arrow (macOS) / Ctrl+arrow (Windows) move by word.
6. Tab to Save Draft. Press Enter.
7. Expect a toast: *"Note saved as draft"* via `role="status"`.
8. Tab to the Sign button. **Expect:** *"Sign and lock this note, button"*.
9. Press Enter.
10. A confirmation dialog appears. **Expect:** *"Sign note — this action cannot be undone, dialog"*.
11. Confirm.
12. Focus returns to the notes list; the newly-signed note is the first row. **Expect:** the row includes "Signed" in its accessible name.

### Acceptance criteria

- Dialog focus trap works: Tab cycles within the dialog only; Escape closes it and returns focus to the trigger.
- Toast notifications are announced by the screen reader.
- Signed notes are distinguishable in the list by text, not just an icon or colour.

---

## Walkthrough 4 — Prescribe a Medication

**Goal:** Add a new prescription to an active episode.
**Roles:** Clinician with `prescriber_number`.
**Expected time:** 5 minutes.

### Steps

1. From the patient chart, Tab to the Medications tab. Press Enter.
2. If the prescriber is not gated, Tab to "Prescribe". **Expect:** *"Prescribe medication, button"*.
3. Press Enter. A dialog opens (focus trapped).
4. Tab to the drug search combobox. **Expect:** *"Medication, combobox, expanded"* or similar.
5. Type a medication name. **Expect:** live region announces the number of matching options.
6. Arrow down to an option. **Expect:** the full option name is read on each move.
7. Press Enter.
8. Tab through dose, frequency, route, duration, quantity, repeats.
9. **Critical:** if there is an allergy or interaction warning, it MUST be announced before Save is reachable. An alert dialog with `role="alertdialog"` is acceptable.
10. Tab to Save. Press Enter.
11. Focus returns to the medications list with the new prescription as the first row.

### Acceptance criteria

- Combobox is labelled and follows ARIA 1.2 combobox pattern.
- Drug-interaction warnings are announced via `role="alertdialog"` or `role="alert"`, not silently rendered.
- Prescriber gating: non-prescribers never see the Prescribe button at all (verify with a clinician account without `prescriber_number`).

---

## Walkthrough 5 — Record a Risk Assessment + Safety Plan

**Goal:** Complete a risk assessment and author a safety plan.
**Roles:** Clinician, Nursing.
**Expected time:** 10 minutes.

### Steps

1. From the patient chart, Tab to the Risk tab. Press Enter.
2. Tab to "New Risk Assessment". Press Enter.
3. Each form section is rendered as a fieldset with a legend. **Expect:** each legend announces on first entry to the group.
4. Fill every required field using keyboard only. Likert scale radio groups: arrow keys move between options, Space selects.
5. Submit. Expect summary screen.
6. Tab to "Create Safety Plan". Press Enter.
7. Fill the warning signs, coping strategies, and support contacts sections.
8. Save.
9. On return to the Risk tab, the assessment and safety plan are listed with date, author, and severity as text.

### Acceptance criteria

- Likert scales are announced as radio groups with a position ("1 of 5", "2 of 5"...).
- Severity (Low / Medium / High) is announced as text, not implied by colour.
- Required field errors are announced before Save can be re-triggered.

---

## Walkthrough 6 — Shift Handover

**Goal:** Complete the end-of-shift handover for a patient cohort.
**Roles:** Nursing.
**Expected time:** 5 minutes.

### Steps

1. From the sidebar, navigate to Handover.
2. The page lists patients assigned to the outgoing shift. Tab through the list.
3. For a selected patient, Tab to "Add handover note". Press Enter.
4. Fill the ISBAR fields (Situation, Background, Assessment, Recommendation). Each field should announce its own label and any helper text.
5. Save.
6. Tab to "Generate AI summary". Press Enter. A loading announcement should be audible ("Generating summary, please wait" via `role="status"`).
7. When the summary arrives, focus should move to the summary region or the region should be announced via `aria-live="polite"`.
8. Review, edit, sign.

### Acceptance criteria

- AI loading state is announced (not silent).
- AI output is announced via live region or explicit focus move — not discoverable only via scrolling.
- Sign button is not enabled until the summary has been reviewed (visible state should also be reflected in `aria-disabled`).

---

## Walkthrough 7 — Break-Glass Emergency Access

**Goal:** Request and use emergency break-glass access.
**Roles:** Clinician (requester), Admin/Superadmin (approver).
**Expected time:** 5 minutes.

### Steps

**Requester:**
1. From the sidebar or account menu, navigate to "Request emergency access".
2. Fill email, password, TOTP code, and reason (≥10 characters).
3. Submit. Expect confirmation: *"Break-glass request submitted, awaiting approval."*

**Approver (on a second device / second screen reader session):**
4. A notification announces the pending request (or the approver navigates to the admin break-glass queue).
5. Tab to the request row → Approve. Press Enter.
6. Confirmation dialog appears. Confirm.
7. The approver is told the token has been issued and its expiry time.

**Requester (resumes):**
8. The pending-request page updates to show the elevated session (via live region).
9. Every subsequent action is labelled with a persistent "Emergency access active" banner that the screen reader announces on every route change.
10. The expires-in countdown is announced via a live region on each minute mark.

### Acceptance criteria

- The emergency access banner is announced on every route (per WCAG 3.2.3 Consistent Navigation).
- Two-person rule is respected: the requester cannot self-approve.
- Session expiry is announced in the 5 minutes before TTL expires.
- Password and MFA fields are `type=password` so screen readers don't echo characters.

---

## How to Record a Finding

Each finding is a file in `docs/accessibility/walkthrough-results/<YYYY-MM-DD>-<tester>.md` with this template:

```markdown
# Walkthrough Results — <date> — <tester initials>

**AT:** NVDA 2024.4 / VoiceOver 14 / JAWS 2024
**Browser:** <name + version>
**Build:** <git SHA>

## Walkthrough 1 — Login + MFA
- Severity: Minor
- Step: 7
- What I heard: "Button" (no accessible name)
- What I expected: "Sign in, button"
- Fix suggestion: add aria-label to the submit button in LoginPage.tsx
- Ticket: A11Y-123
```

One file per tester per session. Keep the files for 2 years so we can see accessibility quality over time.

---

## Exit Criteria for a Conformant VPAT

The VPAT at `docs/accessibility/VPAT.md` cannot claim full WCAG 2.1 AA conformance until:

1. All seven walkthroughs pass P0 (NVDA + VoiceOver) with **zero Critical and zero Major findings**.
2. At least one JAWS session (P1) has been completed in the most recent quarter.
3. The automated axe-core job in CI has been green for 30 consecutive days across the covered surfaces.
4. An independent external assessor (e.g. Intopia, Vision Australia Digital Access) has signed off on the VPAT.

Items 1–3 are a responsibility of the internal accessibility-lead rotation. Item 4 is a paid engagement and must be scheduled at least eight weeks before any tender that references WCAG conformance.

---

*End of screen reader walkthrough procedures.*
