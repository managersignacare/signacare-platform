import { describe, expect, it } from 'vitest';
import { MedicationStatusEnum } from '@signacare/shared';
import {
  MEDICATION_STATUS_COLOR,
  MEDICATION_STATUS_LABEL,
  type MedicationStatus,
} from './medicationTypes';

describe('Medication status parity (ARCH-S0-11)', () => {
  it('web MedicationStatus union matches shared MedicationStatusEnum exactly', () => {
    const sharedStatuses = [...MedicationStatusEnum.options].sort();
    const webStatuses = Object.keys(MEDICATION_STATUS_LABEL).sort();
    expect(webStatuses).toEqual(sharedStatuses);
  });

  it('every MedicationStatus has both label and color mappings', () => {
    const statuses = MedicationStatusEnum.options as ReadonlyArray<MedicationStatus>;
    for (const status of statuses) {
      expect(MEDICATION_STATUS_LABEL[status]).toBeTruthy();
      expect(MEDICATION_STATUS_COLOR[status]).toBeTruthy();
    }
  });
});

