import type { SummarySignoffSection } from './SummarySignoffControls';

export interface SummarySignoffRecord {
  section: SummarySignoffSection;
  signedOffAt: string;
  signedOffById: string;
  signedOffByName: string;
  reviewDueDate: string;
  reminderTaskId: string | null;
}
