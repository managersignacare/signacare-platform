# Regenerating the Signacare local font bundle

This runbook describes how to regenerate `apps/web/public/fonts.css` + the
`apps/web/public/fonts/*.woff2` binaries from Google Fonts. The bundle exists
so offline-strict / air-gapped clinics can render every script Signacare's
multi-language clinical context requires without depending on
`fonts.googleapis.com` at runtime.

Single SSoT for the font set is
[`apps/web/src/shared/theme/palettes.ts`](../apps/web/src/shared/theme/palettes.ts)
(`FONT_STACKS` + `FONT_SCRIPT_COVERAGE`). The bundle must stay in sync; the
[`scripts/guards/check-font-coverage.ts`](../scripts/guards/check-font-coverage.ts)
guard fails CI on any drift.

---

## When to regenerate

- A font is added to or removed from `FONT_STACKS` in `palettes.ts`.
- A weight is added or removed from any bundled family.
- A Google Fonts upstream version update lands the team wants to absorb (rare
  — the per-script subset URLs are content-hashed, so existing files in
  `apps/web/public/fonts/` keep working until a deliberate refresh).
- The CJK subset BUG (`BUG-FONT-BUNDLING-CJK-SUBSET-TOOLING`, S3) closes —
  at that point `--include-cjk` becomes the default and Noto Sans SC / JP / KR
  move from CDN to local bundle.

---

## Bundled font sources

| Family | Source | Reason |
|---|---|---|
| Inter (300/400/500/600/700/800) | local `apps/web/public/fonts/` | primary brand voice; offline-safe |
| Source Serif Pro (400/600) | local | print narrative serif |
| Noto Sans Arabic (400/600) | local | Arabic + Persian-Farsi + Urdu (RTL) |
| Noto Sans Devanagari (400/600) | local | Hindi + Marathi + Nepali |
| Noto Sans Tamil (400/600) | local | Tamil |
| Noto Sans Gurmukhi (400/600) | local | Punjabi (Gurmukhi script) |
| Noto Sans Bengali (400/600) | local | Bengali |
| Noto Sans Sinhala (400/600) | local | Sinhala |
| Noto Sans Hebrew (400/600) | local | Hebrew (RTL) |
| Noto Sans Thai (400/600) | local | Thai |
| Noto Sans SC (100..900) | local | Simplified Chinese (offline-safe) |
| Noto Sans JP (100..900) | local | Japanese (offline-safe) |
| Noto Sans KR (100..900) | local | Korean (offline-safe) |

Per-script unicode-range subsetting is preserved for the existing bundled
families. CJK full-family subset artifacts are now generated as dedicated
local files (`NotoSansSC-full.woff2`, `NotoSansJP-full.woff2`,
`NotoSansKR-full.woff2`) to remove CDN runtime dependence in offline-strict
profiles.

---

## Regen procedure (Latin + small-script bundle; current state)

1. **Compose the Google Fonts CSS2 URL.** The query string is the union of every
   `&family=` entry the bundle covers, with each weight pinned. The current
   URL is:
   ```
   https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Source+Serif+Pro:wght@400;600&family=Noto+Sans+Arabic:wght@400;600&family=Noto+Sans+Devanagari:wght@400;600&family=Noto+Sans+Tamil:wght@400;600&family=Noto+Sans+Gurmukhi:wght@400;600&family=Noto+Sans+Bengali:wght@400;600&family=Noto+Sans+Sinhala:wght@400;600&family=Noto+Sans+Hebrew:wght@400;600&family=Noto+Sans+Thai:wght@400;600&display=swap
   ```
   If `palettes.ts` `FONT_STACKS` adds or drops a family / weight, update the
   `&family=` chain identically.

2. **Fetch the CSS with a browser User-Agent.** Google's CSS2 endpoint serves
   different `@font-face` rules per UA (modern browsers get woff2; older UAs
   get older formats). We want woff2:
   ```sh
   curl -s -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" \
     -o /tmp/gf-bundled.css \
     'https://fonts.googleapis.com/css2?…full-URL-from-step-1…&display=swap'
   ```
   Verify the file is ~50 KB and contains `format('woff2')` references.

3. **Download every unique woff2.** The CSS has multiple `@font-face` blocks
   per family (one per script subset × weight). Each block has a distinct
   `src: url(https://fonts.gstatic.com/.../HASH.woff2)`:
   ```sh
   FONTS_DIR=apps/web/public/fonts
   mkdir -p "$FONTS_DIR"
   grep -oE 'https://fonts\.gstatic\.com/[^)]+\.woff2' /tmp/gf-bundled.css | sort -u | \
     while read url; do
       fname=$(basename "$url")
       [ -f "$FONTS_DIR/$fname" ] || curl -s -o "$FONTS_DIR/$fname" "$url"
     done
   ```
   The Google hashes are content-derived — re-running this is idempotent. New
   weights / scripts add new files; existing files are untouched.

4. **Rewrite the CSS to use local paths.** Replace every CDN URL with
   `/fonts/<basename>`:
   ```sh
   sed -E 's|url\(https://fonts\.gstatic\.com/[^)]*/([^/)]+\.woff2)\)|url(/fonts/\1)|g' \
     /tmp/gf-bundled.css > /tmp/fonts-body.css
   ```

5. **Prepend the provenance header.** The header at the top of
   `apps/web/public/fonts.css` explains the bundle's purpose, the bundled
   set, the CDN exemption (CJK), and the link to `FONT_STACKS` SSoT. Copy it
   verbatim from the current file, then append the body from step 4:
   ```sh
   # The header is the comment block from the top of the existing fonts.css.
   # Use the existing file as the template; do not hand-write the header.
   head -n 30 apps/web/public/fonts.css > /tmp/header.css
   cat /tmp/header.css /tmp/fonts-body.css > apps/web/public/fonts.css
   ```

6. **Re-run the font-coverage guard.** It validates that every script in
   `REQUIRED_SCRIPTS` is covered by a font available via local bundle OR CDN,
   and that no font is referenced in `FONT_STACKS` but missing from both
   sources:
   ```sh
   npm run guard:font-coverage
   ```
   Expected output: `Required scripts covered: 15/15`.

7. **Commit the regenerated bundle.** Stage `apps/web/public/fonts.css` plus
   any new/updated `apps/web/public/fonts/*.woff2` files. Old files that no
   longer appear in the new CSS can be deleted (they were referenced by an
   older weight / script the new bundle doesn't include). The commit message
   should cite the BUG that motivated the regen.

---

## CJK subset path

Use the dedicated corpus+subset pipeline:

1. Install subsetting prerequisites:
   ```sh
   pip install fonttools brotli zopfli
   ```
2. Generate CJK glyph corpus from real Signacare sources:
   ```sh
   npm run fonts:subset-cjk
   ```
   This writes `apps/web/public/fonts/cjk-glyphs.txt`.
3. Build SC/JP/KR subsets from source OTF/TTF files:
   ```sh
   npm run fonts:subset-cjk -- \
     --sc-font /path/to/NotoSansSC-Regular.otf \
     --jp-font /path/to/NotoSansJP-Regular.otf \
     --kr-font /path/to/NotoSansKR-Regular.otf
   ```
4. Wire emitted files into `apps/web/public/fonts.css` as `@font-face` entries
   (or overwrite `NotoSansSC/JP/KR-full.woff2`) and validate coverage:
   ```sh
   npm run guard:font-coverage
   ```
5. Keep `apps/web/index.html` local-only (`/fonts.css`) and do not reintroduce
   Google Fonts runtime links.

---

## Verification

Every regen should leave these three artifacts in agreement:

1. `apps/web/src/shared/theme/palettes.ts` — `FONT_STACKS` SSoT (what the
   theme expects).
2. `apps/web/public/fonts.css` — `@font-face` declarations for the bundled
   families.
3. `apps/web/index.html` — `<link rel="stylesheet" href="/fonts.css" />`
   plus the CDN `<link>` for any non-bundled families.

The `npm run guard:font-coverage` script is the structural check that all
three are consistent. CI runs it on every PR; run it locally before any
font-bundle commit.
