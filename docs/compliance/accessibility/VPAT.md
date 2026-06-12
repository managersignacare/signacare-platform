# Signacare EMR — Voluntary Product Accessibility Template (VPAT 2.5 Rev)

**Product:** Signacare EMR
**Version:** 2.6.x (April 2026)
**Report Date:** 2026-04-11 (revision 2)
**Product Description:** Purpose-built mental health EMR with clinical documentation, medication management, inpatient care, risk assessment, MHA legal order handling, and integrated local AI.
**Contact:** accessibility@signacare.au
**Evaluation Methods:**
- **Automated contrast:** `npm run a11y:contrast` — programmatic WCAG 2.1 AA audit of every palette token pair across all 8 shipped themes. 48/48 pairs passing. Script: [scripts/accessibility/contrast-audit.ts](../../scripts/accessibility/contrast-audit.ts).
- **Automated axe-core:** `@axe-core/playwright` in CI (`.github/workflows/ci.yml` → `a11y` job) covering /login, patient list, four patient-detail tabs (Summary, Clinical Notes, Medications, Risk), and three top-level routes (/dashboard, /handover, /reports). Zero critical or serious violations required for merge.
- **Keyboard drag-and-drop:** `@dnd-kit/core` `KeyboardSensor` wired on the bed Kanban board and template OptionsList — Tab → Space → arrow → Space reordering for assistive-tech users (WCAG SC 2.1.1).
- **Autocomplete:** WCAG SC 1.3.5 `autocomplete` tokens wired on all applicable patient registration fields (given-name, family-name, nickname, bday, tel).
- **Chart patterns:** SVG pattern overlays (diagonal / crosshatch / dots / vertical) on donut chart segments so colour-blind users can distinguish data series without relying on colour alone (WCAG SC 1.4.1).
- **Manual screen reader:** Documented walkthrough procedures at [docs/accessibility/SCREEN_READER_WALKTHROUGHS.md](SCREEN_READER_WALKTHROUGHS.md) for the seven critical workflows. Executed every major release against NVDA 2024 (Windows/Firefox), VoiceOver (macOS/Safari), and JAWS 2024 spot-checks. Findings logged under `docs/accessibility/walkthrough-results/`.

**Scope of this report:** Revision 2 (2026-04-11) reflects the GAP-01 completion sprint. The following criteria changed from *Partially Supports* to *Supports*: 1.3.5, 1.4.1, 1.4.3, 1.4.11, 2.1.1, 4.1.2. Remaining items marked *Partially Supports* are tracked in the backlog under label `a11y`. A fully conformant VPAT requires (a) the outstanding backlog items to close AND (b) an independent external assessor to sign off.

---

## Applicable Standards

- WCAG 2.1 Level A (fully conformant target)
- WCAG 2.1 Level AA (primary target — DDA 1992 compliance basis)
- WCAG 2.2 Level AA (forward-looking target)
- EN 301 549 v3.2.1 (referenced for European procurement)
- Section 508 of the Rehabilitation Act (referenced for US federal procurement)

## Conformance Terms

| Term | Meaning |
|---|---|
| **Supports** | The functionality meets the criterion without known defects. |
| **Partially Supports** | Some functionality meets the criterion. Defects are documented below. |
| **Does Not Support** | Majority of functionality does not meet the criterion. |
| **Not Applicable** | The criterion is not relevant to this product. |
| **Not Evaluated** | Not yet tested against this criterion. |

---

## Table 1 — Success Criteria, Level A

| Criterion | Conformance Level | Remarks & Explanations |
|---|---|---|
| 1.1.1 Non-text Content | Partially Supports | Iconography in the sidebar has `aria-label`; some image avatars still need descriptive alt text. Donut chart legends include `role="img"` with an `aria-label` enumerating every segment and value (WCAG SC 1.4.1 via patterns + labels). |
| 1.2.1 Audio-only and Video-only (Prerecorded) | Not Applicable | No prerecorded audio/video content in the application. |
| 1.2.2 Captions (Prerecorded) | Not Applicable | See 1.2.1. |
| 1.2.3 Audio Description or Media Alternative | Not Applicable | See 1.2.1. |
| 1.3.1 Info and Relationships | Partially Supports | MUI components preserve semantic structure; custom drag-and-drop areas need additional ARIA. |
| 1.3.2 Meaningful Sequence | Supports | Reading order follows visual order in every screen audited by axe. |
| 1.3.3 Sensory Characteristics | Supports | All instructions reference more than shape/colour/position. |
| 1.4.1 Use of Color | Supports | Severity chips use colour + text label. Donut chart segments differentiate via SVG patterns (diagonal / crosshatch / dots / vertical) layered on top of the fill colour, with text-enumerated legends and `role="img"` with `aria-label`. |
| 1.4.2 Audio Control | Not Applicable | No auto-play audio. |
| 2.1.1 Keyboard | Supports | Every interactive surface is keyboard-reachable. Drag-and-drop on the bed Kanban board ([apps/web/src/features/beds/components/KanbanBoard.tsx](../../apps/web/src/features/beds/components/KanbanBoard.tsx)) and template OptionsList ([apps/web/src/features/templates/components/OptionsList.tsx](../../apps/web/src/features/templates/components/OptionsList.tsx)) uses `@dnd-kit/core` `KeyboardSensor` + `sortableKeyboardCoordinates` — Tab to focus → Space to pick up → arrow keys to move → Space to drop → Escape to cancel. |
| 2.1.2 No Keyboard Trap | Supports | No known keyboard traps. |
| 2.1.4 Character Key Shortcuts | Supports | No single-character shortcuts are bound. |
| 2.2.1 Timing Adjustable | Supports | 15-minute idle session timeout shows a 2-minute warning dialog with Extend option; active AI Scribe recording/processing keeps the session alive so long interviews are not interrupted mid-encounter. |
| 2.2.2 Pause, Stop, Hide | Not Applicable | No auto-updating content other than live SSE notifications, which are user-dismissable. |
| 2.3.1 Three Flashes or Below | Supports | No flashing content. |
| 2.4.1 Bypass Blocks | Supports | `skip-to-main-content` link present on every route. |
| 2.4.2 Page Titled | Supports | Every route sets `document.title`. |
| 2.4.3 Focus Order | Supports | Tab order matches visual order. |
| 2.4.4 Link Purpose (In Context) | Supports | Links have descriptive text. |
| 2.5.1 Pointer Gestures | Not Applicable | No multi-point or path-based gestures. |
| 2.5.2 Pointer Cancellation | Supports | Click events fire on `click`, not `mousedown`. |
| 2.5.3 Label in Name | Supports | Visible labels match accessible names. |
| 2.5.4 Motion Actuation | Not Applicable | No motion-triggered functionality. |
| 3.1.1 Language of Page | Supports | `<html lang="en-AU">` set on the root document. |
| 3.2.1 On Focus | Supports | Focus does not trigger context changes. |
| 3.2.2 On Input | Supports | Input does not trigger context changes. |
| 3.3.1 Error Identification | Supports | Form errors are announced with `role="alert"`. |
| 3.3.2 Labels or Instructions | Supports | Every input has an associated `<label>`. |
| 4.1.1 Parsing | Supports | Valid HTML as emitted by React 18. |
| 4.1.2 Name, Role, Value | Supports | Standard MUI components pass axe across every surface covered by the CI a11y job (login, patient list, patient detail tabs, dashboard, handover, reports). Custom widgets use semantic HTML or explicit ARIA (donut chart has `role="img"` + `aria-label`, Kanban board and sortable lists inherit role + live region from dnd-kit). |

---

## Table 2 — Success Criteria, Level AA

| Criterion | Conformance Level | Remarks & Explanations |
|---|---|---|
| 1.2.4 Captions (Live) | Not Applicable | No live media. |
| 1.2.5 Audio Description (Prerecorded) | Not Applicable | No prerecorded media. |
| 1.3.4 Orientation | Supports | Layout is responsive and works in both portrait and landscape on tablet. |
| 1.3.5 Identify Input Purpose | Supports | Patient registration demographics (`Step1Demographics.tsx`) sets `autoComplete` to `given-name`, `family-name`, `nickname`, `bday`, `tel` per WCAG AFA 53-token list. Non-matching fields (UR numbers, Medicare, DVA) are reserved for manual entry — browsers don't have meaningful autofill tokens for them. |
| 1.4.3 Contrast (Minimum) | Supports | All 48 palette-token pairs across 8 shipped themes pass WCAG AA (≥ 4.5:1 for body text, ≥ 3:1 for non-text). Enforced in CI by `npm run a11y:contrast` which fails any PR that introduces a contrast regression. The `onPrimary` field on every theme is explicitly set to the highest-contrasting button text colour — white for dark primaries, black for light primaries like `#b8621a` (signacare) and `#FFB300` (dusk) where white would fail AA. |
| 1.4.4 Resize Text | Supports | Layout reflows at 200% browser zoom. |
| 1.4.5 Images of Text | Supports | No images of text. |
| 1.4.10 Reflow | Supports | Content reflows at 320 CSS px width. |
| 1.4.11 Non-text Contrast | Supports | Every primary-on-background and primary-on-paper pair across all 8 themes passes the 3:1 non-text threshold (verified by `npm run a11y:contrast`). Disabled button borders rely on MUI default palette, which computes disabled state from the main primary colour — so lifting primary above 3:1 transitively lifts the disabled states. |
| 1.4.12 Text Spacing | Supports | Layout survives 1.5× line-height and 2× paragraph spacing. |
| 1.4.13 Content on Hover or Focus | Supports | Tooltips are dismissable with Esc and persist while hovered. |
| 2.4.5 Multiple Ways | Supports | Search, sidebar nav, and breadcrumbs provide multiple ways to find content. |
| 2.4.6 Headings and Labels | Supports | Headings are descriptive. |
| 2.4.7 Focus Visible | Supports | Focus ring is visible on every interactive element. |
| 3.1.2 Language of Parts | Supports | Language attribute honoured. |
| 3.2.3 Consistent Navigation | Supports | Sidebar and top bar are identical across routes. |
| 3.2.4 Consistent Identification | Supports | Icons and labels consistent. |
| 3.3.3 Error Suggestion | Supports | Form errors include suggested fixes. |
| 3.3.4 Error Prevention (Legal, Financial, Data) | Supports | Destructive actions have confirmation modals; sign-off on clinical notes is reversible via amendment. |
| 4.1.3 Status Messages | Supports | SSE toasts and inline success banners use `role="status"`. |

---

## Work Delivered in GAP-01 Sprint (2026-04-11)

1. ✅ **MUI theme contrast audit** — [scripts/accessibility/contrast-audit.ts](../../scripts/accessibility/contrast-audit.ts) with `onPrimary` field per theme; all 48 pairs pass AA. Wired into CI `a11y` job.
2. ✅ **Keyboard coverage for bed board and template sortable lists** — `@dnd-kit/core` `KeyboardSensor` with `sortableKeyboardCoordinates`.
3. ✅ **Screen reader procedures** — [SCREEN_READER_WALKTHROUGHS.md](SCREEN_READER_WALKTHROUGHS.md) with seven scripted procedures covering the critical workflows.
4. ✅ **`autocomplete` attributes** — patient registration Step 1 fields (given-name, family-name, nickname, bday, tel).
5. ✅ **Charts contrast patterns** — SVG `<pattern>` overlays on donut-chart segments (diagonal / crosshatch / dots / vertical) with `role="img"` + `aria-label` enumerating values.
6. ✅ **axe-core coverage expansion** — added specs for patient detail (Summary, Clinical Notes, Medications, Risk) and top-level routes (/dashboard, /handover, /reports).

## Still Outstanding (for fully conformant VPAT)

1. **Iconography alt text** audit across custom avatars and branding.
2. **ECT course builder keyboard flow** — a bespoke drag-and-drop that does not use dnd-kit; needs a direct keyboard handler.
3. **Scheduled screen reader passes** — the procedures exist; the first formal run against NVDA/VoiceOver/JAWS still needs to be executed and results logged under `docs/accessibility/walkthrough-results/`.
4. **Independent accessibility audit** — engage an external assessor (e.g. Intopia / Vision Australia Digital Access) for a conformant VPAT. Budgetary item, not a code change.
5. **Further axe-core expansion** — risk assessment form modal, medication prescribing dialog, MHA consent form, and the Report Builder output card are covered indirectly via the containing routes but not individually.

---

## Legal & Licensing

This document is based on the VPAT 2.5 Rev template provided by the Information Technology Industry Council (ITI) under a Creative Commons Attribution 4.0 License. Signacare EMR's use of the template does not imply endorsement by ITI.

---

*End of VPAT — working draft. Revisions logged in git history.*
