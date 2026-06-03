import type { AllergySummary } from './patientDetailSummaryTypes';

const INACTIVE_ALLERGY_STATUSES = new Set([
  'inactive',
  'resolved',
  'archived',
  'deleted',
]);

export function getActiveAllergies(rows: AllergySummary[]): AllergySummary[] {
  return rows.filter((row) => {
    const status = typeof row.status === 'string' ? row.status.toLowerCase() : '';
    if (status) {
      return !INACTIVE_ALLERGY_STATUSES.has(status);
    }
    if (typeof row.isActive === 'boolean') return row.isActive;
    if (typeof row.is_active === 'boolean') return row.is_active;
    return false;
  });
}

