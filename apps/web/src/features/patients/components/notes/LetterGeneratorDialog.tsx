import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import PrintIcon from '@mui/icons-material/Print';
import SendIcon from '@mui/icons-material/Send';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
import { apiClient } from '../../../../shared/services/apiClient';
import { useAuthStore } from '../../../../shared/store/authStore';
import { escapeHtml } from '../../../../shared/utils/escapeHtml';
import { ContactFormDialog } from './ContactFormDialog';
import { correspondenceKeys, patientReferralsKeys, patientsKeys } from '../../queryKeys';
import type {
  ClinicLetterProfile,
  DiagnosisLetterRow,
  LetterDataResponse,
  LlmLetterResponse,
  MedicationLetterRow,
  NoteCreateResponse,
  PatientLetterProfile,
  ProviderLetterRow,
} from './AddNoteDialogSupport';

const RECIPIENT_CONFIG: Record<string, { label: string; color: string; aiPrompt: string }> = {
  provider: {
    label: 'Provider (GP / Specialist)',
    color: '#327C8D',
    aiPrompt:
      "Generate a formal clinical letter to the patient's GP/referring provider. ALWAYS include: current diagnoses (DO NOT include ICD codes), current medications with doses, any medication changes made during this consultation, clinical findings, treatment plan and recommendations, follow-up instructions. Use professional medical terminology. Do NOT include any letterhead, date, addresses, or sign-off — those are added automatically.",
  },
  patient: {
    label: 'Patient',
    color: '#b8621a',
    aiPrompt:
      'Generate a patient-friendly letter summarising this consultation. Use simple, clear language avoiding medical jargon. Include: what was discussed, any changes to treatment, what to do next, when to come back. Do NOT include letterhead, date, addresses, or sign-off — those are added automatically.',
  },
  support_person: {
    label: 'Support Person / Carer',
    color: '#7B1FA2',
    aiPrompt:
      'Generate a letter to the patient\'s support person or carer. Include: a summary of the consultation, any changes to care, how they can support the patient, warning signs to watch for. Use accessible language. Do NOT include letterhead, date, addresses, or sign-off — those are added automatically.',
  },
};

export interface LetterGeneratorDialogProps {
  open: boolean;
  onClose: () => void;
  patientId: string;
  noteContent: string;
  noteTitle: string;
  recipientType: 'provider' | 'patient' | 'support_person';
  episodeId: string;
  onSaved: () => void;
}

export function LetterGeneratorDialog({
  open,
  onClose,
  patientId,
  noteContent,
  noteTitle,
  recipientType,
  episodeId,
  onSaved,
}: LetterGeneratorDialogProps) {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [letterBody, setLetterBody] = useState('');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [sendError, setSendError] = useState('');
  const [sendMethod] = useState<'email' | 'post'>('email');

  const config = RECIPIENT_CONFIG[recipientType] ?? RECIPIENT_CONFIG.provider;
  const clinicianName = user ? `${user.givenName} ${user.familyName}` : '[Clinician Name]';

  const { data: letterData } = useQuery<LetterDataResponse>({
    queryKey: patientsKeys.letterData(patientId),
    queryFn: async (): Promise<LetterDataResponse> => {
      const [patient, meds, diagnoses, clinic, providers] = await Promise.all([
        apiClient
          .get<{ data?: PatientLetterProfile } | PatientLetterProfile>(`patients/${patientId}`)
          // intentional silent — letter dialog falls back to placeholder identity values
          .catch(() => null),
        apiClient
          .get<{ data?: MedicationLetterRow[] } | MedicationLetterRow[]>(
            `medications/patients/${patientId}/medications`,
          )
          // intentional silent — medications are optional in letter draft generation
          .catch(() => []),
        apiClient
          .get<{ data?: DiagnosisLetterRow[] } | DiagnosisLetterRow[]>(`patients/${patientId}/diagnoses`)
          .catch(() => ({ data: [] })),
        apiClient
          .get<{ data?: ClinicLetterProfile } | ClinicLetterProfile>('clinics/current')
          // intentional silent — clinic branding falls back to default org identity
          .catch(() => null),
        apiClient
          .get<{ providers?: ProviderLetterRow[]; data?: ProviderLetterRow[] } | ProviderLetterRow[]>(
            `patients/${patientId}/providers`,
          )
          .catch(() => ({ providers: [], data: [] })),
      ]);

      const patientRow: PatientLetterProfile | null =
        patient != null && typeof patient === 'object' && 'data' in patient
          ? patient.data ?? null
          : (patient as PatientLetterProfile | null);
      const clinicRow: ClinicLetterProfile | null =
        clinic != null && typeof clinic === 'object' && 'data' in clinic
          ? clinic.data ?? null
          : (clinic as ClinicLetterProfile | null);
      const providerRows: ProviderLetterRow[] = Array.isArray(providers)
        ? providers
        : providers.providers ?? providers.data ?? [];

      return {
        patient: patientRow,
        medications: Array.isArray(meds) ? meds : meds?.data ?? [],
        diagnoses: Array.isArray(diagnoses) ? diagnoses : diagnoses?.data ?? [],
        clinic: clinicRow,
        providers: providerRows,
      };
    },
    enabled: open,
  });

  const p = letterData?.patient;
  const clinic = letterData?.clinic;
  const patientName = p ? `${p.givenName ?? p.given_name ?? ''} ${p.familyName ?? p.family_name ?? ''}`.trim() : 'Patient';
  const patientDob = p?.dateOfBirth ?? p?.date_of_birth ?? 'Unknown';
  const patientUr = p?.emrNumber ?? p?.emr_number ?? 'Unknown';
  const todayDate = new Date().toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const allProviders = letterData?.providers ?? [];
  const gp = allProviders.find((pr) => pr.providerType === 'gp' || pr.provider_type === 'gp');
  const otherProviders = allProviders.filter((pr) => (pr.providerType ?? pr.provider_type) !== 'gp');
  const recipientName =
    recipientType === 'provider'
      ? gp?.name ?? gp?.providerName ?? gp?.provider_name ?? '[Provider Name]'
      : recipientType === 'patient'
        ? patientName
        : p?.emergencyContactName ??
          p?.emergency_contact_name ??
          p?.nokName ??
          p?.nok_name ??
          '[Support Person]';
  const recipientEmail =
    recipientType === 'provider'
      ? gp?.email ?? gp?.providerEmail ?? gp?.provider_email ?? ''
      : recipientType === 'patient'
        ? p?.email ?? p?.emailPrimary ?? p?.email_primary ?? ''
        : '';
  const ccProviders =
    recipientType === 'provider'
      ? otherProviders
          .map((pr) => ({
            name: pr.name ?? pr.providerName ?? pr.provider_name ?? '',
            email: pr.email ?? pr.providerEmail ?? pr.provider_email ?? '',
          }))
          .filter((pr) => pr.name)
      : [];

  const orgName = clinic?.name ?? 'Signacare Mental Health';
  const orgAddress = clinic?.address ?? '';
  const orgPhone = clinic?.phone ?? '';
  const orgEmail = clinic?.email ?? '';

  const buildFullLetter = (body: string) => {
    const lines = [
      orgName.toUpperCase(),
      orgAddress,
      orgPhone ? `Phone: ${orgPhone}` : '',
      orgEmail ? `Email: ${orgEmail}` : '',
      '',
      todayDate,
      '',
      recipientName,
      '',
      `Re: ${patientName}, DOB: ${patientDob}, UR: ${patientUr}`,
      '',
      `Dear ${recipientName},`,
      '',
      body,
      '',
      'Kindly do not hesitate to contact us for any clarifications.',
      '',
      'Thank you.',
      '',
      'Yours sincerely,',
      clinicianName,
      orgName,
      ...(ccProviders.length > 0
        ? ['', 'CC:', ...ccProviders.map((pr) => `  ${pr.name}`)]
        : []),
    ].filter((l) => l !== undefined);
    return lines.join('\n');
  };

  const generateLetter = async () => {
    setGenerating(true);
    setSendError('');
    try {
      const medsText =
        (letterData?.medications ?? [])
          .filter((m) => m.status === 'active')
          .map((m) => `- ${m.medicationName ?? m.drug_label ?? 'Unknown'} ${m.dose ?? ''} ${m.frequency ?? ''}`)
          .join('\n') || 'No current medications recorded';
      const diagText =
        (letterData?.diagnoses ?? [])
          .map((d) => `- ${d.description ?? d.name ?? 'Unknown'}`)
          .join('\n') || 'No diagnoses recorded';

      const promptData = [
        `Letter to: ${config.label}`,
        `Patient: ${patientName}`,
        '',
        '--- CURRENT DIAGNOSES ---',
        diagText,
        '',
        '--- CURRENT MEDICATIONS ---',
        medsText,
        '',
        '--- CONSULTATION NOTES ---',
        `Title: ${noteTitle}`,
        noteContent,
        '',
        '--- INSTRUCTIONS ---',
        config.aiPrompt,
        'Generate ONLY the letter body content. Do NOT include letterhead, date, address, Re: line, Dear, or sign-off.',
      ].join('\n');

      const resp = await apiClient.instance.post<LlmLetterResponse>(
        'llm/clinical-ai',
        {
          action: 'letter',
          data: promptData,
          patientId,
          enhance: false,
        },
        { timeout: 120_000 },
      );

      const body =
        resp.data?.result ??
        `I am writing to provide an update following the recent consultation on ${todayDate}.\n\n${noteContent}`;
      setLetterBody(body);
    } catch {
      setLetterBody(
        `I am writing to provide an update following the recent consultation on ${todayDate}.\n\n${noteContent}`,
      );
    }
    setGenerating(false);
  };

  React.useEffect(() => {
    if (open && !letterBody && !generating) generateLetter();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const fullLetter = buildFullLetter(letterBody);

  const saveLetter = async () => {
    setSaving(true);
    setSendError('');
    try {
      const noteResult = await apiClient.post<NoteCreateResponse>(`patients/${patientId}/notes`, {
        title: `Letter to ${config.label} — ${noteTitle}`,
        noteType: 'letter',
        content: fullLetter,
        status: 'signed',
        episodeId: episodeId || undefined,
        isReportableContact: true,
        contactMeta: {
          contactDate: todayDate,
          letterType: recipientType,
          recipientType: config.label,
          sendMethod,
        },
      });
      await apiClient
        .post('correspondence/letters', {
          patientId,
          episodeId: episodeId || undefined,
          clinicalNoteId: noteResult?.note?.id ?? noteResult?.id ?? undefined,
          recipientName,
          recipientEmail: recipientEmail || undefined,
          letterType: recipientType,
          subject: `Letter to ${config.label} — ${noteTitle}`,
          body: fullLetter,
          sentVia: sendMethod,
        })
        // intentional silent — clinical note remains the source-of-truth if correspondence mirror write fails
        .catch(() => null);
      qc.invalidateQueries({ queryKey: patientsKeys.notes(patientId) });
      qc.invalidateQueries({ queryKey: correspondenceKeys.byPatient(patientId) });
      setSaved(true);
      setContactOpen(true);
    } catch {
      setSendError('Failed to save letter');
    }
    setSaving(false);
  };

  const handleEmail = async () => {
    if (!recipientEmail) {
      setSendError(
        `No email address found for ${recipientName}. Please add their email in the patient record or select Post instead.`,
      );
      return;
    }
    await saveLetter();
    try {
      await apiClient.post('messages/send-email', {
        to: recipientEmail,
        subject: `Re: ${patientName} — Clinical Correspondence`,
        body: fullLetter,
        patientId,
      });
    } catch {
      setSendError(
        `Letter saved but email delivery failed. The recipient email (${recipientEmail}) may need to be verified. You can resend from the Correspondence tab.`,
      );
    }
  };

  const handlePost = () => {
    saveLetter();
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(
        `<html><head><title>Letter — ${escapeHtml(patientName)}</title>
        <style>body{font-family:Georgia,serif;font-size:12pt;line-height:1.6;margin:40px 60px;white-space:pre-wrap;}
        @media print{body{margin:20mm 25mm;}}</style></head>
        <body>${escapeHtml(fullLetter).replace(/\n/g, '<br>')}</body></html>`,
      );
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
    }
  };

  return (
    <>
      <Dialog aria-labelledby="dialog-title" open={open && !contactOpen} onClose={onClose} maxWidth="md" fullWidth>
        <DialogTitle id="dialog-title" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1, pb: 0 }}>
          <MailOutlineIcon sx={{ color: config.color }} /> Generate Letter — {config.label}
        </DialogTitle>
        <Typography variant="caption" color="text.secondary" sx={{ px: 3, pb: 1 }}>
          To: {recipientName} {recipientEmail ? `(${recipientEmail})` : '— no email on file'}
        </Typography>
        <Divider />
        <DialogContent sx={{ p: 0 }}>
          {generating ? (
            <Box sx={{ py: 6, textAlign: 'center' }}>
              <CircularProgress role="progressbar" aria-label="Loading" sx={{ color: config.color, mb: 2 }} />
              <Typography variant="body2" color="text.secondary">
                Generating letter with AI...
              </Typography>
            </Box>
          ) : (
            <Box sx={{ p: 3 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  Edit the letter body below. Letterhead and sign-off are added automatically.
                </Typography>
                <Button
                  size="small"
                  startIcon={<AutoAwesomeIcon />}
                  onClick={generateLetter}
                  sx={{ textTransform: 'none', fontSize: 11, color: config.color }}
                >
                  Regenerate
                </Button>
              </Box>
              <Paper variant="outlined" sx={{ p: 3, bgcolor: '#FAFAFA', fontFamily: 'Georgia, serif', fontSize: 12 }}>
                <Typography sx={{ fontWeight: 700, fontFamily: 'Georgia, serif', fontSize: 14, mb: 0.25 }}>
                  {orgName.toUpperCase()}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{ fontFamily: 'Georgia, serif', display: 'block', color: 'text.secondary', lineHeight: 1.3 }}
                >
                  {orgAddress}
                  {orgPhone ? ` | ${orgPhone}` : ''}
                  {orgEmail ? ` | ${orgEmail}` : ''}
                </Typography>
                <Divider sx={{ my: 1.5 }} />
                <Typography variant="body2" sx={{ fontFamily: 'Georgia, serif', mb: 1 }}>
                  {todayDate}
                </Typography>
                <Typography variant="body2" sx={{ fontFamily: 'Georgia, serif', mb: 1 }}>
                  {recipientName}
                </Typography>
                <Typography variant="body2" sx={{ fontFamily: 'Georgia, serif', fontWeight: 600, mb: 1.5 }}>
                  Re: {patientName}, DOB: {patientDob}, UR: {patientUr}
                </Typography>
                <Typography variant="body2" sx={{ fontFamily: 'Georgia, serif', mb: 1 }}>
                  Dear {recipientName},
                </Typography>
                <TextField
                  fullWidth
                  multiline
                  value={letterBody}
                  onChange={(e) => setLetterBody(e.target.value)}
                  variant="standard"
                  InputProps={{ disableUnderline: true }}
                  sx={{ '& .MuiInputBase-input': { fontFamily: 'Georgia, serif', fontSize: 13, lineHeight: 1.6 } }}
                />
                <Box sx={{ mt: 2, fontFamily: 'Georgia, serif', fontSize: 13 }}>
                  <Typography variant="body2" sx={{ fontFamily: 'Georgia, serif' }}>
                    Kindly do not hesitate to contact us for any clarifications.
                  </Typography>
                  <Typography variant="body2" sx={{ fontFamily: 'Georgia, serif', mt: 1 }}>
                    Thank you.
                  </Typography>
                  <Typography variant="body2" sx={{ fontFamily: 'Georgia, serif', mt: 1.5 }}>
                    Yours sincerely,
                  </Typography>
                  <Typography variant="body2" sx={{ fontFamily: 'Georgia, serif', fontWeight: 600, mt: 0.5 }}>
                    {clinicianName}
                  </Typography>
                  <Typography variant="body2" sx={{ fontFamily: 'Georgia, serif', color: 'text.secondary' }}>
                    {orgName}
                  </Typography>
                  {ccProviders.length > 0 && (
                    <Box sx={{ mt: 2, pt: 1, borderTop: '1px solid #ddd' }}>
                      <Typography variant="caption" fontWeight={700} sx={{ fontFamily: 'Georgia, serif' }}>
                        CC:
                      </Typography>
                      {ccProviders.map((pr, i) => (
                        <Typography
                          key={i}
                          variant="caption"
                          sx={{ fontFamily: 'Georgia, serif', display: 'block', pl: 1 }}
                        >
                          {pr.name}
                          {pr.email ? ` (${pr.email})` : ''}
                        </Typography>
                      ))}
                    </Box>
                  )}
                </Box>
              </Paper>
            </Box>
          )}
        </DialogContent>
        {sendError && (
          <Alert role="alert" severity="warning" sx={{ mx: 3, mb: 1, fontSize: 11 }} onClose={() => setSendError('')}>
            {sendError}
          </Alert>
        )}
        {saved && (
          <Alert severity="success" sx={{ mx: 3, mb: 1, fontSize: 11 }}>
            Letter saved to patient record
          </Alert>
        )}
        <Divider />
        <DialogActions sx={{ px: 3, py: 2, justifyContent: 'space-between' }}>
          <Button onClick={onClose} sx={{ color: 'text.secondary' }}>
            Cancel
          </Button>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              variant="contained"
              onClick={saveLetter}
              disabled={saving || !letterBody.trim() || generating}
              sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#265f6d' }, textTransform: 'none' }}
            >
              {saving ? <CircularProgress role="progressbar" aria-label="Loading" size={16} sx={{ color: '#fff' }} /> : 'Save Letter'}
            </Button>
            <Button
              variant="outlined"
              startIcon={<PrintIcon />}
              onClick={handlePost}
              disabled={saving || !letterBody.trim() || generating}
              sx={{ textTransform: 'none', borderColor: '#3D484B', color: '#3D484B' }}
            >
              Print / Post
            </Button>
            <Button
              variant="outlined"
              startIcon={<SendIcon />}
              onClick={handleEmail}
              disabled={saving || !letterBody.trim() || generating}
              sx={{ textTransform: 'none', borderColor: config.color, color: config.color }}
            >
              Email
            </Button>
          </Box>
        </DialogActions>
      </Dialog>

      <ContactFormDialog
        open={contactOpen}
        patientId={patientId}
        onClose={() => {
          setContactOpen(false);
          onSaved();
          onClose();
        }}
        onSaved={() => {
          setContactOpen(false);
          qc.invalidateQueries({ queryKey: patientReferralsKeys.unifiedContacts(patientId) });
          onSaved();
          onClose();
        }}
        initialNoteType="letter"
        initialNoteTitle={`Letter to ${config.label}`}
        initialEpisodeId={episodeId}
      />
    </>
  );
}
