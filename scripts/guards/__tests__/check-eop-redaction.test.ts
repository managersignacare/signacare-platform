import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { runGuard } from '../check-eop-redaction';

const TMP_BASE = join(tmpdir(), 'bugp1-eop-redaction-guard');

beforeAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
  mkdirSync(TMP_BASE, { recursive: true });
});

afterAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
});

function writeFixtureFile(root: string, relPath: string, content: string): void {
  const fullPath = join(root, relPath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, 'utf8');
}

function fixtureRoot(name: string): string {
  const root = join(TMP_BASE, name);
  mkdirSync(root, { recursive: true });
  return root;
}

function writePassFixture(root: string): void {
  writeFixtureFile(
    root,
    'apps/api/src/integrations/escript/erxRestPayloads.ts',
    `export function buildTokenEoPXml(payload: { scid: string; dspId?: string | null; token: string }): string {
  return \`<ePrescription><SCID>\${payload.scid}</SCID><TokenEoP><DSPID>\${payload.dspId ?? ''}</DSPID><Token>\${payload.token}</Token></TokenEoP></ePrescription>\`;
}
`,
  );

  writeFixtureFile(
    root,
    'apps/api/src/integrations/escript/tokenDeliveryService.ts',
    `export function buildRedactedEopSmsBody(payload: { erxToken: string; scid?: string; dspId?: string }): string {
  return [payload.erxToken, payload.scid ?? 'N/A', payload.dspId ?? 'N/A'].join('\\n');
}
export function buildRedactedEopEmailHtml(payload: { erxToken: string; scid?: string; dspId?: string }): string {
  return \`<div>\${payload.erxToken} \${payload.scid ?? 'N/A'} \${payload.dspId ?? 'N/A'}</div>\`;
}
`,
  );
}

describe('check-eop-redaction guard', () => {
  it('passes when token EoP is token-only and redacted renderers avoid forbidden fields', () => {
    const root = fixtureRoot('pass');
    writePassFixture(root);
    const result = runGuard(root);
    expect(result.exitCode).toBe(0);
    expect(result.violations).toHaveLength(0);
  });

  it('fails when token EoP XML includes forbidden clinical fields', () => {
    const root = fixtureRoot('forbidden_xml_field');
    writePassFixture(root);
    writeFixtureFile(
      root,
      'apps/api/src/integrations/escript/erxRestPayloads.ts',
      `export function buildTokenEoPXml(payload: { scid: string; token: string }): string {
  return \`<ePrescription><SCID>\${payload.scid}</SCID><PatientFamilyName>Smith</PatientFamilyName><Token>\${payload.token}</Token></ePrescription>\`;
}
`,
    );
    const result = runGuard(root);
    expect(result.exitCode).toBe(1);
    expect(result.violations.some((v) => v.reason.includes('forbidden clinical field'))).toBe(true);
  });

  it('fails when redacted token renderers leak forbidden payload fields', () => {
    const root = fixtureRoot('forbidden_sms_field');
    writePassFixture(root);
    writeFixtureFile(
      root,
      'apps/api/src/integrations/escript/tokenDeliveryService.ts',
      `export function buildRedactedEopSmsBody(payload: { erxToken: string; patientName?: string }): string {
  return payload.patientName ?? payload.erxToken;
}
export function buildRedactedEopEmailHtml(payload: { erxToken: string }): string {
  return \`<div>\${payload.erxToken}</div>\`;
}
`,
    );
    const result = runGuard(root);
    expect(result.exitCode).toBe(1);
    expect(result.violations.some((v) => v.reason.includes('forbidden field payload.patientName'))).toBe(true);
  });
});
