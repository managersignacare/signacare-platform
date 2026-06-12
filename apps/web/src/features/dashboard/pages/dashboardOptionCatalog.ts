import type { DashboardViewId } from '@signacare/shared';

export interface DashboardOptionPresentation {
  id: DashboardViewId;
  title: string;
  shortLabel: string;
  description: string;
  path: string;
  persona: string;
  safetyFocus: string;
}

export const DASHBOARD_OPTION_PRESENTATION: Record<
  DashboardViewId,
  DashboardOptionPresentation
> = {
  my_dashboard: {
    id: 'my_dashboard',
    title: 'My Work Cockpit',
    shortLabel: 'My Work',
    description: 'Today-first clinician cockpit for appointments, notes, tasks, results, and urgent safety work.',
    path: '/dashboards/my-work',
    persona: 'Clinicians, psychiatrists, psychologists, nurses, coordinators',
    safetyFocus: 'What is unsafe or due in my workload right now?',
  },
  team_dashboard: {
    id: 'team_dashboard',
    title: 'Team Command Board',
    shortLabel: 'Team Command',
    description: 'Live team-level board for allocation, acuity, SLAs, legal deadlines, monitoring breaches, and flow.',
    path: '/dashboards/team-command',
    persona: 'Managers, team leads, senior clinicians',
    safetyFocus: 'Which team-level risks are unowned, overdue, or capacity constrained?',
  },
  clinician: {
    id: 'clinician',
    title: 'Clinician Signal Board',
    shortLabel: 'Clinical Signals',
    description: 'Focused clinical-signal surface for safety lists, monitoring deadlines, alerts, and patient follow-up.',
    path: '/dashboards/my-work',
    persona: 'Clinicians needing a compact signal-first view',
    safetyFocus: 'Which clinical signals need action before routine work?',
  },
  nurse: {
    id: 'nurse',
    title: 'Nursing Flow Board',
    shortLabel: 'Nursing Flow',
    description: 'Nursing-focused workboard for observations, LAI/depot work, handover, safety plans, and medication tasks.',
    path: '/dashboards/my-work',
    persona: 'Nurses and shift leads',
    safetyFocus: 'Which observations, medications, or handover risks need escalation?',
  },
  case_manager: {
    id: 'case_manager',
    title: 'Care Coordination Board',
    shortLabel: 'Coordination',
    description: 'Caseload and follow-up cockpit for MDT ownership, referrals, appointments, and safety-plan work.',
    path: '/dashboards/my-work',
    persona: 'Care coordinators, social work, OT, case managers',
    safetyFocus: 'Which patients need ownership, contact, or coordination today?',
  },
  receptionist: {
    id: 'receptionist',
    title: 'Front Desk Flow Board',
    shortLabel: 'Front Desk',
    description: 'Reception workflow board for today’s arrivals, triage, booking gaps, contact failures, and documents.',
    path: '/dashboards/my-work',
    persona: 'Reception and administration',
    safetyFocus: 'Which bookings, triage items, or contact failures block care flow?',
  },
  manager: {
    id: 'manager',
    title: 'Manager Command Board',
    shortLabel: 'Manager Command',
    description: 'Governance cockpit for acuity-weighted caseload, SLA breaches, roster gaps, incidents, and team load.',
    path: '/dashboards/manager-command',
    persona: 'Service managers, clinical managers, medical directors',
    safetyFocus: 'What is unsafe at service level, who owns it, and what must happen next?',
  },
};

export function getDashboardOption(viewId: DashboardViewId): DashboardOptionPresentation {
  return DASHBOARD_OPTION_PRESENTATION[viewId];
}
