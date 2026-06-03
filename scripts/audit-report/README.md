# Category 12 — Gold Standard Audit Report Generator

Produces a single self-contained HTML report for an external audit.
Reads JSON test results from Categories 1-11 and cross-references them
to regulatory controls across:

- Australian **Privacy Act 1988 (Cth)** APP 6 + APP 11
- **My Health Record Act 2012 (Cth)**
- ACHS **EQuIPNational Standards 1 & 4**
- **HL7 FHIR R4** conformance
- **WCAG 2.1 AA**
- **OWASP Top 10** (2021)
- **ISO 25010** quality model
- **IEC 62304** medical device software

## Run

```bash
# 1. Run the full test suite with JSON output
cd apps/api
npx vitest run --reporter=json --outputFile=/tmp/vitest.json

# 2. (Optional) Capture k6 load results against staging
STAGING_URL=https://staging.signacare.au k6 run \
  --summary-export=/tmp/k6.json scripts/k6/load.js

# 3. (Optional) Capture Playwright results
npm run test:e2e -- --reporter=json > /tmp/playwright.json

# 4. Generate the report
cd ../..
npm run audit:report -- \
  --vitest-json=/tmp/vitest.json \
  --k6-summary=/tmp/k6.json \
  --playwright-json=/tmp/playwright.json
```

Every `--*` flag is optional. If a data source is missing, the
corresponding section in the report renders as `⊘ not run` — so the
report is always producible, even in a partial CI run.

Output: `audit-reports/audit-report-YYYY-MM-DD-<short-sha>.html`

## What's in the report

1. **Executive Summary** — one-line pass/fail per category, overall
   compliance badge
2. **Vitest Detail** — file + test counts, per-file status
3. **OWASP Top 10 Coverage** — each item mapped to the test file(s)
   that cover it, with ✅/⚠️/🔴 indicators
4. **Performance SLA Compliance** — per-endpoint p95 from k6 vs
   target threshold
5. **Architecture Metrics** — depcruise output (modules cruised,
   circular deps, layering violations)
6. **FHIR R4 Conformance** — Patient resource shape + AU IG profile
7. **Audit Log Coverage** — PHI entity × CRUD matrix
8. **Outstanding Gaps (prioritised by clinical risk)** — every
   `it.fails` marker in the suite, colour-coded 🔴🟠🟡🟢

## CI wiring

The deploy pipeline (`.github/workflows/deploy.yml`) should add a
`generate-audit-report` step after Job 9 (`compliance-check`) that:

1. Reads the vitest JSON artifact from Job 2
2. Reads the k6 summary artifact from Job 8
3. Reads the Playwright report artifact from Job 4
4. Runs `npm run audit:report` with those three inputs
5. Uploads the HTML as a CI artifact (30-day retention)

The resulting artifact is what gets handed to the external auditor.

## PDF conversion (optional)

The HTML is self-contained with `@page` CSS so it prints to A4
cleanly. For PDF output, pipe through headless Chrome:

```bash
npm run audit:report
google-chrome --headless --disable-gpu --no-pdf-header-footer \
  --print-to-pdf=audit-reports/latest.pdf \
  audit-reports/audit-report-*.html
```

PDF conversion is NOT wired into the script today because the
headless-chrome runtime dependency doubles the deploy pipeline time
and is environment-specific. Add it as a post-step in CI when the
compliance officer asks for PDF artifacts.
