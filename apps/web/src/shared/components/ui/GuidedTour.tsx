import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import CloseIcon from '@mui/icons-material/Close';
import SchoolIcon from '@mui/icons-material/School';
import { Backdrop, Box, Button, Chip, IconButton, Paper, Typography } from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';

interface TourStep {
  title: string;
  description: string;
  target?: string; // CSS selector to highlight
  route?: string;  // navigate to this route
  position?: 'top' | 'bottom' | 'left' | 'right' | 'center';
}

interface TourDef {
  id: string;
  role: string;
  label: string;
  icon: string;
  steps: TourStep[];
}

interface TourPreference {
  neverAutoShow?: boolean;
  hideAutoUntil?: string;
}

const TOUR_PREF_STORAGE_PREFIX = 'signacare-tour-preference:v1:';

function tourPrefKey(userId?: string | null): string {
  return `${TOUR_PREF_STORAGE_PREFIX}${userId ?? 'anon'}`;
}

function readTourPreference(key: string): TourPreference {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as TourPreference;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeTourPreference(key: string, pref: TourPreference): void {
  try {
    localStorage.setItem(key, JSON.stringify(pref));
  } catch {
    // localStorage may be unavailable in privacy-hardened contexts.
  }
}

function isTourAutoSuppressed(pref: TourPreference): boolean {
  if (pref.neverAutoShow) return true;
  if (!pref.hideAutoUntil) return false;
  const untilMs = new Date(pref.hideAutoUntil).getTime();
  return Number.isFinite(untilMs) && untilMs > Date.now();
}

// ── Tour Definitions ──
const TOURS: TourDef[] = [
  {
    id: 'receptionist', role: 'receptionist', label: 'Receptionist Tour', icon: '🏥',
    steps: [
      { title: 'Welcome to Reception', description: 'This tour will guide you through the receptionist workflow — patient check-in, phone triage, SMS reminders, and waitlist management.', position: 'center' },
      { title: 'Dashboard', description: 'Your dashboard shows today\'s key metrics. Switch to the Reception view using the role chips at the top.', route: '/dashboard' },
      { title: 'Patient Check-In', description: 'Go to Admin > Reception in the sidebar. The Check-in tab shows today\'s appointments. Click "Check In" as patients arrive — this sends an automatic notification to the clinician.', route: '/receptionist' },
      { title: 'Phone Triage', description: 'The Phone Triage tab lets you record calls. Search for the patient, set urgency, assign to a clinician, and choose an outcome. "Message Taken" auto-creates a task.', route: '/receptionist' },
      { title: 'SMS Reminders', description: 'The SMS Reminders tab shows tomorrow\'s appointments. Click "Send Reminders" to notify patients with registered phone numbers.', route: '/receptionist' },
      { title: 'Waitlist', description: 'The Waitlist tab shows patients waiting with position numbers, estimated wait times, and priority levels.', route: '/receptionist' },
      { title: 'Tour Complete!', description: 'You now know the receptionist workflow. Check-in patients, manage phone calls, send reminders, and monitor the waitlist — all from one page.', position: 'center' },
    ],
  },
  {
    id: 'clinician', role: 'clinician', label: 'Clinician Tour', icon: '👨‍⚕️',
    steps: [
      { title: 'Welcome, Clinician', description: 'This tour covers your daily workflow — dashboard, patient records, clinical notes, prescribing, and AI tools.', position: 'center' },
      { title: 'Your Dashboard', description: 'KPI cards show appointments, tasks, referrals, messages, and caseload. Sparklines show 7-day trends. Click any card to navigate to that section.', route: '/dashboard' },
      { title: 'Patient List', description: 'The Patients page shows your assigned patients. Search by name or MRN. Click any patient to open their record.', route: '/patients' },
      { title: 'Patient Detail — 19 Tabs', description: 'Each patient has 19 tabs: Summary, Overview, Episodes, Alerts & Plans, Medications, Pathology, Physical Health, Legal, Referrals, Documents, Correspondence, Assessments, 91-Day Review, Pathways, Lived Experience, Tracking, Inpatient Care, ECT, Appointments.', route: '/patients' },
      { title: 'Clinical Formulation', description: 'In the Summary tab, click "Generate with AI" to create a biopsychosocial formulation. The AI uses your local Ollama model — no data leaves the clinic.', route: '/patients' },
      { title: 'Prescribing', description: 'In the Medications tab, click "Prescribe" to add medications. Only staff with a prescriber number can prescribe. The MAR Chart auto-populates from prescriptions.', route: '/patients' },
      { title: 'Voice Memo', description: 'Go to Drafts to record voice memos. Click Start Recording, speak, and the Whisper AI transcribes it. Save as a draft note.', route: '/drafts' },
      { title: 'Tour Complete!', description: 'You\'re ready to use Signacare. Dashboard for overview, patient records for clinical work, AI for documentation assistance.', position: 'center' },
    ],
  },
  {
    id: 'nurse', role: 'nurse', label: 'Nursing Tour', icon: '👩‍⚕️',
    steps: [
      { title: 'Welcome, Nurse', description: 'This tour covers inpatient nursing — observations, NEWS2, falls risk, fluid balance, medication administration, and shift handover.', position: 'center' },
      { title: 'Inpatient Care Tab', description: 'Open any inpatient patient and go to the "Inpatient Care" tab. This has sub-tabs for Observations, NEWS2, Falls Risk, Fluid Balance, Wound Care, Notes, Outcome Measures, and Shift Handover.', route: '/patients' },
      { title: 'Structured Observations', description: 'Select the observation level (15min, 30min, hourly, constant). Enter location, mood, behaviour, sleep, and risk concerns. Click Save.', route: '/patients' },
      { title: 'NEWS2 Calculator', description: 'Adjust sliders for vital signs. The score auto-calculates with colour coding. Scores of 5+ trigger escalation alerts.', route: '/patients' },
      { title: 'MAR Chart', description: 'In the Medications tab > MAR Chart, view today\'s scheduled medications. Click time dots to record administration (Given/Refused/Withheld) with context (Supervised/Self/Inpatient/Community).', route: '/patients' },
      { title: 'Shift Handover', description: 'Go to Clinical Lists > Shift Handover in the sidebar. Write notes for each patient in your caseload. The AI Summary button auto-generates a handover summary. Notes save to each patient\'s record.', route: '/handover' },
      { title: 'Tour Complete!', description: 'You\'re ready for inpatient nursing in Signacare. Observations, assessments, medication admin, and handover — all integrated.', position: 'center' },
    ],
  },
  {
    id: 'case_manager', role: 'case_manager', label: 'Case Manager Tour', icon: '📋',
    steps: [
      { title: 'Welcome, Case Manager', description: 'This tour covers caseload management, care plan goals, recovery outcomes, and community resources.', position: 'center' },
      { title: 'Caseload Dashboard', description: 'Switch to Case Mgmt view on the Dashboard. Your patients are shown with RAG status (Red/Amber/Green). The patient list auto-filters to your assigned patients.', route: '/dashboard' },
      { title: 'Care Plan Goals', description: 'Open a patient > Alerts & Plans > Goals tab. Add goals with type (Personal/Clinical/Social), target date. Track progress by clicking status chips.', route: '/patients' },
      { title: 'Recovery Star', description: 'The Recovery Star tab visualises outcomes across 10 life domains. Adjust sliders from 1-10 and save. Track progress over time.', route: '/patients' },
      { title: 'Community Resources', description: 'Go to Admin > Resources in the sidebar. Search the directory for housing, NDIS, employment, crisis services.', route: '/community-resources' },
      { title: 'Tour Complete!', description: 'You\'re set up for case management. Track your caseload, set goals, measure recovery, and connect patients with community resources.', position: 'center' },
    ],
  },
  {
    id: 'manager', role: 'manager', label: 'Manager Tour', icon: '📊',
    steps: [
      { title: 'Welcome, Manager', description: 'This tour covers the management dashboard, KPI tracking, and the report builder.', position: 'center' },
      { title: 'Manager Dashboard', description: 'Switch to Manager view. See Contacts KPI, Staff Caseload, DNA Rates, Workload Alerts, Service Statistics, and Billing — all broken down by clinician.', route: '/dashboard' },
      { title: 'Admin Reports', description: 'Go to Admin > Admin Reports. Four tabs: Overview, Clinical Activity, Compliance, Workforce. Click AI Summary for an auto-generated narrative.', route: '/reports' },
      { title: 'Report Builder', description: 'The Report Builder tab lets you combine 20 metrics across 7 dimensions. Choose Bar Chart, Donut, Heatmap, or Table. Set custom date ranges. Export CSV or Print/PDF.', route: '/reports' },
      { title: 'Trend Detection', description: 'Every report includes automatic trend detection — variance analysis, outlier identification, and AI-generated insights.', route: '/reports' },
      { title: 'Scheduled Reports', description: 'Set up weekly or monthly auto-generated reports with email delivery in the Scheduled tab.', route: '/reports' },
      { title: 'Tour Complete!', description: 'You now have full visibility into service performance. Use the dashboard for real-time KPIs and the report builder for deep analysis.', position: 'center' },
    ],
  },
  {
    id: 'ect', role: 'clinician', label: 'ECT Module Tour', icon: '⚡',
    steps: [
      { title: 'ECT Module', description: 'This tour covers the ECT workflow — course creation, treatment recording, prescription, consent, assessments, and documents.', position: 'center' },
      { title: 'ECT Tab', description: 'Open any patient and click the ECT tab. The module is organised around ECT courses — each course is a parent container for treatments, prescriptions, and consent.', route: '/patients' },
      { title: 'Creating a Course', description: 'Click "New ECT Course". Enter indication, electrode placement, pulse width, anaesthetic protocol, and clinical team. Click Create.', route: '/patients' },
      { title: 'Recording Treatment', description: 'In the Treatment Log, click "Record Treatment". Complete pre-procedure vitals, stimulus parameters, anaesthesia, seizure response, and recovery. Save.', route: '/patients' },
      { title: 'Prescription (Prescribers Only)', description: 'The Prescription tab requires a prescriber number. Specify setting (inpatient/community), charge strategy, and medication instructions.', route: '/patients' },
      { title: 'Consent & MHA', description: 'Record consent type. For involuntary patients, enter MHA order details, tribunal date, and second opinion. Australian MHA compliance is built in.', route: '/patients' },
      { title: 'Assessments', description: 'Five assessment types: Cognitive (MMSE, MoCA), Pre/Post ECT Nursing (vitals, checks), Pre/Post ECT Medical (MSE, rating scales).', route: '/patients' },
      { title: 'Documents', description: 'Upload consent forms, MHA orders, ECG reports, blood results. 11 document types available.', route: '/patients' },
      { title: 'Tour Complete!', description: 'The ECT module provides comprehensive documentation for the full ECT lifecycle, compliant with RANZCP guidelines and Australian MHA requirements.', position: 'center' },
    ],
  },
];

// ── Tour Overlay Component ──
export function GuidedTourOverlay() {
  const [activeTour, setActiveTour] = useState<TourDef | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [widgetVisible, setWidgetVisible] = useState(true);
  const [forcedOpen, setForcedOpen] = useState(false);

  // Listen for reopen event (from TourTriggerButton or sidebar)
  useEffect(() => {
    const handler = () => {
      setForcedOpen(true);
      setWidgetVisible(true);
    };
    window.addEventListener('reopen-tour', handler);
    return () => window.removeEventListener('reopen-tour', handler);
  }, []);
  const navigate = useNavigate();
  const user = useAuthStore(s => s.user);
  const role = user?.role ?? 'clinician';
  const prefKey = tourPrefKey(user?.id);

  useEffect(() => {
    const pref = readTourPreference(prefKey);
    setWidgetVisible(!isTourAutoSuppressed(pref));
    setForcedOpen(false);
  }, [prefKey]);

  const availableTours = TOURS.filter(t =>
    t.role === role || role === 'superadmin' || role === 'admin' ||
    (role === 'clinician' && ['clinician', 'nurse', 'case_manager', 'ect'].includes(t.role))
  );

  const step = activeTour?.steps[stepIndex];

  const next = useCallback(() => {
    if (!activeTour) return;
    if (stepIndex < activeTour.steps.length - 1) {
      const nextStep = activeTour.steps[stepIndex + 1];
      if (nextStep.route) navigate(nextStep.route);
      setStepIndex(stepIndex + 1);
    } else {
      setActiveTour(null);
      setStepIndex(0);
    }
  }, [activeTour, stepIndex, navigate]);

  const prev = () => {
    if (stepIndex > 0) {
      const prevStep = activeTour!.steps[stepIndex - 1];
      if (prevStep.route) navigate(prevStep.route);
      setStepIndex(stepIndex - 1);
    }
  };

  const close = () => { setActiveTour(null); setStepIndex(0); };

  // Keyboard navigation
  useEffect(() => {
    if (!activeTour) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter') next();
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeTour, next]);

  if (!widgetVisible && !activeTour && !forcedOpen) return null;

  const dismissForever = () => {
    writeTourPreference(prefKey, { neverAutoShow: true });
    setWidgetVisible(false);
    setForcedOpen(false);
  };

  const remindLater = (days: number) => {
    const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    writeTourPreference(prefKey, { hideAutoUntil: until });
    setWidgetVisible(false);
    setForcedOpen(false);
  };

  // Tour selector (when no tour is active)
  if (!activeTour) {
    return (
      <Paper sx={{
        position: 'fixed', bottom: 20, right: 20, zIndex: 1400,
        p: 2, borderRadius: 3, boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
        maxWidth: 300, bgcolor: 'background.paper',
      }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <SchoolIcon sx={{ color: '#327C8D', fontSize: 20 }} />
            <Typography variant="subtitle2" fontWeight={700}>Take a Tour</Typography>
          </Box>
          <IconButton size="small" aria-label="Hide tour auto-pop" onClick={dismissForever}>
            <CloseIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
          Interactive walkthroughs to learn Signacare
        </Typography>
        <Button
          size="small"
          variant="text"
          onClick={() => remindLater(30)}
          sx={{ mb: 1, textTransform: 'none', fontSize: 11, color: 'text.secondary' }}
        >
          Remind me in 30 days
        </Button>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {availableTours.map(tour => (
            <Button key={tour.id} size="small" variant="outlined" fullWidth
              startIcon={<span>{tour.icon}</span>}
              onClick={() => {
                setActiveTour(tour);
                setStepIndex(0);
                if (tour.steps[0]?.route) navigate(tour.steps[0].route);
              }}
              sx={{ justifyContent: 'flex-start', textTransform: 'none', fontSize: 12, fontWeight: 600,
                borderColor: '#327C8D', color: '#327C8D', py: 0.75 }}>
              {tour.label}
            </Button>
          ))}
        </Box>
      </Paper>
    );
  }

  // Active tour step overlay
  return (
    <>
      {/* Backdrop — Shape C: MUI <Backdrop> primitive (BUG-447 child 12/15).
          Click-to-close is the documented click-outside-to-close pattern;
          keyboard-equivalent close is wired by the window-level keydown
          listener at the top of this component (Escape → close()), so the
          backdrop's click is a mouse-only convenience, not the canonical
          close mechanism. <Backdrop> is the canonical MUI primitive for
          this overlay role and is not in the cascade-1 ESLint rule's
          OFFENDING_COMPONENTS set. */}
      <Backdrop open sx={{ zIndex: 1300, bgcolor: 'rgba(0,0,0,0.4)' }} onClick={close} />

      {/* Step card */}
      <Paper sx={{
        position: 'fixed', zIndex: 1400, borderRadius: 3,
        p: 3, maxWidth: 420, width: '90vw',
        boxShadow: '0 12px 48px rgba(0,0,0,0.25)',
        ...(step?.position === 'center' ? { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' } :
          { bottom: 24, right: 24 }),
      }}>
        {/* Progress */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Chip label={`${stepIndex + 1} / ${activeTour.steps.length}`} size="small"
            sx={{ fontSize: 10, height: 20, bgcolor: '#327C8D', color: '#fff', fontWeight: 700 }} />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
              {activeTour.icon} {activeTour.label}
            </Typography>
            <IconButton size="small" aria-label="Close tour step" onClick={close}><CloseIcon sx={{ fontSize: 16 }} /></IconButton>
          </Box>
        </Box>

        {/* Progress bar */}
        <Box sx={{ height: 3, bgcolor: '#eee', borderRadius: 2, mb: 2, overflow: 'hidden' }}>
          <Box sx={{ height: '100%', width: `${((stepIndex + 1) / activeTour.steps.length) * 100}%`, bgcolor: '#327C8D', borderRadius: 2, transition: 'width 0.3s' }} />
        </Box>

        {/* Content */}
        <Typography variant="h6" fontWeight={700} fontFamily="Albert Sans, sans-serif" sx={{ mb: 1, fontSize: 16 }}>
          {step?.title}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5, fontSize: 13, lineHeight: 1.6 }}>
          {step?.description}
        </Typography>

        {/* Navigation */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Button size="small" startIcon={<ArrowBackIcon />} onClick={prev} disabled={stepIndex === 0}
            sx={{ textTransform: 'none', color: 'text.secondary', visibility: stepIndex === 0 ? 'hidden' : 'visible' }}>
            Back
          </Button>
          <Typography variant="caption" color="text.disabled" sx={{ fontSize: 9 }}>
            Arrow keys or click
          </Typography>
          <Button size="small" variant="contained" endIcon={stepIndex < activeTour.steps.length - 1 ? <ArrowForwardIcon /> : undefined}
            onClick={next}
            sx={{ textTransform: 'none', bgcolor: '#327C8D', '&:hover': { bgcolor: '#265f6d' }, fontWeight: 600 }}>
            {stepIndex < activeTour.steps.length - 1 ? 'Next' : 'Finish'}
          </Button>
        </Box>
      </Paper>
    </>
  );
}

// ── Tour Trigger Button (for sidebar or settings) ──
/** Call this to re-open the tour widget after it's been dismissed */
export function reopenTour() {
  window.dispatchEvent(new CustomEvent('reopen-tour'));
}

export function TourTriggerButton() {
  return (
    <Button size="small" startIcon={<SchoolIcon />}
      onClick={() => { reopenTour(); }}
      sx={{ textTransform: 'none', color: '#327C8D', fontSize: 11 }}>
      Take a Tour
    </Button>
  );
}
