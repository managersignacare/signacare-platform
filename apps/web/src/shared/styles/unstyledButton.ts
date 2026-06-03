// apps/web/src/shared/styles/unstyledButton.ts
//
// Shared sx-mixin that neutralises the user-agent default styles of a
// native <button> element so a `<Box component="button">` visually
// renders like a non-interactive Box while remaining keyboard-
// accessible (Enter/Space activation, focus ring, screen-reader
// recognised as a button).
//
// Used by the canonical Shape B′ inner trigger documented in
// `docs/quality/bug-447-child-template.md §2.4` ("sub-region trigger
// + sibling actions"). Consumers spread it into their `sx` prop and
// then layer their own visual styles + `:focus-visible` outline on
// top.
//
// Extracted on the 3rd recurrence of the 8-prop block per
// `BUG-447-FOLLOWUP-UNSTYLED-BUTTON-MIXIN` (S2 cascade filed by
// BUG-447-pathology L5 advisory). Prior occurrences:
//   1. BUG-447-pathology PathologyTab dropzone (child 7/15).
//   2. BUG-447-FOLLOWUP-SHAPE-B-PRIME-DOC CorrespondenceTab letter
//      Card migration (post-cycle 6/15).
//   3. BUG-447-episodes EpisodeCard left summary (child 9/15) — this
//      cycle. Triggers the SSoT extraction.
//
// Example:
//
//   <Box
//     component="button"
//     type="button"
//     onClick={...}
//     aria-label="..."
//     sx={{ flex: 1, ...unstyledButtonSx, '&:focus-visible': { outline: '2px solid #b8621a', outlineOffset: 2 } }}
//   >
//     {/* content */}
//   </Box>

export const unstyledButtonSx = {
  p: 0,
  m: 0,
  border: 0,
  background: 'transparent',
  cursor: 'pointer',
  font: 'inherit',
  textAlign: 'left' as const,
  color: 'inherit',
};
