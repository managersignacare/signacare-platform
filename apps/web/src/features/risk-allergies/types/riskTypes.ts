// apps/web/src/features/risk-allergies/types/riskTypes.ts
//
// Phase 0.7 PR3 Class D (TYPEDUP:RiskAssessmentResponse) — frontend no
// longer redeclares the risk assessment schemas. Shared is the single
// source of truth. Local file re-exports under the historical names
// used by frontend consumers (CreateRiskAssessmentSchema/DTO, etc.) so
// existing imports keep working.
//
// Real bug fixed in passing: the old frontend schema declared
// `assessedByName` but the backend riskService emits `assessorName`
// (matching the shared schema). `RiskAssessmentList.tsx` read
// `a.assessedByName ?? '—'` and has silently rendered `—` in the
// assessor column since the risk feature shipped. Aligned the consumer
// to `a.assessorName`.
//
// Also dropped the phantom `deletedAt` field that was declared in the
// old frontend schema but never actually read anywhere.

import { z } from 'zod';
import {
  RiskAssessmentCreateSchema,
  RiskAssessmentResponseSchema,
} from '@signacare/shared';

// Re-export the canonical type names from shared. These are the SAME
// symbols as shared — not parallel declarations — so the CI guard
// `check-no-duplicate-api-types.sh` treats the local file as a pure
// re-exporter rather than a drift-risk redeclaration.
// `CreateRiskAssessmentDTO` is the historical frontend name; shared
// calls it `RiskAssessmentCreateDTO`, so the alias keeps consumers
// working without a repo-wide rename.
export type { RiskAssessmentResponse } from '@signacare/shared';
export type { RiskAssessmentCreateDTO as CreateRiskAssessmentDTO } from '@signacare/shared';

// ─── Zod Enums ────────────────────────────────────────────────────────────────

export const RiskLevelEnum = z.enum([
  'low',
  'medium',
  'high',
  'very_high',
]);
export type RiskLevel = z.infer<typeof RiskLevelEnum>;

// ─── Re-export shared schemas under historical local names ─────────────────
// Legacy local names: CreateRiskAssessmentSchema (shared calls it
// RiskAssessmentCreateSchema). The runtime Zod value is re-exported so
// RiskAssessmentForm.tsx can still pass it to zodResolver().

export const CreateRiskAssessmentSchema = RiskAssessmentCreateSchema;
export const ResponseSchema = RiskAssessmentResponseSchema;

// ─── Dynamic Template Types (frontend-only, UI state) ─────────────────────────

export interface RiskTemplateItem {
  id:          string;
  label:       string;
  description: string;
  minValue:    number;
  maxValue:    number;
}

export interface RiskTemplateSection {
  id:       string;
  label:    string;
  items:    RiskTemplateItem[];
  maxScore: number;
}

export interface RiskTemplate {
  id:        string;
  name:      string;
  sections:  RiskTemplateSection[];
  totalMax:  number;
}

// ─── Frontend Display Config ──────────────────────────────────────────────────

export interface RiskLevelConfig {
  label:    string;
  colour:   string;
  muiColour: 'success' | 'warning' | 'error' | 'default';
  order:    number;
}

export const RISK_LEVEL_CONFIG: Readonly<Record<RiskLevel, RiskLevelConfig>> = {
  low:      { label: 'Low',       colour: '#4E9C82', muiColour: 'success', order: 1 },
  medium:   { label: 'Medium',    colour: '#F0852C', muiColour: 'warning', order: 2 },
  high:     { label: 'High',      colour: '#D32F2F', muiColour: 'error',   order: 3 },
  very_high:{ label: 'Very High', colour: '#B71C1C', muiColour: 'error',   order: 4 },
} as const;

export function scoreToRiskLevel(score: number, maxScore: number): RiskLevel {
  if (maxScore <= 0) return 'low';
  const pct = score / maxScore;
  if (pct < 0.25) return 'low';
  if (pct < 0.50) return 'medium';
  if (pct < 0.75) return 'high';
  return 'very_high';
}

export function isHighRisk(level: RiskLevel): boolean {
  return level === 'high' || level === 'very_high';
}
