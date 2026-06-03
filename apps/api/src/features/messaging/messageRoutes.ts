import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requireModuleRead } from '../../middleware/moduleAccessMiddleware';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import * as ctrl from './messageController';
import { logger } from '../../utils/logger';
import { getClinicSenderProfile } from '../clinic-settings/clinicSenderProfile';

// Local Zod schema for the send-email endpoint (Phase R3b / CLAUDE.md §12).
const SendEmailSchema = z.object({
  to: z.union([
    z.string().email(),
    z.array(z.string().email()).nonempty(),
  ]),
  subject: z.string().max(500).optional(),
  body: z.string().min(1).max(50000),
  patientId: z.string().uuid().optional(),
});

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const router = Router();

router.use(authMiddleware);
router.use(requireModuleRead(MODULE_KEYS.MESSAGES));

// Threads (group conversations)
router.post('/threads', ctrl.createThread);
router.get('/threads', ctrl.listThreads);
router.get('/threads/:threadId', ctrl.getThread); // also marks thread read
router.get('/threads/:threadId/messages', ctrl.getThreadMessages);
router.patch('/threads/:threadId/read', ctrl.markThreadRead);
router.patch('/threads/:threadId/archive', ctrl.archiveThread);

// Direct messages / send into thread
router.post('/', ctrl.sendMessage);
router.post('/threads/:threadId/messages', ctrl.sendMessage);

// Inbox (direct messages addressed to me)
router.get('/inbox', ctrl.getInbox);               // ?unreadOnly=true
router.get('/unread-count', ctrl.getUnreadCount);
router.patch('/:messageId/read', ctrl.markAsRead);

// ── Send Email (via Outlook/O365 or SMTP fallback) ──
router.post('/send-email', async (req: Request, res: Response, next: NextFunction) => {
  let parsed: z.infer<typeof SendEmailSchema>;
  try {
    parsed = SendEmailSchema.parse(req.body);
  } catch (err) {
    next(err);
    return;
  }
  const { to, subject, body, patientId } = parsed;
  const staffId = req.user!.id;
  try {
    const senderProfile = await getClinicSenderProfile(req.clinicId as string);
    const clinicReplyTo =
      senderProfile.emailSenderMode === 'clinic_mailbox'
        ? senderProfile.clinicSenderEmail
        : null;

    // Try Outlook/O365 first
    const { sendEmail } = await import('../../integrations/outlook/outlookEmailService');
    const htmlBody = body.replace(/\n/g, '<br>');
    const noReplyFooter = '<hr style="margin-top:30px;border:none;border-top:1px solid #ccc"><p style="font-size:10px;color:#999;font-family:Arial,sans-serif">This is an automated message from Signacare EMR. Please do not reply to this email. If you need to contact us, please call the clinic directly.</p>';
    await sendEmail(staffId, {
      to: Array.isArray(to) ? to : [to],
      replyTo: clinicReplyTo ? [clinicReplyTo] : undefined,
      subject: subject ?? 'Clinical Correspondence [No Reply]',
      htmlBody: `<div style="font-family:Georgia,serif;font-size:12pt;line-height:1.6">${htmlBody}${noReplyFooter}</div>`,
      importance: 'normal',
      saveToSentItems: true,
    });

    logger.info({ staffId, to, subject, patientId }, 'Email sent via Outlook');
    res.json({ success: true, method: 'outlook' });
  } catch (outlookErr: unknown) {
    // Outlook not configured — try SMTP fallback
    try {
      const nodemailer = await import('nodemailer');
      const smtpHost = process.env.SMTP_HOST;
      const smtpPort = parseInt(process.env.SMTP_PORT ?? '587', 10);
      const smtpUser = process.env.SMTP_USER;
      const smtpPass = process.env.SMTP_PASS;
      const smtpFrom = process.env.SMTP_FROM;

      if (!smtpHost || !smtpUser) {
        throw new Error('Neither Outlook nor SMTP is configured. Connect Outlook in Settings > Integrations, or set SMTP_HOST/SMTP_USER/SMTP_PASS in .env');
      }

      const transporter = nodemailer.createTransport({
        host: smtpHost, port: smtpPort, secure: smtpPort === 465,
        auth: { user: smtpUser, pass: smtpPass },
      });

      const noReplyFrom = process.env.SMTP_NOREPLY ?? `noreply@${(smtpFrom ?? smtpUser).split('@')[1] ?? 'signacare.net'}`;
      const senderProfile = await getClinicSenderProfile(req.clinicId as string);
      const clinicMailboxSender =
        senderProfile.emailSenderMode === 'clinic_mailbox' && senderProfile.clinicSenderEmail
          ? senderProfile.clinicSenderEmail
          : null;
      const senderDisplayName = senderProfile.clinicSenderName?.trim() || 'Signacare EMR';
      const envelopeFrom = clinicMailboxSender ?? noReplyFrom;
      const noReplyFooter = '<hr style="margin-top:30px;border:none;border-top:1px solid #ccc"><p style="font-size:10px;color:#999;font-family:Arial,sans-serif">This is an automated message from Signacare EMR. Please do not reply to this email. If you need to contact us, please call the clinic directly.</p>';
      await transporter.sendMail({
        from: `"${senderDisplayName}" <${envelopeFrom}>`,
        replyTo: envelopeFrom,
        to: Array.isArray(to) ? to.join(', ') : to,
        subject: subject ?? 'Clinical Correspondence [No Reply]',
        html: `<div style="font-family:Georgia,serif;font-size:12pt;line-height:1.6">${body.replace(/\n/g, '<br>')}${noReplyFooter}</div>`,
        headers: { 'X-Auto-Response-Suppress': 'All' },
      });

      logger.info({ staffId, to, subject, patientId }, 'Email sent via SMTP');
      res.json({ success: true, method: 'smtp' });
    } catch (smtpErr: unknown) {
      logger.error({ staffId, to, outlookErr: errorMessage(outlookErr), smtpErr: errorMessage(smtpErr) }, 'Email send failed');
      next(smtpErr);
    }
  }
});

export default router;
