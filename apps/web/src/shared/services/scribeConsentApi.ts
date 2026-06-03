import { apiClient } from './apiClient';

export type ScribeConsentMode = 'patient_esignature' | 'clinician_attestation';

interface ScribeConsentModeResponse {
  mode: ScribeConsentMode;
}

interface ScribeConsentCreateResponse {
  id: string;
}

interface CreateAmbientConsentOptions {
  sessionId?: string;
  clinicianAttestationText?: string;
}

const DEFAULT_CLINICIAN_ATTESTATION =
  'Patient verbally consented to ambient clinical recording for documentation purposes.';

export async function createAmbientRecordingConsent(
  patientId: string,
  opts: CreateAmbientConsentOptions = {},
): Promise<string> {
  const { data: modeData } = await apiClient.instance.get<ScribeConsentModeResponse>('scribe/consent/mode');
  const mode = modeData?.mode ?? 'clinician_attestation';

  if (mode === 'patient_esignature') {
    throw new Error(
      'Clinic consent mode is patient e-signature. Use the e-signature consent workflow before ambient recording.',
    );
  }

  const sessionId = opts.sessionId ?? `ambient-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const clinicianAttestationText = opts.clinicianAttestationText ?? DEFAULT_CLINICIAN_ATTESTATION;

  const { data } = await apiClient.instance.post<ScribeConsentCreateResponse>('scribe/consent', {
    patientId,
    sessionId,
    mode: 'clinician_attestation',
    clinicianAttestationText,
  });

  if (!data?.id) {
    throw new Error('Consent creation did not return an id');
  }

  return data.id;
}

