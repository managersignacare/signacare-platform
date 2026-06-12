import { fmtDate, type SummaryAlertRow, type SummaryEpisodeRow, type SummaryMedicationRow, type SummaryNoteRow } from './summaryTabDomain';
import { noteTypeLabel } from './summaryNarrative';

interface PatientContextPatient {
  givenName: string;
  familyName: string;
  gender?: string | null;
  dateOfBirth: string;
}

interface BuildPatientClinicalAiContextInput {
  patient: PatientContextPatient;
  age: number;
  episodes: SummaryEpisodeRow[];
  medications: SummaryMedicationRow[];
  activeAlerts: SummaryAlertRow[];
  notes: SummaryNoteRow[];
}

export function buildPatientClinicalAiContext({
  patient,
  age,
  episodes,
  medications,
  activeAlerts,
  notes,
}: BuildPatientClinicalAiContextInput): string {
  const lines: string[] = [];
  lines.push(`Patient: ${patient.givenName} ${patient.familyName}, Age ${age}, Gender: ${patient.gender ?? 'not recorded'}, DOB: ${patient.dateOfBirth}`);
  lines.push('');
  lines.push('EPISODES:');
  if (episodes.length) {
    episodes.forEach((e) => {
      lines.push(`- ${e.title ?? 'Untitled'} (${e.episodeType ?? 'unknown'}) — Status: ${e.status}, Start: ${e.startDate ?? 'unknown'}${e.endDate ? `, End: ${e.endDate}` : ''}`);
      if (e.primaryDiagnosis) lines.push(`  Diagnosis: ${e.primaryDiagnosis}`);
    });
  } else lines.push('- None recorded');

  lines.push('\nCURRENT MEDICATIONS:');
  const active = medications.filter((m) => m.status === 'active');
  if (active.length) active.forEach((m) => lines.push(`- ${m.medicationName} ${m.dose ?? ''} ${m.route ?? ''} ${m.frequency ?? ''} (since ${m.prescribedAt ?? 'unknown'})`));
  else lines.push('- None recorded');

  const ceased = medications.filter((m) => m.status === 'ceased');
  if (ceased.length) {
    lines.push('\nCEASED MEDICATIONS:');
    ceased.slice(0, 10).forEach((m) => lines.push(`- ${m.medicationName} ${m.dose ?? ''} (ceased ${m.ceasedAt ?? 'unknown'}${m.ceasedReason ? ` — ${m.ceasedReason}` : ''})`));
  }

  lines.push('\nACTIVE ALERTS / RISK FLAGS:');
  if (activeAlerts.length) activeAlerts.forEach((a) => lines.push(`- ${a.title} (${a.alertSeverity ?? 'unknown severity'})${a.description ? `: ${a.description}` : ''}`));
  else lines.push('- None');

  const recentNotes = [...notes].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')).slice(0, 10);
  lines.push(`\nRECENT CLINICAL NOTES (${recentNotes.length} of ${notes.length} total):`);
  recentNotes.forEach((n) => {
    const date = n.createdAt ? fmtDate(n.createdAt) : 'unknown';
    lines.push(`\n--- ${noteTypeLabel(n.noteType)} (${date}) by ${n.authorName ?? 'unknown'} ---`);
    if (n.title) lines.push(`Title: ${n.title}`);
    const text = (n.assessmentHtml ?? n.planHtml ?? n.bodyHtml ?? '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
    if (text) lines.push(text.substring(0, 500));
  });
  return lines.join('\n');
}
