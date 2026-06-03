import { Box, Chip, Paper, Typography } from '@mui/material';

export interface PromptGroupDef {
  title: string;
  color: string;
  prompts: string[];
  clinicWideAnalytics: boolean;
}

const ALL_PROMPT_GROUPS: PromptGroupDef[] = [
  { title: 'Organisation', color: '#b8621a', prompts: ['Organisation statistics', 'Service overview', 'How many patients total?'], clinicWideAnalytics: true },
  { title: 'Team Caseload', color: '#327C8D', prompts: ['Team caseload', 'Compare two teams', 'Team patient count', 'Team staff roster'], clinicWideAnalytics: true },
  { title: 'Staff', color: '#7B1FA2', prompts: ['Staff workload', 'How busy is this staff member?', 'Staff workload summary', 'List all staff'], clinicWideAnalytics: true },
  { title: 'Overdue', color: '#D32F2F', prompts: ['Overdue 91-day reviews', 'Upcoming tribunal hearings', 'Pending assessments', 'List all legal orders'], clinicWideAnalytics: true },
  { title: 'Referrals', color: '#00838F', prompts: ['Referral metrics', 'Referral SLA compliance', 'Waitlist metrics'], clinicWideAnalytics: true },
  { title: 'Appointments', color: '#1565C0', prompts: ['Appointment metrics', 'DNA / no-show rate', 'ABF clinical activity', 'Clinical activity for selected team'], clinicWideAnalytics: true },
  { title: 'Inpatient', color: '#6A1B9A', prompts: ['Bed occupancy', 'Discharge metrics', 'Avg length of stay'], clinicWideAnalytics: true },
  { title: 'Medications', color: '#E65100', prompts: ['Medication metrics', 'Clozapine patients', 'LAI patient count', 'Polypharmacy count'], clinicWideAnalytics: true },
  { title: 'Risk', color: '#B71C1C', prompts: ['Risk overview', 'High risk patients', 'Unassessed patients'], clinicWideAnalytics: true },
  { title: 'Tasks', color: '#AD1457', prompts: ['Task metrics', 'Overdue tasks by staff', 'Unsigned clinical notes'], clinicWideAnalytics: true },
  { title: 'Patient (select first)', color: '#2E7D32', prompts: ['Patient clinical summary', 'What medications?', 'List alerts'], clinicWideAnalytics: false },
  { title: 'Drug Interactions', color: '#3D484B', prompts: ['Check interactions between lithium and olanzapine', 'Check interactions between clozapine and fluvoxamine'], clinicWideAnalytics: false },
];

function isClinicWideRestrictedRole(role: string | undefined): boolean {
  return (role ?? '').trim().toLowerCase() === 'clinician';
}

export function getPromptGroupsForRole(role: string | undefined): PromptGroupDef[] {
  if (!isClinicWideRestrictedRole(role)) return ALL_PROMPT_GROUPS;
  return ALL_PROMPT_GROUPS.filter((group) => !group.clinicWideAnalytics);
}

export function getQuickPromptsForRole(role: string | undefined): string[] {
  if (!isClinicWideRestrictedRole(role)) {
    return [
      'Organisation statistics',
      'Team caseload',
      'Overdue 91-day reviews',
      'Referral metrics',
      'Appointment metrics',
      'ABF clinical activity',
      'Bed occupancy',
      'Risk overview',
      'List all staff',
      'Task metrics',
      'Medication metrics',
      'Waitlist metrics',
    ];
  }
  return [
    'Patient clinical summary',
    'What medications?',
    'List alerts',
    'Check interactions between lithium and olanzapine',
  ];
}

interface PromptGroupProps {
  title: string;
  color: string;
  prompts: string[];
  onSelect: (q: string) => void;
}

export function PromptGroup({ title, color, prompts, onSelect }: PromptGroupProps) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, height: '100%', borderColor: `${color}40` }}>
      <Typography variant="caption" fontWeight={700} sx={{ color, display: 'block', mb: 1, textTransform: 'uppercase', fontSize: 10, letterSpacing: 0.5 }}>
        {title}
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {prompts.map((q) => (
          <Chip
            key={q}
            label={q}
            variant="outlined"
            size="small"
            onClick={() => onSelect(q)}
            sx={{
              cursor: 'pointer',
              justifyContent: 'flex-start',
              height: 'auto',
              py: 0.3,
              '& .MuiChip-label': { whiteSpace: 'normal', fontSize: 11, lineHeight: 1.4 },
              '&:hover': { bgcolor: `${color}10`, borderColor: color },
            }}
          />
        ))}
      </Box>
    </Paper>
  );
}
