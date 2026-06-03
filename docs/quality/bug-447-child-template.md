# BUG-447 child-commit template

Canonical pattern for the BUG-447 children. Built and tightened from
the lessons of children 1/15..7/15 (BUG-447-medications `505285a`,
BUG-447-patient-detail-shell `86e37fa`, BUG-447-clinical-tabs-mha-legal
`2205763`, BUG-447-ect-tms `e6ea4ab`, BUG-447-clinical-notes-scribe
`a344b23`, BUG-447-correspondence-letters `745e288`, BUG-447-pathology
`568125c`). Each subsequent child should follow this shape so the
campaign progresses uniformly and reviewer overhead stays bounded.

**Status**: Shape B′ added 2026-04-28 (child 7/15 L5 advisory; previously
filed as `BUG-447-FOLLOWUP-SHAPE-B-PRIME-DOC`). Shape D codification is
intentionally deferred per YAGNI — child 5/15 NotesList is the sole
occurrence so far; codify when a second case appears.

## 1. Discovery

Run the rule against the target file with the file removed from the
allowlist (sanity check that the rule currently fires):

```bash
# Temporarily remove target from allowlist
grep -v <TARGET_PATH> .github/no-onclick-on-mui-container.allowlist > /tmp/al.tmp
mv /tmp/al.tmp .github/no-onclick-on-mui-container.allowlist
# Run rule
npx eslint --no-error-on-unmatched-pattern <TARGET_PATH>
```

Note the line numbers + element types (Box / Paper / Card / Typography)
that fire. **Restore the allowlist immediately after discovery** (do
NOT proceed with an empty entry until the fix is staged) — a transient
empty allowlist line in the working tree is fine; what matters is the
post-fix commit-time state.

## 2. Four canonical fix shapes

Every BUG-447 violation falls into one of four shapes. Pick the right
one per site using the decision tree at §2.5; do not over-engineer.

### Shape A — split into decorative + interactive branches

Use when the click target has a STATEFUL "decorative" mode (e.g. an
already-recorded MAR cell; a disabled status indicator). Decorative
branch is non-interactive (no onClick / role / tabIndex) with an
`aria-label` describing the state. Interactive branch carries the full
WCAG 2.1.1 trio.

Example (BUG-447-medications, MedicationsTab.tsx:3217–3253):

```jsx
// Shared styles — extract to `cellSx` const inside the .map() body
// so net-zero LOC growth (within +50 grace ceiling).
const cellSx = { /* shared visual styles */ };
const fireAdminDialog = () => setAdminDialog({ /* ... */ });

return (
  <Tooltip title={admin ? '...' : 'Click to record'}>
    {admin ? (
      // Decorative — non-interactive
      <Box aria-label={`Recorded ... at ${t}`} sx={{ ...cellSx, cursor: 'default' }}>
        {cfg?.icon}
      </Box>
    ) : (
      // Interactive — keyboard-operable
      <Box
        role="button"
        tabIndex={0}
        aria-label={`Record administration for ${row.name} ${row.dose} at ${t}`}
        onClick={fireAdminDialog}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fireAdminDialog(); } }}
        sx={{ ...cellSx, cursor: 'pointer', '&:hover': {/* ... */}, '&:focus-visible': {/* outline */} }}
      >
        {cfg?.icon}
      </Box>
    )}
  </Tooltip>
);
```

### Shape B — always-interactive trio

Use when the click target is ALWAYS interactive (e.g. a tab in a
side-nav; a clickable banner; a card-as-button). Just add the trio
inline. No branching.

Example (BUG-447-patient-detail-shell, PatientDetailLayout.tsx:357–377):

```jsx
const activate = () => setActiveTab(tid);
return (
  <Box
    key={tid}
    role="button"
    tabIndex={0}
    aria-current={isActive ? 'page' : undefined}
    aria-label={`Open ${tab.label} tab`}
    onClick={activate}
    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } }}
    sx={{ /* ... */, '&:focus-visible': { outline: '2px solid #2563EB', outlineOffset: -2 } }}
  >
    {tab.label}
  </Box>
);
```

### Shape C — refactor to MUI native primitive

Use when the violation reproduces a pattern MUI already provides with
built-in keyboard accessibility (`<Menu>`, `<MenuItem>`, `<Button>`,
`<IconButton>`, `<Tabs>`, `<Tab>`, `<Backdrop>`). Replacing the custom
`<Box>` popup with the MUI primitive is the gold-standard fix:
keyboard-accessibility comes for free, fewer LOC, lower future-
contributor burden.

Example (BUG-447-patient-detail-shell, PatientDetailLayout.tsx:296–319 —
custom Box-based quick-menu replaced with MUI `<Menu>` + `<MenuItem>`):

```jsx
// BEFORE: 3 violations — custom Box popup container, Box menu items,
// Box click-outside backdrop.
<Box sx={{ position: 'fixed', ... }} onClick={() => setQuickMenuAnchor(null)}>
  {items.map(a => <Box onClick={() => { setActiveTab(a.tab); setQuickMenuAnchor(null); }}>{a.label}</Box>)}
</Box>
<Box sx={{ position: 'fixed', inset: 0 }} onClick={() => setQuickMenuAnchor(null)} />

// AFTER: 0 violations + native keyboard support (Esc to close, Tab
// between items, Enter/Space to activate, click-away to close).
<Menu anchorEl={quickMenuAnchor} open={Boolean(quickMenuAnchor)} onClose={() => setQuickMenuAnchor(null)}>
  {items.map(a => <MenuItem onClick={() => { setActiveTab(a.tab); setQuickMenuAnchor(null); }}>{a.label}</MenuItem>)}
</Menu>
```

Always prefer Shape C when an MUI primitive matches the semantic.

### Shape B′ — sub-region trigger + sibling actions

Use when a Card / Box has nested keyboard-accessible primitives
(`<IconButton>`, `<Button>`, `<MenuItem>`, `<Chip onClick>`) AND the
container's onClick is semantically distinct from the inner action
(i.e. Shape D redundant-handler removal does NOT apply). Shape B
(whole-container trio) would create the WAI-ARIA 1.2 §5.2.7 "button-
inside-button" anti-pattern (interactive element inside an interactive
element). Shape B′ relocates the trigger to a non-overlapping inner
sub-region so it becomes SIBLING-of-action, NOT parent-of-action; the
defensive `e.stopPropagation()` patterns required by the pre-fix shape
are eliminated structurally.

**Canonical inner trigger**: `<Box component="button" type="button">`
(escape-hatch (b)). Browser handles Enter/Space activation natively;
no manual `onKeyDown` required. Less attribute surface than Shape B
trio; less drift across consumers. The cost is an 8-property unstyling
reset (`p:0, m:0, border:0, background:'transparent', cursor:'pointer',
font:'inherit', textAlign:'left', color:'inherit'`) to neutralise
native button defaults; this becomes a shared sx-mixin once it recurs
in a third site (tracked by `BUG-447-FOLLOWUP-UNSTYLED-BUTTON-MIXIN`).

Example (BUG-447-pathology, PathologyTab.tsx:174 — file-upload dropzone
with nested Remove IconButton):

```jsx
// BEFORE — outer Box with onClick + nested Remove IconButton with
// defensive stopPropagation. Whole-Box-as-button (Shape B) would
// create button-inside-button.
<Box onClick={() => fileRef.current?.click()} sx={{ ...dropzone visuals... }}>
  <CloudUploadIcon />
  <Typography>{prompt}</Typography>
  {selectedFile && (
    <IconButton onClick={(e) => { e.stopPropagation(); setSelectedFile(null); }}>
      <DeleteIcon />
    </IconButton>
  )}
  <input type="file" hidden />
</Box>

// AFTER — outer Box becomes non-interactive container (keeps dropzone
// visuals); trigger relocated to inner Box-as-button; Remove IconButton
// becomes sibling; stopPropagation eliminated structurally.
<Box sx={{ ...dropzone visuals... }}>
  <Box
    component="button"
    type="button"
    onClick={() => fileRef.current?.click()}
    aria-label={selectedFile ? `Replace selected file ${selectedFile.name}` : 'Click to select PDF or image file'}
    sx={{
      flex: 1,
      // 8-prop unstyling reset
      p: 0, m: 0, border: 0,
      background: 'transparent', cursor: 'pointer',
      font: 'inherit', textAlign: 'left', color: 'inherit',
      // focus-visible on the actual interactive element
      '&:focus-visible': { outline: '2px solid #b8621a', outlineOffset: 2, borderRadius: 4 },
    }}
  >
    <CloudUploadIcon />
    <Typography>{prompt}</Typography>
  </Box>
  {selectedFile && (
    <IconButton onClick={() => setSelectedFile(null)}>
      <DeleteIcon />
    </IconButton>
  )}
  <input type="file" hidden />
</Box>
```

For expand/collapse cards (e.g. `CorrespondenceTab.tsx` letter Card),
the inner trigger ALSO carries `aria-expanded` to announce state to AT.

**Anti-patterns to avoid in Shape B′**:

- Trigger contains a nested `<Button>` / `<IconButton>` (re-creates the
  button-inside-button anti-pattern Shape B′ exists to solve).
- Trigger has a manual `onKeyDown` handler (escape-hatch (b) renders as
  native `<button>` — Enter/Space already handled).
- Trigger uses `role="button"` (escape-hatch (b) is a real button — the
  role is already implicit; explicit role is redundant).
- Outer container retains an `onClick` (defeats the refactor; brings
  back the parent listener that defensive `stopPropagation()` was
  trying to silence).

### Decision tree (§2.5)

For each violation site:

1. Is the click target ALWAYS-interactive (no decorative state) AND has
   NO nested keyboard-accessible primitives?
   → **Shape B** (whole-Container trio). Cleanest; no extra wrapper.

2. Does the container have STATEFUL decorative + interactive modes?
   → **Shape A** (split branches). Decorative branch is non-interactive
   with descriptive `aria-label`; interactive branch carries the trio.

3. Does the violation reproduce a pattern MUI already provides
   (popup-with-items, action-button, tab-bar)?
   → **Shape C** (refactor to MUI primitive). Gold-standard;
   keyboard-accessibility comes for free.

4. Does the container have NESTED keyboard-accessible primitives
   (`<Button>`, `<IconButton>`, `<MenuItem>`, `<Chip onClick>`)?
   - Container's onClick DUPLICATES an inner action's onClick?
     → **Shape D** (redundant-handler removal). Remove the container's
     onClick; the inner primitive remains the canonical trigger.
   - Container's onClick is SEMANTICALLY DISTINCT from the inner
     action?
     → **Shape B′** (sub-region trigger + sibling actions). Relocate
     the trigger to a non-overlapping inner sub-region using
     `<Box component="button">` (canonical) so it becomes
     sibling-of-action, NOT parent-of-action.

## 3. Edge cases that are NOT BUG-447 violations

Per the Plan-agent inventory and L4 cycle-1 review:

- `<span>` Tooltip wrappers around disabled `<Button>` (correct MUI
  pattern; Tooltip needs a focusable wrapper since disabled buttons
  don't fire pointer events).
- Decorative `<span>` startIcon content inside `<Button>` (span
  receives no events; click bubbles to keyboard-accessible Button).
- Click-outside-to-close backdrop overlays operable via Escape on the
  underlying Dialog (WAI-ARIA modal-dialog pattern).
- `e.stopPropagation()` containers around real `<Button>` elements
  (Buttons already keyboard-accessible).

The ESLint rule does NOT fire on these because they don't match the
`<Box|Paper|Card|Typography>` opening-element name.

## 4. Allowlist drain

After the fix is staged, remove the target file from
`.github/no-onclick-on-mui-container.allowlist`. Replace the path entry
with a `# closed; allowlist entry removed.` comment under the child's
heading so the per-child mapping reads cleanly.

## 5. Two anchors per child (canonical shape)

Each child commit MUST land exactly two `docs/quality/fix-registry.md`
anchors — one `present` pinning the keyboard-wiring, one `absent`
pinning the allowlist removal:

```
| R-FIX-BUG-447-<SLUG>-<SITE> | <target path> | present | `<unique pattern>` | <description>. |
| R-FIX-BUG-447-<SLUG>-ALLOWLIST-REMOVED | .github/no-onclick-on-mui-container.allowlist | absent | `^<target path>$` | <description>. |
```

If a child fixes multiple sites, use one `present` anchor per site
that pins a uniquely-identifying string (e.g. the canonical
aria-label, or the specific `role="button"` JSX attribute pattern).

## 6. Atomic-flip discipline

The child commit MUST flip its catalogue row from severity to
`**fixed**` IN THE SAME COMMIT as the code (per
`feedback_atomic_catalogue_flip.md`). The chore SHA backfill commit
that follows ONLY adds the SHA to `progress.md`.

## 7. Gates (per-cycle L1-L5)

- **L1**: tsc × 3 workspaces; all 27 guards GREEN; fix-registry
  verifies new anchors; ESLint reports 0 violations from
  `signacare-rules/no-onclick-on-mui-container` across the full
  `apps/web/src` tree.
- **L2**: full apps/api unit suite — should be unchanged from the
  prior baseline (these children touch apps/web only). RuleTester
  suite stays at 27/27 + whatever new tests this child adds.
- **L3 / L4 / L5**: small commits typically PASS first-cycle. If a
  reviewer surfaces a non-blocking advisory, fold it inline (no
  silent deferral) or file a cascade BUG (`BUG-447-<slug>-FOLLOWUP-N`).

## 8. Parent close mechanic

When child 15/15 (BUG-447-misc-residual) lands AND the allowlist is
empty (only header comments), the same atomic commit ALSO flips the
BUG-447 parent from `S1 (split)` to `**fixed**`. Per the L5 cycle-1
recommendation captured in the parent row (`docs/quality/bugs-
remaining.md` line 260), the close commit also:

1. Deletes `.github/no-onclick-on-mui-container.allowlist` (or empties
   it to a single header comment).
2. Flips the rule's degraded-mode default from `exempt-all` to
   `enforce-all` (so the rule fires unconditionally even if the
   allowlist file is later moved/deleted by accident).
3. Adds `R-FIX-BUG-447-PARENT-CLOSE-ALLOWLIST-EMPTY` anti-anchor
   (absent mode, regex matches any non-comment line in the allowlist
   — so the parent flip cannot land while any path entry remains).

## 9. Cascade follow-ups

Three pre-existing cascades extend the rule's coverage in v2:

- **BUG-447-CASCADE-1b** — spread-attribute bypass (`<Box {...rest} onClick>`).
- **BUG-447-CASCADE-1c** — member-expression element name (`<MyLib.Box onClick>`).
- **BUG-447-CASCADE-1d** — refactor shared `path-scoped-allowlist`
  helpers into `eslint-plugins/signacare-rules/lib/`.

These are NOT children of BUG-447; they are enhancements to the
underlying rule. They land independently when the campaign closes.
