/**
 * BUG-298 — MHR FHIR document-push client unit tests.
 *
 * Exercises payload construction and response parsing without hitting
 * the real MHR endpoint (ADHA partner registration + NASH cert not
 * available in CI). Full E2E validation requires those credentials.
 *
 * Coverage (9 tests):
 *   T1 — buildDocumentReference includes required FHIR fields +
 *        correct LOINC code for each documentType
 *   T2 — cdaXml is base64-encoded in content.attachment.data
 *   T3 — patient IHI lands in subject.identifier with correct system
 *   T4 — author HPI-I lands in author[0].identifier
 *   T5 — custodian HPI-O lands in custodian.identifier
 *   T6 — buildBundle wraps in a transaction with POST DocumentReference
 *   T7 — parseBundleResponse extracts externalDocId from location
 *   T8 — parseBundleResponse throws on malformed JSON
 *   T9 — parseBundleResponse throws on missing entry.response.location
 */

import { describe, it, expect } from 'vitest';
import {
  buildDocumentReference,
  buildBundle,
  parseBundleResponse,
  type MhrDocumentPushInput,
} from '../src/integrations/mhr/mhrDocumentClient';

interface DocumentReferenceLike {
  resourceType: string;
  status: string;
  docStatus: string;
  type: { coding: Array<{ system: string; code: string }> };
  content: Array<{ attachment: { data: string } }>;
  subject: { identifier: { system: string; value: string } };
  author: Array<{ identifier: { system: string; value: string } }>;
  custodian: { identifier: { system: string; value: string } };
}

interface BundleLike {
  resourceType: string;
  type: string;
  entry: Array<{
    request: { method: string; url: string };
    resource: unknown;
  }>;
}

const INPUT: MhrDocumentPushInput = {
  patientId: 'pid-123',
  patientIhi: '8003601234567894',
  clinicHpio: '8003621234567892',
  authorHpii: '8003611234567893',
  letterId: 'letter-abc',
  documentType: 'specialist_letter',
  cdaXml: '<?xml version="1.0"?><ClinicalDocument/>',
  createdAt: '2026-04-22T10:00:00Z',
};

describe('BUG-298 MHR DocumentReference builder', () => {
  it('T1 — buildDocumentReference has required FHIR fields + correct LOINC', () => {
    const docRef = buildDocumentReference(INPUT) as DocumentReferenceLike;
    expect(docRef.resourceType).toBe('DocumentReference');
    expect(docRef.status).toBe('current');
    expect(docRef.docStatus).toBe('final');
    expect(docRef.type.coding[0].system).toBe('http://loinc.org');
    expect(docRef.type.coding[0].code).toBe('11488-4'); // specialist_letter

    // Spot-check the other three document types:
    const discharge = buildDocumentReference({ ...INPUT, documentType: 'discharge' }) as DocumentReferenceLike;
    expect(discharge.type.coding[0].code).toBe('18842-5');
    const referral = buildDocumentReference({ ...INPUT, documentType: 'referral' }) as DocumentReferenceLike;
    expect(referral.type.coding[0].code).toBe('57133-1');
    const summary = buildDocumentReference({ ...INPUT, documentType: 'patient_summary' }) as DocumentReferenceLike;
    expect(summary.type.coding[0].code).toBe('60591-5');
  });

  it('T2 — cdaXml is base64-encoded in content.attachment.data', () => {
    const docRef = buildDocumentReference(INPUT) as DocumentReferenceLike;
    const data = docRef.content[0].attachment.data;
    const decoded = Buffer.from(data, 'base64').toString('utf-8');
    expect(decoded).toBe(INPUT.cdaXml);
  });

  it('T3 — patient IHI lands in subject.identifier with correct IHI system URI', () => {
    const docRef = buildDocumentReference(INPUT) as DocumentReferenceLike;
    expect(docRef.subject.identifier.system).toBe('http://ns.electronichealth.net.au/id/hi/ihi/1.0');
    expect(docRef.subject.identifier.value).toBe(INPUT.patientIhi);
  });

  it('T4 — author HPI-I lands in author[0].identifier', () => {
    const docRef = buildDocumentReference(INPUT) as DocumentReferenceLike;
    expect(docRef.author[0].identifier.system).toBe('http://ns.electronichealth.net.au/id/hi/hpii/1.0');
    expect(docRef.author[0].identifier.value).toBe(INPUT.authorHpii);
  });

  it('T5 — custodian HPI-O lands in custodian.identifier', () => {
    const docRef = buildDocumentReference(INPUT) as DocumentReferenceLike;
    expect(docRef.custodian.identifier.system).toBe('http://ns.electronichealth.net.au/id/hi/hpio/1.0');
    expect(docRef.custodian.identifier.value).toBe(INPUT.clinicHpio);
  });
});

describe('BUG-298 MHR Bundle wrapper', () => {
  it('T6 — buildBundle wraps DocumentReference in a FHIR transaction', () => {
    const docRef = buildDocumentReference(INPUT);
    const bundle = buildBundle(docRef) as BundleLike;
    expect(bundle.resourceType).toBe('Bundle');
    expect(bundle.type).toBe('transaction');
    expect(bundle.entry).toHaveLength(1);
    expect(bundle.entry[0].request.method).toBe('POST');
    expect(bundle.entry[0].request.url).toBe('DocumentReference');
    expect(bundle.entry[0].resource).toBe(docRef);
  });
});

describe('BUG-298 MHR Bundle response parser', () => {
  it('T7 — parseBundleResponse extracts externalDocId from entry.response.location', () => {
    const resBody = JSON.stringify({
      resourceType: 'Bundle',
      entry: [{
        response: {
          location: 'DocumentReference/abc-123-xyz/_history/1',
        },
      }],
    });
    const id = parseBundleResponse(resBody);
    expect(id).toBe('abc-123-xyz');
  });

  it('T8 — parseBundleResponse throws on malformed JSON', () => {
    expect(() => parseBundleResponse('not json at all')).toThrow('MHR_BUNDLE_PARSE_FAILED');
  });

  it('T9 — parseBundleResponse throws on missing entry.response.location', () => {
    const resBody = JSON.stringify({ resourceType: 'Bundle', entry: [] });
    expect(() => parseBundleResponse(resBody)).toThrow('MHR_BUNDLE_PARSE_FAILED');
  });
});
