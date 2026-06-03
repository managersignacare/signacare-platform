import { z } from 'zod';

export const EpisodeTypeSchema = z.enum([
  'community',
  'inpatient',
  'acis',
  'dayProgram',
  'telehealth',
  'group',
  'other',
]);
export type EpisodeType = z.infer<typeof EpisodeTypeSchema>;

// Episode status — must match packages/shared/src/episode.schemas.ts
// `EpisodeStatus = z.enum(['open', 'closed', 'onhold'])` and the
// Postgres `episodes.status` column (varchar(30) DEFAULT 'open',
// referenced by `idx_episodes_one_open_per_type` partial unique
// index `WHERE status = 'open'`). Earlier this file used
// 'active' / 'onHold' / 'transferred' which never matched the
// backend — EpisodeStatusBadge would render undefined labels and
// blank chips for any real episode row from the API. Fixed
// 2026-04-15 (Phase 0.7 consistency audit).
export const EpisodeStatusSchema = z.enum([
  'open',
  'closed',
  'onhold',
]);
export type EpisodeStatus = z.infer<typeof EpisodeStatusSchema>;

export const EpisodeSchema = z.object({
  id:             z.string().uuid(),
  clinicId:       z.string().uuid(),
  patientId:      z.string().uuid(),
  createdById:    z.string().uuid(),
  episodeNumber:  z.string().nullable(),
  title:          z.string(),
  episodeType:    EpisodeTypeSchema.nullable(),
  status:         EpisodeStatusSchema,
  startDate:      z.string(),
  endDate:        z.string().nullable(),
  primaryDiagnosis: z.string().nullable(),
  diagnoses:      z.string().nullable(),
  summary:        z.string().nullable(),
  closureReason:  z.string().nullable(),
  dischargeSummary: z.string().nullable(),
  referralId:     z.string().uuid().nullable().optional(),
  keyClinicianId: z.string().uuid().nullable().optional(),
  caseManagerId:  z.string().uuid().nullable().optional(),
  createdAt:      z.string().datetime(),
  updatedAt:      z.string().datetime(),
  deletedAt:      z.string().datetime().nullable(),
});
export type Episode = z.infer<typeof EpisodeSchema>;

// Phase 0.7 PR3 Class D — CreateEpisodeDTO / UpdateEpisodeDTO /
// CloseEpisodeDTO / EpisodeSearchDTO now imported from shared (single
// source of truth). The local schemas had three drifts:
//
//  1. CreateEpisodeDTOSchema accepted `referralId` / `keyClinicianId` /
//     `caseManagerId` which the shared CreateEpisodeSchema does NOT
//     declare — meaning those values were silently dropped at the API
//     boundary if they were ever set in a form.
//  2. EpisodeSearchDTOSchema had `cursor: z.string()` (any string) but
//     shared has `cursor: z.string().uuid()` — stricter validation on
//     the backend would reject malformed cursors.
//  3. Naming: local schemas were `CreateEpisodeDTOSchema` (with the DTO
//     suffix), shared uses `CreateEpisodeSchema` (without). Re-exported
//     under the historical local names below.
import {
  CreateEpisodeSchema as SharedCreateEpisodeSchema,
  UpdateEpisodeSchema as SharedUpdateEpisodeSchema,
  CloseEpisodeSchema as SharedCloseEpisodeSchema,
  EpisodeSearchSchema as SharedEpisodeSearchSchema,
} from '@signacare/shared';
export type {
  CreateEpisodeDTO,
  UpdateEpisodeDTO,
  CloseEpisodeDTO,
  EpisodeSearchDTO,
} from '@signacare/shared';

export const CreateEpisodeDTOSchema = SharedCreateEpisodeSchema;
export const UpdateEpisodeDTOSchema = SharedUpdateEpisodeSchema;
export const CloseEpisodeDTOSchema = SharedCloseEpisodeSchema;
export const EpisodeSearchDTOSchema = SharedEpisodeSearchSchema;

// ── Display helpers ───────────────────────────────────────────────────────────
export const EPISODE_TYPE_LABELS: Record<EpisodeType, string> = {
  community:  'Community',
  inpatient:  'Inpatient',
  acis:       'ACIS',
  dayProgram: 'Day Program',
  telehealth: 'Telehealth',
  group:      'Group',
  other:      'Other',
};

export const EPISODE_STATUS_LABELS: Record<EpisodeStatus, string> = {
  open:   'Open',
  closed: 'Closed',
  onhold: 'On Hold',
};

export const EPISODE_STATUS_COLOURS: Record<EpisodeStatus, string> = {
  open:   '#4E9C82',
  closed: '#9E9E9E',
  onhold: '#F0852C',
};

export interface EpisodeTimelineEvent {
  id:        string;
  date:      string;
  label:     string;
  detail?:   string;
  type:      'created' | 'updated' | 'closed' | 'note' | 'risk' | 'medication';
}
