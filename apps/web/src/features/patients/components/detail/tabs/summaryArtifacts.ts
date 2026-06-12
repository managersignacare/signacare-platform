import { apiClient } from '../../../../../shared/services/apiClient';
import type { SummaryNoteRow } from './summaryTabDomain';

export const LONGITUDINAL_SUMMARY_NOTE_TYPE = 'ai_longitudinal_summary';
export const LONGITUDINAL_SUMMARY_NOTE_TITLE = 'AI Longitudinal Summary (Persisted)';

export const CLINICAL_FORMULATION_NOTE_TYPE = 'ai_clinical_formulation';
export const CLINICAL_FORMULATION_NOTE_TITLE = 'AI Clinical Formulation (Persisted)';

export const DIAGNOSIS_SUMMARY_NOTE_TYPE = 'ai_dsm_multiaxial_summary';
export const DIAGNOSIS_SUMMARY_NOTE_TITLE = 'AI DSM Multiaxial Diagnosis Summary (Persisted)';

export interface SummaryArtifactNoteRef {
  id: string | null;
  content: string;
}

export interface SummaryArtifactVersion {
  id: string;
  content: string;
  createdAt: string | null;
  title: string | null;
}

export function extractNoteContent(note: SummaryNoteRow | null | undefined): string {
  if (!note) return '';
  const direct = typeof note.content === 'string' ? note.content : '';
  if (direct.trim()) return direct.trim();
  const fallback = [note.assessmentHtml, note.planHtml, note.bodyHtml]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .join(' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return fallback;
}

function noteSortTimestamp(note: SummaryNoteRow): number {
  const createdTs = new Date(note.createdAt ?? 0).getTime();
  const noteDateTimeTs = new Date(note.noteDateTime ?? 0).getTime();
  const safeCreated = Number.isFinite(createdTs) ? createdTs : 0;
  const safeNoteDateTime = Number.isFinite(noteDateTimeTs) ? noteDateTimeTs : 0;
  return Math.max(safeCreated, safeNoteDateTime);
}

export function listArtifactNotes(
  notes: readonly SummaryNoteRow[],
  noteType: string,
): SummaryArtifactVersion[] {
  return [...notes]
    .filter((note) => (note.noteType ?? '') === noteType && Boolean(note.id))
    .sort((a, b) => {
      const aTs = noteSortTimestamp(a);
      const bTs = noteSortTimestamp(b);
      if (aTs === bTs) {
        return String(a.id ?? '').localeCompare(String(b.id ?? ''));
      }
      return bTs - aTs;
    })
    .map((note) => ({
      id: String(note.id),
      content: extractNoteContent(note),
      createdAt: note.createdAt ?? note.noteDateTime ?? null,
      title: note.title ?? null,
    }));
}

export function findLatestArtifactNote(
  notes: readonly SummaryNoteRow[],
  noteType: string,
): SummaryArtifactNoteRef {
  const hit = listArtifactNotes(notes, noteType)[0];
  return {
    id: hit?.id ?? null,
    content: hit?.content ?? '',
  };
}

export async function upsertSummaryArtifactNote(args: {
  patientId: string;
  noteId: string | null;
  noteType: string;
  title: string;
  content: string;
  createNewVersion?: boolean;
}): Promise<string | null> {
  const payload = {
    title: args.title,
    noteType: args.noteType,
    content: args.content,
    status: 'draft' as const,
    isAiDraft: true,
  };
  if (args.noteId && args.createNewVersion !== true) {
    const response = await apiClient.patch<{ note?: { id?: string } }>(
      `patients/${args.patientId}/notes/${args.noteId}`,
      payload,
    );
    return response.note?.id ?? args.noteId;
  }
  const response = await apiClient.post<{ note?: { id?: string } }>(
    `patients/${args.patientId}/notes`,
    payload,
  );
  return response.note?.id ?? null;
}
