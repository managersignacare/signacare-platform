/**
 * CI guard: every Express handler in `patientAppRoutes.ts` whose
 * route captures `:patientId` MUST call `requirePatientOwnership(req,
 * req.params.patientId)` before its first `dbAdmin(` access — OR
 * carry a `// @patient-app-ownership-exempt: <reason ≥10 chars>`
 * annotation.
 *
 * BUG-430-PATIENT-APP — patient-app uses `dbAdmin` (RLS-bypassing)
 * AND historically read `req.params.patientId` from the URL without
 * verifying the caller's relationship to that patient. Result:
 * authenticated patient-A could enumerate UUIDs to read/modify
 * patient-B's data, cross-tenant + cross-patient (Privacy Act 1988
 * APP 11 / HIPAA §164.312(a)(1) breach class).
 *
 * `requirePatientOwnership` from `apps/api/src/shared/authGuards.ts`
 * is the canonical guard. The helper dispatches by session class:
 *   - patient-app session → token-vs-param patientId equality
 *   - staff session       → requirePatientRelationship delegate
 *
 * The §13.8 absorb after BUG-430-PATIENT-APP REJECT-1 corrected the
 * earlier `tenantMiddleware`-skip heuristic. `tenantMiddleware` is
 * NOT a clinician marker — it just asserts `req.clinicId` is set,
 * which any authed session has. The single helper covers both
 * caller classes, so the guard scans EVERY `:patientId` route in
 * patientAppRoutes.ts.
 *
 * The 4 pre-auth sites (`/activate`, `/login`) take patient context
 * from the request body and look up the row first — they don't have
 * `:patientId` in the URL. They are AUTO-EXEMPT (the guard only
 * fires on :patientId-route handlers).
 *
 * Exit code:
 *   0 — every :patientId route handler is guarded
 *   1 — at least one is unguarded and unannotated
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROUTES_FILE = resolve(
  __dirname,
  '..',
  '..',
  'apps',
  'api',
  'src',
  'features',
  'patient-app',
  'patientAppRoutes.ts',
);

const ROUTE_REGEX = /router\.(get|post|put|patch|delete)\(\s*['"]([^'"]*:patientId[^'"]*)['"][\s\S]*?async\s*\([^)]*\)\s*=>\s*\{/g;
const OWNERSHIP_CALL = /requirePatientOwnership\s*\(\s*req\s*,\s*req\.params\.patientId\s*\)/;
const EXEMPT = /@patient-app-ownership-exempt:\s*\S{10,}/;

function findHandlerBody(source: string, openBraceIdx: number): string | null {
  let depth = 1;
  let i = openBraceIdx + 1;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    i += 1;
  }
  if (depth !== 0) return null;
  return source.slice(openBraceIdx, i);
}

function lineNumber(source: string, idx: number): number {
  return source.slice(0, idx).split('\n').length;
}

function main(): number {
  let source: string;
  try {
    source = readFileSync(ROUTES_FILE, 'utf-8');
  } catch (err) {
    console.error(`check-patient-app-ownership: cannot read ${ROUTES_FILE}: ${(err as Error).message}`);
    return 1;
  }

  const violations: string[] = [];
  let scanned = 0;

  let match: RegExpExecArray | null;
  while ((match = ROUTE_REGEX.exec(source)) !== null) {
    scanned += 1;
    const verb = match[1];
    const path = match[2];
    const openBraceIdx = match.index + match[0].length - 1;
    const handlerBody = findHandlerBody(source, openBraceIdx);
    if (!handlerBody) {
      violations.push(`${ROUTES_FILE}:${lineNumber(source, match.index)} — could not locate handler body for ${verb} ${path}`);
      continue;
    }

    if (OWNERSHIP_CALL.test(handlerBody)) continue;
    if (EXEMPT.test(handlerBody)) continue;

    violations.push(`${ROUTES_FILE}:${lineNumber(source, match.index)} — ${verb.toUpperCase()} ${path} missing requirePatientOwnership(req, req.params.patientId) before first DB call`);
  }

  if (violations.length > 0) {
    console.error('check-patient-app-ownership: FAIL — patient-app handlers missing dual-mode access guard:');
    for (const v of violations) console.error(`  ${v}`);
    console.error(`Total: ${violations.length} violation(s) in ${scanned} :patientId-route handler(s).`);
    console.error('Fix: insert `await requirePatientOwnership(req, req.params.patientId);` as the first line in the try{} block, before the first dbAdmin( call. The helper dispatches by session class — patient-app sessions get the IDOR check, staff sessions get requirePatientRelationship. OR annotate with `// @patient-app-ownership-exempt: <≥10-char reason>` if the handler has a documented bespoke gate.');
    return 1;
  }

  console.log(`check-patient-app-ownership: every :patientId-route handler is guarded by the dual-mode helper (${scanned} scanned)`);
  return 0;
}

process.exit(main());
