/**
 * Clinical notes (clinical documents) import adapter.
 *
 * Per the feature request the CSV must carry: when the note was
 * written (note_written_date), the note body (notes), and the author
 * clinician (written_by_email — resolved to a staff_id). Everything
 * else uses sensible defaults so a typical discharge/progress note
 * import is a three-column spreadsheet.
 *
 * The write goes through clinicalNoteService.create(clinicId,
 * authorId, dto) — note the second argument is the HISTORICAL author
 * resolved from the CSV, not the uploader. The uploader identity is
 * still tracked on import_jobs.uploaded_by_id so audit retains the
 * "who ran the import" trail separately from the "who wrote the
 * note" trail.
 *
 * CSV columns (required):
 *   emr_number, note_written_date, notes, written_by_email
 * CSV columns (optional):
 *   note_type (default 'progress_note')
 */
import type { ImportAdapter, RowError } from '../importTypes';
import { clinicalNoteService } from '../../clinical-notes/clinicalNote.service';
import { resolvePatientByEmrNumber, resolveStaffByEmail } from '../importResolvers';

interface ClinicalNoteImportDto {
  patientId: string;
  authorStaffId: string;
  noteDateTime: string; // ISO8601
  content: string;
  noteType: string;
}

const REQUIRED = ['emr_number', 'note_written_date', 'notes', 'written_by_email'] as const;
const OPTIONAL = ['note_type'] as const;

const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;
const ISO_RX = /^\d{4}-\d{2}-\d{2}T/;

const NOTE_TYPES = new Set([
  'consultation', 'progress_note', 'assessment', 'discharge_summary',
  'correspondence', 'other', 'soap', 'intake', 'progress', 'discharge',
  'mdt', 'mse', 'risk', 'amended',
]);

function strOrUndef(v: string | undefined): string | undefined {
  const t = (v ?? '').trim();
  return t.length === 0 ? undefined : t;
}

function coerceIsoDate(input: string): string | null {
  // Accept either a date-only (2026-04-14) or a full ISO timestamp.
  if (ISO_RX.test(input)) {
    const d = new Date(input);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (DATE_RX.test(input)) {
    // Pin to noon UTC so timezone drift doesn't shift the date a day.
    const d = new Date(`${input}T12:00:00Z`);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

export const clinicalNoteImportAdapter: ImportAdapter<ClinicalNoteImportDto> = {
  kind: 'clinical_notes',
  requiredColumns: REQUIRED,
  optionalColumns: OPTIONAL,

  async parseRow(row, rowIndex, ctx) {
    const errors: RowError[] = [];
    const emrNumber = strOrUndef(row.emr_number);
    const rawDate = strOrUndef(row.note_written_date);
    const content = strOrUndef(row.notes);
    const authorEmail = strOrUndef(row.written_by_email);
    const noteTypeRaw = strOrUndef(row.note_type)?.toLowerCase() ?? 'progress_note';

    if (!emrNumber) errors.push({ rowIndex, field: 'emr_number', message: 'emr_number is required' });
    if (!rawDate) errors.push({ rowIndex, field: 'note_written_date', message: 'note_written_date is required' });
    if (!content) errors.push({ rowIndex, field: 'notes', message: 'notes body is required' });
    if (!authorEmail) errors.push({ rowIndex, field: 'written_by_email', message: 'written_by_email is required' });
    if (!NOTE_TYPES.has(noteTypeRaw)) {
      errors.push({
        rowIndex,
        field: 'note_type',
        message: `note_type must be one of: ${Array.from(NOTE_TYPES).join(', ')}`,
      });
    }

    let noteDateTime: string | null = null;
    if (rawDate) {
      noteDateTime = coerceIsoDate(rawDate);
      if (!noteDateTime) {
        errors.push({
          rowIndex,
          field: 'note_written_date',
          message: 'note_written_date must be YYYY-MM-DD or a full ISO8601 timestamp',
        });
      }
    }

    if (errors.length > 0) return { ok: false, errors };

    const patientId = await resolvePatientByEmrNumber(ctx, emrNumber!);
    if (!patientId) {
      return {
        ok: false,
        errors: [{
          rowIndex,
          field: 'emr_number',
          message: `No patient found with EMR number '${emrNumber}' in this clinic`,
        }],
      };
    }

    const authorStaffId = await resolveStaffByEmail(ctx, authorEmail!);
    if (!authorStaffId) {
      return {
        ok: false,
        errors: [{
          rowIndex,
          field: 'written_by_email',
          message: `No clinician found with email '${authorEmail}' in this clinic`,
        }],
      };
    }

    return {
      ok: true,
      dto: {
        patientId,
        authorStaffId,
        noteDateTime: noteDateTime!,
        content: content!,
        noteType: noteTypeRaw,
      },
    };
  },

  async commitOne(dto, _ctx) {
    // authorStaffId is the HISTORICAL author from the CSV, not the
    // uploader. clinicalNoteService.create stamps this as author_id
    // on the row so the note's provenance matches the import spec
    // ("written by" must be the clinician named in the CSV, not the
    // operator who ran the batch).
    await clinicalNoteService.create(
      { staffId: dto.authorStaffId, clinicId: _ctx.clinicId, role: 'admin', permissions: ['note:create'] },
      {
      patientId: dto.patientId,
      noteType: dto.noteType as never,
      noteDateTime: dto.noteDateTime,
      content: dto.content,
      isAiDraft: false,
    });
  },
};
