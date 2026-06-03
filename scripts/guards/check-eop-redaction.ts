#!/usr/bin/env tsx
/**
 * BUG-P1 — Electronic EoP redaction structural guard.
 *
 * Enforces that token-facing EoP builders stay token-identifier only and do
 * not regress into carrying clinical/demographic payload fields.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const REPO_ROOT = resolve(__dirname, '..', '..');

const ERX_PAYLOADS_FILE = 'apps/api/src/integrations/escript/erxRestPayloads.ts';
const TOKEN_DELIVERY_FILE = 'apps/api/src/integrations/escript/tokenDeliveryService.ts';

const FORBIDDEN_EOP_XML_FIELDS = [
  'PatientFamilyName',
  'PatientFirstName',
  'PatientBirthdate',
  'DoctorPrescriberNumber',
  'DoctorFamilyName',
  'PatientInstructions',
  'ReasonForPrescribing',
] as const;

const FORBIDDEN_TOKEN_DELIVERY_PROPS = [
  'payload.patientName',
  'payload.medicationName',
  'payload.prescribedBy',
  'payload.prescribedDate',
  'payload.clinicName',
] as const;

type Violation = {
  file: string;
  reason: string;
};

type GuardResult = {
  exitCode: number;
  violations: Violation[];
};

function extractFunction(source: string, fnName: string): string | null {
  const sourceFile = ts.createSourceFile(
    'guard-input.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  let extracted: string | null = null;

  const walk = (node: ts.Node): void => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === fnName &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      extracted = source.slice(node.getStart(sourceFile), node.end);
      return;
    }
    ts.forEachChild(node, walk);
  };

  walk(sourceFile);
  return extracted;
}

function runGuard(repoRoot: string = REPO_ROOT): GuardResult {
  const violations: Violation[] = [];

  const erxPayloadsPath = resolve(repoRoot, ERX_PAYLOADS_FILE);
  const tokenDeliveryPath = resolve(repoRoot, TOKEN_DELIVERY_FILE);

  if (!existsSync(erxPayloadsPath)) {
    violations.push({ file: ERX_PAYLOADS_FILE, reason: 'required file missing' });
    return { exitCode: 1, violations };
  }
  if (!existsSync(tokenDeliveryPath)) {
    violations.push({ file: TOKEN_DELIVERY_FILE, reason: 'required file missing' });
    return { exitCode: 1, violations };
  }

  const erxSource = readFileSync(erxPayloadsPath, 'utf8');
  const tokenSource = readFileSync(tokenDeliveryPath, 'utf8');

  const tokenXmlFn = extractFunction(erxSource, 'buildTokenEoPXml');
  if (!tokenXmlFn) {
    violations.push({
      file: ERX_PAYLOADS_FILE,
      reason: 'buildTokenEoPXml export missing (BUG-P1 contract broken)',
    });
  } else {
    for (const tag of ['SCID', 'DSPID', 'Token']) {
      const hasLiteralTag = new RegExp(`<${tag}\\b`).test(tokenXmlFn);
      const hasTagEmitterCall = new RegExp(`\\bel\\s*\\(\\s*['"]${tag}['"]\\s*,`).test(tokenXmlFn);
      if (!hasLiteralTag && !hasTagEmitterCall) {
        violations.push({
          file: ERX_PAYLOADS_FILE,
          reason: `token EoP XML missing required tag <${tag}>`,
        });
      }
    }

    for (const forbiddenField of FORBIDDEN_EOP_XML_FIELDS) {
      if (new RegExp(`<${forbiddenField}\\b`).test(tokenXmlFn)) {
        violations.push({
          file: ERX_PAYLOADS_FILE,
          reason: `token EoP XML includes forbidden clinical field <${forbiddenField}>`,
        });
      }
    }
  }

  for (const fnName of ['buildRedactedEopSmsBody', 'buildRedactedEopEmailHtml']) {
    const fnBody = extractFunction(tokenSource, fnName);
    if (!fnBody) {
      violations.push({
        file: TOKEN_DELIVERY_FILE,
        reason: `${fnName} export missing (BUG-P1 token delivery redaction contract broken)`,
      });
      continue;
    }

    for (const forbiddenProp of FORBIDDEN_TOKEN_DELIVERY_PROPS) {
      if (fnBody.includes(forbiddenProp)) {
        violations.push({
          file: TOKEN_DELIVERY_FILE,
          reason: `${fnName} references forbidden field ${forbiddenProp}`,
        });
      }
    }
  }

  return { exitCode: violations.length > 0 ? 1 : 0, violations };
}

function main(): void {
  const result = runGuard(REPO_ROOT);
  if (result.exitCode !== 0) {
    console.error('BUG-P1 guard failed:');
    for (const violation of result.violations) {
      console.error(` - [${violation.file}] ${violation.reason}`);
    }
    process.exit(1);
  }
  console.log('BUG-P1 guard passed.');
}

if (require.main === module) {
  main();
}

export { runGuard };
