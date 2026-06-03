import { Alert } from '@mui/material';
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../../../shared/services/apiClient';
import { vivaKeys } from '../../../queryKeys';
import { readStringArrayField, type VivaProfileTrackingRow } from './summaryTabDomain';

interface VivaAlertBannerProps {
  patientId: string;
}

export function VivaAlertBanner({ patientId }: VivaAlertBannerProps) {
  const { data } = useQuery({
    queryKey: vivaKeys.profileAlerts(patientId),
    queryFn: async () => {
      try {
        const r = await apiClient.get<unknown>(`patient-app/tracking/${patientId}`, { type: 'profile', days: '7' });
        return readStringArrayField<VivaProfileTrackingRow>(r, 'entries');
      } catch {
        return [];
      }
    },
    staleTime: 60_000,
  });

  if (!data || data.length === 0) return null;

  const latest = data[0];
  const dt = latest?.recordedAt ? new Date(latest.recordedAt) : null;
  const isRecent = dt && (Date.now() - dt.getTime()) < 7 * 24 * 60 * 60 * 1000;
  if (!isRecent) return null;

  let hasConsentChange = false;
  try {
    const parsed = JSON.parse(latest.note ?? '{}') as { nokConsent?: unknown; supportConsent?: unknown; drugAllergies?: unknown };
    hasConsentChange = Boolean(parsed.nokConsent || parsed.supportConsent || parsed.drugAllergies);
  } catch {
    hasConsentChange = false;
  }

  return (
    <Alert severity={hasConsentChange ? 'warning' : 'info'} sx={{ mb: 2, borderRadius: 2 }} icon={<PhoneAndroidIcon fontSize="small" />}>
      <strong>Viva App Update</strong> — Patient updated their {hasConsentChange ? 'consent preferences / allergies' : 'profile'} via the Viva app
      on {dt!.toLocaleDateString('en-AU')}. Review in the <strong>Viva &gt; Profile &amp; Consent</strong> tab.
    </Alert>
  );
}
