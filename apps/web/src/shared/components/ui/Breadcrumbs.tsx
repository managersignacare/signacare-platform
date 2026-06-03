import HomeIcon from '@mui/icons-material/Home';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import { Box, Breadcrumbs as MuiBreadcrumbs, Link, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiClient } from '../../services/apiClient';
import { sharedBreadcrumbsKeys } from '../../queryKeys';

const ROUTE_LABELS: Record<string, string> = {
  dashboard: 'Dashboard', patients: 'Patients', appointments: 'Appointments',
  referrals: 'Intake', settings: 'Settings', templates: 'Templates',
  'org-settings': 'Org Settings', 'staff-assignments': 'Staff', billing: 'Billing',
  tasks: 'Tasks', reports: 'Admin Reports', audit: 'Audit Log',
  'ai-agent': 'AI Assistant', exports: 'Data Exports', subscription: 'Subscription',
  'agentic-scribe': 'Agentic Scribe',
  'power-settings': 'Power Settings', list: 'Lists', episodes: 'Episodes',
  medications: 'Medications',
};

const LIST_LABELS: Record<string, string> = {
  lai: 'LAI List', mha: 'MH Act List', clozapine: 'Clozapine List',
  referrals: 'Referral List', acis: 'ACIS', parc: 'PARC',
  ccu: 'CCU', ipu: 'IPU', op: 'Outpatients', group: 'Group Program',
  '91day': '91-Day Review', hotspots: 'Hot Spots', 'cloz-support': 'Clozapine Support',
};

interface PatientBreadcrumbRow {
  givenName?: string;
  familyName?: string;
  given_name?: string;
  family_name?: string;
}

function formatPatientBreadcrumbName(patient: PatientBreadcrumbRow | undefined): string {
  if (!patient) return 'Patient';
  const given = patient.givenName ?? patient.given_name ?? '';
  const family = patient.familyName ?? patient.family_name ?? '';
  const fullName = `${given} ${family}`.trim();
  return fullName || 'Patient';
}

export function AppBreadcrumbs() {
  const location = useLocation();
  const navigate = useNavigate();

  const segments = location.pathname.split('/').filter(Boolean);

  // Determine patient ID before any hooks (Rules of Hooks: no conditional hooks)
  const patientId = segments[0] === 'patients' && segments[1] && segments[1].length > 10 ? segments[1] : null;

  const { data: patient } = useQuery({
    queryKey: sharedBreadcrumbsKeys.patient(patientId ?? ''),
    queryFn: () => apiClient.get<PatientBreadcrumbRow>(`patients/${patientId}`),
    enabled: !!patientId,
    staleTime: 60_000,
  });

  // Now safe to early-return after all hooks
  if (segments.length <= 1 && segments[0] === 'dashboard') return null;
  if (!segments.length) return null;

  const crumbs: { label: string; path: string }[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const path = '/' + segments.slice(0, i + 1).join('/');

    if (seg === 'list' && segments[i + 1]) {
      crumbs.push({ label: LIST_LABELS[segments[i + 1]] ?? segments[i + 1], path: path + '/' + segments[i + 1] });
      i++;
    } else if (i === 1 && segments[0] === 'patients' && seg.length > 10) {
      crumbs.push({ label: formatPatientBreadcrumbName(patient), path });
    } else if (i === 1 && segments[0] === 'episodes' && seg.length > 10) {
      crumbs.push({ label: 'Episode Detail', path });
    } else {
      crumbs.push({ label: ROUTE_LABELS[seg] ?? seg.charAt(0).toUpperCase() + seg.slice(1), path });
    }
  }

  return (
    <Box sx={{ px: { xs: 2, md: 3 }, pt: 1.5, pb: 0.5 }}>
      <MuiBreadcrumbs aria-label="Breadcrumb" separator={<NavigateNextIcon sx={{ fontSize: 14, color: 'text.disabled' }} />} sx={{ '& .MuiBreadcrumbs-li': { fontSize: 13 } }}>
        <Link underline="hover" onClick={() => navigate('/dashboard')}
          sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', color: 'text.secondary', fontSize: 13 }}>
          <HomeIcon sx={{ fontSize: 16 }} /> Home
        </Link>
        {crumbs.map((c, i) => {
          const isLast = i === crumbs.length - 1;
          return isLast ? (
            <Typography key={c.path} variant="body2" fontWeight={600} aria-current="page" sx={{ fontSize: 13, color: 'text.primary' }}>{c.label}</Typography>
          ) : (
            <Link key={c.path} underline="hover" onClick={() => navigate(c.path)}
              sx={{ cursor: 'pointer', color: 'text.secondary', fontSize: 13 }}>{c.label}</Link>
          );
        })}
      </MuiBreadcrumbs>
    </Box>
  );
}
