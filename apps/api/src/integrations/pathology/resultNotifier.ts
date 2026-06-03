/**
 * Pathology Result Notification Service
 *
 * Monitors incoming pathology results and generates notifications
 * for abnormal, critical, or overdue results.
 */

import { db } from '../../db/db';
import { randomUUID } from 'crypto';
import { logger } from '../../utils/logger';

type AbnormalFlag = 'normal' | 'low' | 'high' | 'critical_low' | 'critical_high' | 'abnormal';

interface ResultNotification {
  patientId: string;
  patientName: string;
  clinicianId: string;
  testName: string;
  resultValue: string;
  referenceRange?: string;
  abnormalFlag: AbnormalFlag;
  urgency: 'routine' | 'urgent' | 'critical';
  message: string;
}

/**
 * Check a result and generate notifications if abnormal.
 */
export async function checkAndNotify(result: {
  patientId: string;
  clinicId: string;
  testName: string;
  resultValue: string;
  resultUnit?: string;
  referenceRange?: string;
  abnormalFlag: AbnormalFlag;
}): Promise<ResultNotification | null> {
  if (result.abnormalFlag === 'normal') return null;

  // Look up patient and primary clinician
  const patient = await db('patients').where({ id: result.patientId }).first('given_name', 'family_name');
  const episode = await db('episodes').where({ patient_id: result.patientId, status: 'open' }).first('primary_clinician_id');

  if (!patient || !episode?.primary_clinician_id) {
    logger.warn({ patientId: result.patientId }, '[ResultNotifier] No active episode/clinician for notification');
    return null;
  }

  const isCritical = result.abnormalFlag === 'critical_low' || result.abnormalFlag === 'critical_high';
  const urgency = isCritical ? 'critical' : 'urgent';

  const notification: ResultNotification = {
    patientId: result.patientId,
    patientName: `${patient.given_name} ${patient.family_name}`,
    clinicianId: episode.primary_clinician_id,
    testName: result.testName,
    resultValue: `${result.resultValue}${result.resultUnit ? ' ' + result.resultUnit : ''}`,
    referenceRange: result.referenceRange,
    abnormalFlag: result.abnormalFlag,
    urgency,
    message: isCritical
      ? `CRITICAL: ${result.testName} = ${result.resultValue} for ${patient.given_name} ${patient.family_name}. Immediate review required.`
      : `Abnormal: ${result.testName} = ${result.resultValue} (ref: ${result.referenceRange ?? 'N/A'}) for ${patient.given_name} ${patient.family_name}.`,
  };

  // Store notification as a task
  try {
    await db('tasks').insert({
      id: randomUUID(),
      clinic_id: result.clinicId,
      patient_id: result.patientId,
      assigned_to_id: episode.primary_clinician_id,
      title: `${isCritical ? 'CRITICAL' : 'Abnormal'} Pathology: ${result.testName}`,
      description: notification.message,
      priority: isCritical ? 'urgent' : 'high',
      status: 'pending',
      due_date: isCritical ? new Date().toISOString().split('T')[0] : new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0],
      created_at: new Date(),
      updated_at: new Date(),
    });
    logger.info({ patientId: result.patientId, test: result.testName, urgency }, '[ResultNotifier] Task created for abnormal result');
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, '[ResultNotifier] Failed to create notification task');
  }

  return notification;
}

/**
 * Mental health-specific pathology monitoring rules.
 * These are common monitoring requirements for psychiatric medications.
 */
export const MONITORING_RULES: Record<string, { tests: string[]; frequency: string; alert: string }> = {
  lithium: {
    tests: ['Lithium Level', 'Renal Function (EUC)', 'Thyroid Function (TFT)'],
    frequency: '3-monthly (stable) / weekly (initiation)',
    alert: 'Lithium level outside 0.6-0.8 mmol/L (maintenance) or >1.0 mmol/L (toxic)',
  },
  clozapine: {
    tests: ['FBC (WCC/ANC)', 'Fasting Glucose', 'Lipid Profile', 'HbA1c', 'Clozapine Level'],
    frequency: 'Weekly (first 18 weeks) → fortnightly (18-52 weeks) → monthly',
    alert: 'WCC <3.5 or ANC <2.0 — withhold clozapine and contact haematology',
  },
  valproate: {
    tests: ['Valproate Level', 'LFT', 'FBC', 'Coagulation'],
    frequency: '3-monthly (stable)',
    alert: 'Level >100 mg/L or liver function abnormality',
  },
  antipsychotic_general: {
    tests: ['Metabolic Panel (fasting glucose, lipids, HbA1c)', 'Prolactin', 'ECG (QTc)', 'Weight/BMI'],
    frequency: 'Baseline → 3 months → annually',
    alert: 'QTc >500ms, significant weight gain >7%, metabolic syndrome criteria',
  },
};
