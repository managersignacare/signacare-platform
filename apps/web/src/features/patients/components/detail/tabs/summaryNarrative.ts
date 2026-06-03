import { daysBetween, fmtDate, type SummaryEpisodeRow, type SummaryNoteRow, type SummaryPatientProfile } from './summaryTabDomain';

export const NOTE_TYPE_LABELS: Record<string, string> = {
  progress: 'Progress Note',
  ward_round: 'Ward Round',
  intake: 'Intake Assessment',
  lai: 'LAI Administration',
  clozapine: 'Clozapine Monitoring',
  review: 'Review',
  collateral: 'Collateral Contact',
  phone: 'Phone/Telehealth',
  home_visit: 'Home Visit',
  case_conference: 'Case Conference/MDT',
  group: 'Group Session',
  incident: 'Incident',
  physical_health: 'Physical Health Note',
  consumer_peer_support: 'Consumer Peer Support',
  carer_peer_support: 'Carer Peer Support',
};

export const CLINICAL_TYPES = new Set([
  'progress', 'ward_round', 'intake', 'lai', 'clozapine', 'review',
  'collateral', 'phone', 'home_visit', 'case_conference', 'group',
  'physical_health', 'consumer_peer_support', 'carer_peer_support',
]);

export const TYPE_COLORS: Record<string, string> = {
  progress: '#327C8D',
  ward_round: '#5C6BC0',
  intake: '#b8621a',
  lai: '#D32F2F',
  clozapine: '#7B1FA2',
  review: '#0288D1',
  collateral: '#455A64',
  phone: '#00838F',
  home_visit: '#558B2F',
  case_conference: '#E65100',
  group: '#AD1457',
  incident: '#B71C1C',
  physical_health: '#2E7D32',
  consumer_peer_support: '#6A1B9A',
  carer_peer_support: '#AD1457',
};

export function noteTypeLabel(noteType: string | null | undefined): string {
  return NOTE_TYPE_LABELS[noteType ?? ''] ?? noteType ?? 'Note';
}

export function buildNarrative(
  notes: SummaryNoteRow[],
  episodes: SummaryEpisodeRow[],
  patient: SummaryPatientProfile,
): string {
  const enc = notes.filter((n) => CLINICAL_TYPES.has(n.noteType ?? '') && n.status !== 'draft');
  if (!enc.length) return 'No clinical encounters recorded since referral.';

  const sorted = [...enc].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  if (sorted.length === 0) return 'No clinical encounters recorded since referral.';
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const firstAt = first.createdAt ?? new Date().toISOString();
  const lastAt = last.createdAt ?? firstAt;
  const totalDays = daysBetween(firstAt, lastAt);
  const weeks = Math.round(totalDays / 7);

  const byType: Record<string, number> = {};
  let dnaCount = 0;
  let reportable = 0;
  const clinicians = new Set<string>();

  for (const n of enc) {
    const noteType = n.noteType ?? 'unknown';
    byType[noteType] = (byType[noteType] ?? 0) + 1;
    if (n.didNotAttend) dnaCount++;
    if (n.isReportableContact) reportable++;
    if (n.authorName) clinicians.add(n.authorName);
  }

  const topTypes = Object.entries(byType)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([t, c]) => `${NOTE_TYPE_LABELS[t] ?? t} (${c})`)
    .join(', ');

  const activeEpisodes = (episodes ?? []).filter((e) => e.status === 'open');
  const episodeStr = activeEpisodes.length
    ? activeEpisodes.map((e) => e.title ?? 'Untitled').join('; ')
    : 'no active episode';

  const lines: string[] = [];
  lines.push(`${patient.givenName} ${patient.familyName} has been receiving care at this clinic for ${weeks > 0 ? `${weeks} weeks` : `${totalDays} days`}, since initial contact on ${fmtDate(firstAt)}.`);
  lines.push('');
  lines.push(`Over this period, ${enc.length} clinical encounter${enc.length !== 1 ? 's' : ''} have been recorded, comprising ${topTypes}.`);
  lines.push(`Of these, ${reportable} contact${reportable !== 1 ? 's' : ''} ${reportable !== 1 ? 'were' : 'was'} ABF-reportable (patient present, clinically meaningful contact).${dnaCount > 0 ? ` ${dnaCount} DNA (did not attend).` : ''}`);
  lines.push('');
  lines.push(`Current episode(s): ${episodeStr}.`);
  if (byType.lai) lines.push(`LAI administration has been provided on ${byType.lai} occasion${byType.lai > 1 ? 's' : ''}, reflecting depot antipsychotic management.`);
  if (byType.clozapine) lines.push(`Clozapine monitoring contacts number ${byType.clozapine}, indicating ongoing REMS-compliant clozapine therapy.`);
  if (byType.collateral) lines.push(`${byType.collateral} collateral contact${byType.collateral > 1 ? 's' : ''} recorded with family/carers/external providers.`);
  if (byType.consumer_peer_support) lines.push(`Consumer peer support provided on ${byType.consumer_peer_support} occasion${byType.consumer_peer_support > 1 ? 's' : ''}, reflecting lived experience engagement with the consumer.`);
  if (byType.carer_peer_support) lines.push(`Carer peer support provided on ${byType.carer_peer_support} occasion${byType.carer_peer_support > 1 ? 's' : ''}, reflecting lived experience engagement with the carer.`);
  if (byType.case_conference) lines.push(`${byType.case_conference} MDT/case conference${byType.case_conference > 1 ? 's' : ''} coordinated care across the multidisciplinary team.`);
  if (clinicians.size > 0) lines.push(`Care has been provided by ${clinicians.size} clinician${clinicians.size > 1 ? 's' : ''}: ${Array.from(clinicians).join(', ')}.`);
  lines.push('');
  lines.push(`Most recent contact: ${fmtDate(lastAt)} — ${NOTE_TYPE_LABELS[last.noteType ?? ''] ?? last.noteType ?? 'Note'}${last.title ? ` (${last.title})` : ''}.`);

  return lines.join('\n');
}
