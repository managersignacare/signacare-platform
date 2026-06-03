// apps/api/src/features/privacy/ndbNotification.ts
//
// Automated Notifiable Data Breach (NDB) notification workflow
// Required by: Australian Privacy Act 1988, Part IIIC
//
// The NDB scheme requires notification to the OAIC within 30 days
// of becoming aware of a breach likely to cause serious harm.
//
// This module:
//   1. Assesses breach severity using the OAIC's "serious harm" test
//   2. Generates notification content in OAIC format
//   3. Logs all notification decisions for compliance evidence

import { dbAdmin } from '../../db/db';
import { logger } from '../../utils/logger';

export interface BreachReport {
  id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  breachType: string;
  description: string;
  affectedRecordCount: number;
  dataTypesAffected: string[];
  containmentActions: string[];
  discoveredAt: string;
  reportedBy: string;
}

interface NdbAssessment {
  isNotifiable: boolean;
  reason: string;
  deadline: string; // 30 days from discovery
  oaicFormData: Record<string, string>;
}

/**
 * Assess whether a breach meets the NDB "serious harm" threshold.
 * Per OAIC guidance, consider:
 *   - Type of information (health data = higher risk)
 *   - Sensitivity (mental health data = highest sensitivity)
 *   - Security measures (encrypted vs plaintext)
 *   - Who may have accessed the data
 *   - Whether containment was achieved
 */
export function assessBreach(breach: BreachReport): NdbAssessment {
  const healthDataTypes = ['medicare_number', 'ihi_number', 'dva_number', 'clinical_notes', 'medications', 'diagnoses', 'risk_assessments'];
  const hasHealthData = breach.dataTypesAffected.some(t => healthDataTypes.includes(t));
  const isHighSeverity = breach.severity === 'high' || breach.severity === 'critical';
  const isLargeScale = breach.affectedRecordCount > 10;

  // NDB: A breach is notifiable if it is likely to result in serious harm
  // Health information is always considered high-sensitivity
  const isNotifiable = hasHealthData || (isHighSeverity && isLargeScale);

  const discoveredDate = new Date(breach.discoveredAt);
  const deadline = new Date(discoveredDate);
  deadline.setDate(deadline.getDate() + 30);

  return {
    isNotifiable,
    reason: isNotifiable
      ? `Breach involves ${hasHealthData ? 'health information' : 'sensitive data'} affecting ${breach.affectedRecordCount} records. Notification required under Part IIIC.`
      : `Breach assessed as unlikely to cause serious harm. No notification required but documented for compliance.`,
    deadline: deadline.toISOString().slice(0, 10),
    oaicFormData: {
      organisationName: 'Signacare Health Technologies Pty Ltd',
      contactEmail: process.env.PRIVACY_OFFICER_EMAIL ?? 'privacy@signacare.com.au',
      breachDescription: breach.description,
      informationTypes: breach.dataTypesAffected.join(', '),
      numberOfAffected: String(breach.affectedRecordCount),
      containmentActions: breach.containmentActions.join('; '),
      dateDiscovered: breach.discoveredAt,
      notificationDeadline: deadline.toISOString().slice(0, 10),
    },
  };
}

/**
 * Record a breach assessment and notification decision in the database.
 */
export async function recordBreachAssessment(
  clinicId: string,
  breach: BreachReport,
  assessment: NdbAssessment,
): Promise<void> {
  try {
    await dbAdmin('data_breach_log').insert({
      id: dbAdmin.raw('gen_random_uuid()'),
      clinic_id: clinicId,
      severity: breach.severity,
      description: breach.description,
      affected_records: breach.affectedRecordCount,
      containment_actions: JSON.stringify(breach.containmentActions),
      is_notifiable: assessment.isNotifiable,
      notification_deadline: assessment.deadline,
      oaic_form_data: JSON.stringify(assessment.oaicFormData),
      created_at: new Date(),
      updated_at: new Date(),
    });

    if (assessment.isNotifiable) {
      logger.warn({
        breachId: breach.id,
        severity: breach.severity,
        affectedRecords: breach.affectedRecordCount,
        deadline: assessment.deadline,
      }, 'NOTIFIABLE DATA BREACH — OAIC notification required within 30 days');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, message }, 'Failed to record breach assessment');
  }
}
