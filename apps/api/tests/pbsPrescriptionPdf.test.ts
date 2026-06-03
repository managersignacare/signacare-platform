/**
 * BUG-294 — PBS paper prescription PDF generator unit tests.
 *
 * Exercises payload / shape without visual regression (that lives in a
 * dedicated Playwright suite once the UI wires Print-Script). Here we
 * assert:
 *   T1 — generator returns a non-empty Buffer
 *   T2 — PDF buffer starts with %PDF (valid header)
 *   T3 — A4 page size (verifiable via extracted metadata / known-size
 *        heuristic: A4 PDFs are ~595x842 pt which shows up in mediabox)
 *   T4 — three-up rendering: PDF has at least 3 occurrences of the
 *        "PBS PRESCRIPTION" label (one per copy)
 *   T5 — S8 flag emits "SCHEDULE 8" marker in PDF content stream
 *   T6 — non-S8 flag does NOT emit "SCHEDULE 8"
 *   T7 — authority flag emits "AUTHORITY" marker (with code when
 *        provided)
 *   T8 — eRx token is embedded in the footer text
 *   T9 — generator tolerates missing optional fields (no throw)
 *
 * We decode the PDF as latin-1 text and grep for markers. This is
 * resilient to pdfkit's internal compression only because pdfkit
 * writes page content streams as uncompressed by default for small
 * documents — confirmed by inspecting a generated sample.
 */

import { describe, it, expect } from 'vitest';
import {
  generatePbsPrescriptionPdf,
  type PbsPrescriptionPdfInput,
} from '../src/shared/pbsPrescriptionPdf';

function baseInput(overrides: Partial<PbsPrescriptionPdfInput> = {}): PbsPrescriptionPdfInput {
  return {
    prescriberName: 'Dr Alice Test',
    prescriberQualifications: 'MBBS FRANZCP',
    prescriberNumber: '3575376',
    providerNumber: '2699958J',
    hpii: '8003611234567893',
    prescriberAddress: '123 Clinician St, Melbourne VIC 3000',
    prescriberPhone: '03 9999 9999',
    patientName: 'John Patient',
    patientDob: '1985-06-12',
    patientAddress: '456 Patient Rd, Carlton VIC 3053',
    patientIhi: '8003601234567894',
    patientMedicareNumber: '1234567891',
    patientMedicareIrn: '2',
    clinicName: 'Test Mental Health Clinic',
    clinicAddress: '100 Clinic Ave, Fitzroy VIC 3065',
    clinicPhone: '03 9999 0000',
    clinicHpio: '8003621234567892',
    prescriptionDate: '2026-04-22',
    medicationGenericName: 'Sertraline 50 mg tablet',
    dose: '50 mg',
    route: 'Oral',
    frequency: 'Daily',
    directions: 'Take one tablet daily with food',
    quantity: '30',
    repeats: 5,
    pbsItemCode: '8200J',
    isAuthority: false,
    isS8: false,
    prescriptionId: 'rx-test-001',
    ...overrides,
  };
}

/**
 * Extract rendered text from an uncompressed pdfkit PDF. pdfkit emits
 * text as hex-encoded strings between <…> delimiters inside TJ/Tj
 * operators. We find every <hex> run, attempt UTF-8 decoding, and
 * concatenate — good enough for ASCII-only marker matching.
 */
function extractTextFromPdf(buf: Buffer): string {
  const latin = buf.toString('latin1');
  const matches = latin.match(/<[0-9a-fA-F]+>/g) ?? [];
  const pieces: string[] = [];
  for (const m of matches) {
    const hex = m.slice(1, -1);
    if (hex.length % 2 !== 0) continue;
    try {
      pieces.push(Buffer.from(hex, 'hex').toString('utf-8'));
    } catch { /* skip */ }
  }
  // Join with NO separator — pdfkit splits text across multiple
  // hex blocks when inserting kerning adjustments mid-word, so
  // "AUTHORITY" may appear as ['A', 'UTHORITY']. A space join would
  // corrupt the word boundary.
  return pieces.join('');
}

describe('BUG-294 PBS paper prescription PDF generator', () => {
  it('T1 — returns a non-empty Buffer', async () => {
    const pdf = await generatePbsPrescriptionPdf(baseInput());
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('T2 — PDF buffer starts with the %PDF magic header', async () => {
    const pdf = await generatePbsPrescriptionPdf(baseInput());
    expect(pdf.slice(0, 4).toString()).toBe('%PDF');
  });

  it('T3 — uses A4 page size (595x842 in PDF media box)', async () => {
    const pdf = await generatePbsPrescriptionPdf(baseInput());
    // MediaBox metadata is plain ASCII in the PDF header, not hex-encoded
    // text. Read the buffer directly as latin1 for the grep.
    const raw = pdf.toString('latin1');
    expect(raw).toMatch(/MediaBox\s*\[\s*0\s+0\s+595(?:\.\d+)?\s+841(?:\.\d+)?/);
  });

  it('T4 — three-up rendering: "PBS PRESCRIPTION" appears ≥3 times in the content', async () => {
    const pdf = await generatePbsPrescriptionPdf(baseInput());
    const text = extractTextFromPdf(pdf);
    const matches = text.match(/PBS PRESCRIPTION/g);
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('T5 — S8 flag emits "SCHEDULE 8" marker', async () => {
    const pdf = await generatePbsPrescriptionPdf(baseInput({ isS8: true }));
    const text = extractTextFromPdf(pdf);
    expect(text).toContain('SCHEDULE 8');
  });

  it('T6 — non-S8 flag does NOT emit "SCHEDULE 8"', async () => {
    const pdf = await generatePbsPrescriptionPdf(baseInput({ isS8: false }));
    const text = extractTextFromPdf(pdf);
    expect(text).not.toContain('SCHEDULE 8');
  });

  it('T7 — authority flag emits "AUTHORITY" marker with code when provided', async () => {
    const pdf = await generatePbsPrescriptionPdf(
      baseInput({ isAuthority: true, authorityCode: 'ABC123' }),
    );
    const text = extractTextFromPdf(pdf);
    expect(text).toContain('AUTHORITY');
    expect(text).toContain('ABC123');
  });

  it('T8 — eRx token is embedded in the footer when supplied', async () => {
    const token = 'erx-token-xyz-987';
    const pdf = await generatePbsPrescriptionPdf(baseInput({ erxToken: token }));
    const text = extractTextFromPdf(pdf);
    expect(text).toContain(token);
  });

  it('T9 — tolerates missing optional fields (no throw)', async () => {
    const minimal: PbsPrescriptionPdfInput = {
      prescriberName: 'Dr X',
      prescriberNumber: '1234567',
      patientName: 'Patient Y',
      patientDob: '1990-01-01',
      clinicName: 'Clinic Z',
      prescriptionDate: '2026-04-22',
      medicationGenericName: 'Paracetamol 500 mg',
      dose: '500 mg',
      route: 'Oral',
      frequency: 'QID PRN',
      directions: 'As directed',
      quantity: '20',
      repeats: 0,
      isAuthority: false,
      isS8: false,
      prescriptionId: 'rx-minimal-001',
    };
    const pdf = await generatePbsPrescriptionPdf(minimal);
    expect(pdf.length).toBeGreaterThan(500);
  });
});
