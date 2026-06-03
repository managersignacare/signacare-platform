# SPIKE — USER-E generate letter from a saved note

**Status:** design complete; minimum implementation is ~2 commits, most of the feature is ALREADY BUILT.
**Owner:** Wave A-5-USER Sub-cluster E.

## Current state (verified)

- Backend endpoint exists: `POST /api/v1/correspondence/generate-from-note` at `apps/api/src/features/correspondence/correspondenceRoutes.ts:36` — **gated behind feature flag `ai-letter`**. Service: `correspondenceService.generateLetterDraftsFromNote`. Controller: `correspondenceController.generateFromNote`.
- Frontend component exists: `apps/web/src/features/correspondence/components/GenerateLetterFromNoteButton.tsx` — a "From Note" button that opens a dialog listing the patient's notes and calls `onNoteContentLoaded(note.content)` on selection. NO feature-flag gate, NO AI call — just a note-picker.
- LetterComposer at `apps/web/src/features/correspondence/components/LetterComposer.tsx:88` already renders the button.

## User's actual complaint

"No ability to generate letters from saved notes" means the user couldn't DISCOVER the feature. It's behind the wrong UX path — today they must:
1. Navigate to `/correspondence`
2. Open the LetterComposer
3. Click "From Note"
4. Pick a note from the dialog

The expected flow is the reverse — they have a signed note open in the clinical-notes panel and want to generate a letter FROM that specific note.

## Fix (minimum shippable, 2 commits)

### E.1 — "Generate Letter" button on the note panel (1 commit)

Add a secondary action in `ClinicalNotesPanel.tsx` — visible when `selected` is set and `mode === 'view'`. Clicking navigates to `/correspondence?fromNoteId=<id>&patientId=<patientId>` (or `?episodeId=...` if present).

```tsx
{selected && mode === 'view' && (
  <Button
    size="small" variant="outlined" startIcon={<MailOutlineIcon />}
    onClick={() => navigate(`/correspondence?fromNoteId=${selected.id}&patientId=${patientId}`)}
  >
    Generate Letter
  </Button>
)}
```

No backend change.

### E.2 — CorrespondencePage reads query params and prefills LetterComposer (1 commit)

`apps/web/src/features/correspondence/pages/CorrespondencePage.tsx` reads `fromNoteId` + `patientId` from `useSearchParams`. If set, it auto-opens the LetterComposer AND passes the note content so the composer body is pre-populated. Hook: `useQuery` for that one note by id, populate LetterComposer's initial value.

No backend change. Reuses existing `apiClient.get('clinical-notes/:id')`.

## Why the existing button remains

Users navigating directly to `/correspondence` still benefit from the existing "From Note" picker (lets them pick any note). We're adding a second entry path (note → letter), not replacing the existing one.

## Tests

- E.1: component test — button renders only when `selected && mode === 'view'`.
- E.2: route test — `fromNoteId` query param auto-opens composer with note content.
- E2E: open a note → click Generate Letter → composer opens pre-filled (1 Playwright test).

## BUG-173 AI-DRAFT banner follow-up

Per PART 8.1 of the master plan, BUG-173 ghost-ID is the extension of the AI-DRAFT banner to the letters composer. Currently the banner lives at `apps/web/src/features/clinical-notes/components/ClinicalNotesPanel.tsx:321-339` for clinical notes. The `generate-from-note` path produces AI-drafted letters via `generateLetterDraftsFromNote` — these should also render the AI-DRAFT banner until signed. Out of USER-E.1/E.2 scope but linked.

## Fix-registry anchors (when shipped)

- `R-FIX-NOTE-GENERATE-LETTER-BUTTON`
- `R-FIX-CORRESPONDENCE-QUERYPARAM-PREFILL`

## Why spike-only rather than ship-now

This one IS small enough to ship in the current session:
- E.1: ~10 LOC in ClinicalNotesPanel.tsx
- E.2: ~30 LOC in CorrespondencePage.tsx

If session budget allows, flip this spike to a shipped commit. If not, these 2 commits are the complete scope for a follow-up session.
