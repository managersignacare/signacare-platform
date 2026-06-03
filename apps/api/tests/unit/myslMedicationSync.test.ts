import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

function configureMySLEnv(): void {
  process.env.MYSL_API_URL = 'https://mysl.test.local';
  process.env.MYSL_CLIENT_ID = 'mysl-client';
  process.env.MYSL_CLIENT_SECRET = 'mysl-secret';
  process.env.MYSL_TOKEN_URL = 'https://mysl.test.local/oauth/token';
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('myslClient.syncMedicationRequestFromPrescription', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  it('skips when MySL is not configured', async () => {
    delete process.env.MYSL_API_URL;
    delete process.env.MYSL_CLIENT_ID;
    delete process.env.MYSL_CLIENT_SECRET;
    delete process.env.MYSL_TOKEN_URL;
    const { syncMedicationRequestFromPrescription } = await import('../../src/integrations/escript/myslClient');

    const out = await syncMedicationRequestFromPrescription({
      patientIhi: '8003609900000000',
      prescriptionId: 'rx-1',
      medicationRequestResource: { resourceType: 'MedicationRequest' },
    });

    expect(out).toMatchObject({
      success: false,
      action: 'skipped',
      reason: 'mysl_not_configured',
    });
  });

  it('creates a MedicationRequest when no existing script is found', async () => {
    configureMySLEnv();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { syncMedicationRequestFromPrescription } = await import('../../src/integrations/escript/myslClient');

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({
        entry: [
          { resource: { resourceType: 'Patient', id: 'patient-fhir-1' } },
          { resource: { resourceType: 'Consent', id: 'consent-1' } },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({ entry: [] }))
      .mockResolvedValueOnce(jsonResponse({ resourceType: 'MedicationRequest', id: 'mr-1' }, 201));

    const out = await syncMedicationRequestFromPrescription({
      patientIhi: '8003609900000001',
      prescriptionId: 'rx-create-1',
      medicationRequestResource: {
        resourceType: 'MedicationRequest',
        intent: 'order',
        status: 'active',
        medicationCodeableConcept: { text: 'Lithium' },
      },
      npdsReference: 'NPDS-123',
      erxToken: 'TOKEN-123',
    });

    expect(out).toMatchObject({
      success: true,
      action: 'created',
      medicationRequestId: 'mr-1',
      patientFhirId: 'patient-fhir-1',
    });

    const lastCall = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(lastCall[0]).toBe('https://mysl.test.local/MedicationRequest');
    expect(lastCall[1]?.method).toBe('POST');
    const body = JSON.parse(String(lastCall[1]?.body)) as Record<string, unknown>;
    expect(body.subject).toEqual({ reference: 'Patient/patient-fhir-1' });
    expect(body.identifier).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          system: 'http://signacare.local/fhir/identifier/prescription-id',
          value: 'rx-create-1',
        }),
      ]),
    );
  });

  it('updates an existing MedicationRequest for cancel sync', async () => {
    configureMySLEnv();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { syncMedicationRequestFromPrescription } = await import('../../src/integrations/escript/myslClient');

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({
        entry: [
          { resource: { resourceType: 'Patient', id: 'patient-fhir-2' } },
          { resource: { resourceType: 'Consent', id: 'consent-2' } },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({
        entry: [{ resource: { resourceType: 'MedicationRequest', id: 'mr-existing' } }],
      }))
      .mockResolvedValueOnce(jsonResponse({ resourceType: 'MedicationRequest', id: 'mr-existing' }));

    const out = await syncMedicationRequestFromPrescription({
      patientIhi: '8003609900000002',
      prescriptionId: 'rx-cancel-1',
      medicationRequestResource: { resourceType: 'MedicationRequest', medicationCodeableConcept: { text: 'Olanzapine' } },
      status: 'cancelled',
    });

    expect(out).toMatchObject({
      success: true,
      action: 'updated',
      medicationRequestId: 'mr-existing',
      patientFhirId: 'patient-fhir-2',
    });

    const lastCall = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(lastCall[0]).toBe('https://mysl.test.local/MedicationRequest/mr-existing');
    expect(lastCall[1]?.method).toBe('PUT');
    const body = JSON.parse(String(lastCall[1]?.body)) as Record<string, unknown>;
    expect(body.status).toBe('cancelled');
  });

  it('skips when patient consent is not granted', async () => {
    configureMySLEnv();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { syncMedicationRequestFromPrescription } = await import('../../src/integrations/escript/myslClient');

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({
        entry: [{ resource: { resourceType: 'Patient', id: 'patient-fhir-3' } }],
      }));

    const out = await syncMedicationRequestFromPrescription({
      patientIhi: '8003609900000003',
      prescriptionId: 'rx-skip-1',
      medicationRequestResource: { resourceType: 'MedicationRequest' },
    });

    expect(out).toMatchObject({
      success: false,
      action: 'skipped',
      reason: 'consent_not_granted',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
