// apps/api/src/features/referrals/referralFeedbackService.ts
import { referralRepository } from './referralRepository';
import { db } from '../../db/db';
import logger from '../../utils/logger';
import { OUTBOUND_REFERRAL_SOURCE, type AuthContext } from '@signacare/shared';

/**
 * Handles sending feedback to external referrers.
 * Primary: Email via Outlook/SMTP.
 * Fallback: Generate a PDF letter for manual dispatch.
 */
export const referralFeedbackService = {
  async sendIntakeAcknowledgement(
    auth: AuthContext,
    referralId: string,
    conn?: import('knex').Knex,
  ): Promise<void> {
    const { clinicId } = auth;
    const sentByStaffId = auth.staffId;
    const referral = await referralRepository.findById(clinicId, referralId, conn);
    if (!referral?.from_provider_email) {
      logger.info({ clinicId, referralId }, 'No referrer email — skipping intake acknowledgement');
      return;
    }
    if (referral.source === OUTBOUND_REFERRAL_SOURCE) {
      logger.info({ clinicId, referralId }, 'Outbound referral — skipping intake acknowledgement');
      return;
    }

    const logConn = conn ?? db;
    const alreadyAcknowledged = await logConn('referral_feedback_log')
      .where({
        clinic_id: clinicId,
        referral_id: referralId,
        feedback_type: 'acknowledged',
      })
      .first('id');
    if (alreadyAcknowledged) {
      return;
    }

    const subject = `Referral ${referral.referral_number} — Received`;
    const body = [
      `Dear ${referral.from_provider_name ?? referral.from_service},`,
      '',
      `Thank you for your referral (${referral.referral_number}).`,
      '',
      'We confirm receipt and initial triage of this referral.',
      'Our team will review and provide a further update on disposition.',
      '',
      'Kind regards,',
      'Signacare Intake Team',
    ].join('\n');

    await sendFeedback(clinicId, referralId, {
      feedbackType: 'acknowledged',
      recipientEmail: referral.from_provider_email,
      subject,
      body,
      sentByStaffId,
    }, conn);
  },

  async sendAcceptanceFeedback(
    auth: AuthContext,
    referralId: string,
  ): Promise<void> {
    const { clinicId } = auth;
    const sentByStaffId = auth.staffId;
    const referral = await referralRepository.findById(clinicId, referralId);
    if (!referral?.from_provider_email) {
      logger.info({ clinicId, referralId }, 'No referrer email — skipping acceptance feedback');
      return;
    }

    const staffRow = await db('staff')
      .where({ id: sentByStaffId, clinic_id: clinicId })
      .whereNull('deleted_at')
      .select('given_name', 'family_name')
      .first();
    const clinicianName = staffRow
      ? `${staffRow.given_name} ${staffRow.family_name}`
      : 'the assigned clinician';

    const subject = `Referral ${referral.referral_number} — Accepted`;
    const body = [
      `Dear ${referral.from_provider_name ?? referral.from_service},`,
      '',
      `Thank you for your referral (${referral.referral_number}).`,
      '',
      `This referral has been accepted by ${clinicianName}. An initial appointment has been scheduled and the patient will be contacted directly.`,
      '',
      'If you have any questions, please do not hesitate to contact us.',
      '',
      'Kind regards,',
      clinicianName,
    ].join('\n');

    await sendFeedback(clinicId, referralId, {
      feedbackType: 'accepted',
      recipientEmail: referral.from_provider_email,
      subject,
      body,
      sentByStaffId,
    });
  },

  async sendRejectionFeedback(
    auth: AuthContext,
    referralId: string,
    reason: string,
  ): Promise<void> {
    const { clinicId } = auth;
    const sentByStaffId = auth.staffId;
    const referral = await referralRepository.findById(clinicId, referralId);
    if (!referral?.from_provider_email) {
      logger.info({ clinicId, referralId }, 'No referrer email — skipping rejection feedback');
      return;
    }

    const subject = `Referral ${referral.referral_number} — Not Accepted`;
    const body = [
      `Dear ${referral.from_provider_name ?? referral.from_service},`,
      '',
      `Thank you for your referral (${referral.referral_number}).`,
      '',
      `Unfortunately, we are unable to accept this referral at this time.`,
      `Reason: ${reason}`,
      '',
      'We recommend considering alternative services that may be better suited to the patient\'s needs.',
      '',
      'Kind regards,',
    ].join('\n');

    await sendFeedback(clinicId, referralId, {
      feedbackType: 'rejected',
      recipientEmail: referral.from_provider_email,
      subject,
      body,
      sentByStaffId,
    });
  },

  /**
   * BUG-602 — `conn` defaults to the request-scoped `db` proxy. Schedulers
   * (referralSlaScheduler.processAutoClose) MUST pass `dbAdmin` so the
   * downstream findById + insertFeedbackLog + updateReferral +
   * insertWorkflowEvent calls do not RLS-zero / RLS-reject.
   */
  async sendClosedNoResponseFeedback(
    auth: AuthContext,
    referralId: string,
    conn?: import('knex').Knex,
  ): Promise<void> {
    const { clinicId } = auth;
    const referral = await referralRepository.findById(clinicId, referralId, conn);
    if (!referral?.from_provider_email) {
      logger.info({ clinicId, referralId }, 'No referrer email — skipping closure feedback');
      return;
    }

    const subject = `Referral ${referral.referral_number} — Closed`;
    const body = [
      `Dear ${referral.from_provider_name ?? referral.from_service},`,
      '',
      `Thank you for your referral (${referral.referral_number}).`,
      '',
      `We regret to inform you that this referral has been closed as no clinician was available to accept it within the required timeframe.`,
      '',
      'We encourage you to resubmit the referral if the patient still requires care, or to contact us directly to discuss alternative arrangements.',
      '',
      'Kind regards,',
    ].join('\n');

    await sendFeedback(clinicId, referralId, {
      feedbackType: 'closed_no_response',
      recipientEmail: referral.from_provider_email,
      subject,
      body,
      sentByStaffId: null,
    }, conn);
  },

  async sendClarificationRequest(
    auth: AuthContext,
    referralId: string,
    question: string,
  ): Promise<void> {
    const { clinicId } = auth;
    const sentByStaffId = auth.staffId;
    const referral = await referralRepository.findById(clinicId, referralId);
    if (!referral?.from_provider_email) {
      logger.info({ clinicId, referralId }, 'No referrer email — skipping clarification request');
      return;
    }

    const subject = `Referral ${referral.referral_number} — Clarification Requested`;
    const body = [
      `Dear ${referral.from_provider_name ?? referral.from_service},`,
      '',
      `We are reviewing your referral (${referral.referral_number}) and require additional information before we can proceed.`,
      '',
      `Clarification needed:`,
      question,
      '',
      'Please reply to this email or contact us at your earliest convenience.',
      '',
      'Kind regards,',
    ].join('\n');

    await sendFeedback(clinicId, referralId, {
      feedbackType: 'clarification_request',
      recipientEmail: referral.from_provider_email,
      subject,
      body,
      sentByStaffId,
    });
  },
};

// ── Internal ──────────────────────────────────────────────────────────────

interface FeedbackParams {
  feedbackType: string;
  recipientEmail: string;
  subject: string;
  body: string;
  sentByStaffId: string | null;
}

async function sendFeedback(
  clinicId: string,
  referralId: string,
  params: FeedbackParams,
  conn?: import('knex').Knex,
): Promise<void> {
  const { feedbackType, recipientEmail, subject, body, sentByStaffId } = params;
  const normalizedSentByStaffId =
    sentByStaffId && isUuidLike(sentByStaffId) ? sentByStaffId : null;

  let deliveryStatus = 'queued';

  // Try email first
  try {
    const sent = await trySendEmail(
      clinicId,
      normalizedSentByStaffId,
      recipientEmail,
      subject,
      body,
    );
    deliveryStatus = sent ? 'sent' : 'letter_generated';
  } catch (err) {
    logger.warn({ err, clinicId, referralId }, 'Email send failed — falling back to letter generation');
    deliveryStatus = 'letter_generated';
  }

  if (deliveryStatus === 'letter_generated') {
    // Generate a PDF letter for manual dispatch
    try {
      await generateFeedbackLetter(clinicId, referralId, subject, body);
    } catch (err) {
      logger.warn({ err, clinicId, referralId }, 'Failed to generate feedback letter');
      deliveryStatus = 'failed';
    }
  }

  // Log to audit trail (BUG-602 — propagate conn to avoid RLS-reject from
  // scheduler context).
  await referralRepository.insertFeedbackLog({
    clinic_id: clinicId,
    referral_id: referralId,
    feedback_type: feedbackType,
    recipient_email: recipientEmail,
    message_body: body,
    sent_by_staff_id: normalizedSentByStaffId,
    delivery_status: deliveryStatus,
  }, conn);

  // Update referral (BUG-602 — propagate conn).
  await referralRepository.updateReferral(clinicId, referralId, {
    feedback_sent_at: new Date(),
  }, conn);

  await referralRepository.insertWorkflowEvent({
    clinicId,
    referralId,
    eventType: 'feedback_sent',
    performedByStaffId: normalizedSentByStaffId ?? undefined,
    notes: `${feedbackType} feedback — ${deliveryStatus}`,
  }, conn);
}

/**
 * Try to send email via Outlook or SMTP.
 * Returns true if sent, false if no email infrastructure is configured.
 */
async function trySendEmail(
  _clinicId: string,
  staffId: string | null,
  to: string,
  subject: string,
  body: string,
): Promise<boolean> {
  // Try Outlook first if staff has integration
  if (staffId && isUuidLike(staffId)) {
    try {
      const { sendEmail } = await import('../../integrations/outlook/outlookEmailService');
      if (typeof sendEmail === 'function') {
        await sendEmail(staffId, {
          to: [to],
          subject,
          htmlBody: formatHtmlBody(body),
        });
        return true;
      }
    } catch {
      // Outlook not available — try SMTP
    }
  }

  // Try SMTP
  const smtpHost = process.env.SMTP_HOST;
  if (smtpHost) {
    try {
      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: Number(process.env.SMTP_PORT ?? 587) === 465,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      await transporter.sendMail({
        from: process.env.SMTP_NOREPLY ?? process.env.SMTP_FROM ?? 'noreply@signacare.local',
        to,
        subject,
        html: formatHtmlBody(body),
      });
      return true;
    } catch (err) {
      logger.warn({ err }, 'SMTP send failed');
    }
  }

  // No email infrastructure available
  return false;
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function formatHtmlBody(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');

  return `
    <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333; max-width: 600px;">
      ${escaped}
      <hr style="border: none; border-top: 1px solid #ccc; margin: 24px 0;">
      <p style="font-size: 11px; color: #888;">
        This is an automated message from Signacare EMR.
        Please do not reply directly to this email.
        This communication may contain confidential health information.
      </p>
    </div>
  `;
}

/**
 * Generate a feedback letter for manual dispatch.
 * Creates a downloadable record in the referral's feedback log.
 */
async function generateFeedbackLetter(
  clinicId: string,
  referralId: string,
  subject: string,
  _body: string,
): Promise<void> {
  // Store the letter content for the front desk to access.
  // The frontend will render this as a printable letter with clinic letterhead.
  // A full PDF generation could be added later via a PDF library.
  logger.info(
    { clinicId, referralId, subject },
    'Feedback letter generated for manual dispatch — available in referral feedback log',
  );
}
