// apps/api/src/features/referrals/ocrPersistence.ts
import { referralRepository } from './referralRepository';
import logger from '../../utils/logger';

export async function saveOcrSuccess(params: {
  clinicId: string;
  referralId: string;
  attachmentId: string;
  ocrResult: unknown;
}): Promise<void> {
  const { clinicId, referralId, attachmentId, ocrResult } = params;

  await referralRepository.updateAttachment(clinicId, attachmentId, {
    ocr_status: 'done',
    ocr_result: ocrResult,
    ocr_error_message: null,
  });

  const referral = await referralRepository.findById(clinicId, referralId);
  if (!referral) return;

  if (
    referral.status === 'received' ||
    referral.status === 'under_review' ||
    referral.status === 'info_requested'
  ) {
    await referralRepository.updateReferral(clinicId, referralId, {
      status: 'awaiting_clinician_confirmation',
      status_changed_at: new Date(),
      ocr_extracted: ocrResult,
    });
  }

  await referralRepository.insertWorkflowEvent({
    clinicId,
    referralId,
    eventType: 'ocr_completed',
    notes: 'OCR completed successfully',
  });

  logger.info(
    { clinicId, referralId, attachmentId },
    'OCR result persisted for referral attachment',
  );
}

export async function saveOcrFailure(params: {
  clinicId: string;
  referralId: string;
  attachmentId: string;
  errorMessage: string;
}): Promise<void> {
  const { clinicId, referralId, attachmentId, errorMessage } = params;

  await referralRepository.updateAttachment(clinicId, attachmentId, {
    ocr_status: 'failed',
    ocr_error_message: errorMessage,
  });

  await referralRepository.insertWorkflowEvent({
    clinicId,
    referralId,
    eventType: 'ocr_failed',
    notes: 'OCR failed',
    outcome: errorMessage.slice(0, 200),
  });
}
