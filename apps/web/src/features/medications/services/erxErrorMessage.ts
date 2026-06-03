interface ApiErrorWithCode {
  response?: {
    data?: {
      code?: string;
      error?: string;
      details?: {
        field?: string;
      };
    };
  };
  message?: string;
}

const ERX_SETUP_GUIDANCE =
  'Go to Org Settings -> eRx Setup and complete clinic HPI-O and NPDS Conformance ID before retrying.';

function resolveErxNotConfiguredReason(field?: string): string {
  if (field === 'clinics.hpio') {
    return 'eScript is not configured: clinic HPI-O is missing or invalid.';
  }
  if (field === 'clinics.npds_conformance_id') {
    return 'eScript is not configured: clinic NPDS Conformance ID is missing.';
  }
  return 'eScript is not configured for this clinic.';
}

export function getErxAwareErrorMessage(error: unknown, fallback: string): string {
  const maybe = error as ApiErrorWithCode;
  const code = maybe.response?.data?.code;
  const field = maybe.response?.data?.details?.field;

  if (code === 'ERX_NOT_CONFIGURED') {
    return `${resolveErxNotConfiguredReason(field)} ${ERX_SETUP_GUIDANCE}`;
  }

  return maybe.response?.data?.error ?? maybe.message ?? fallback;
}

