import type { Job } from 'bullmq';
import { db } from '../../db/db';
import { logger } from '../../utils/logger';
import { sendEmail } from '../../integrations/outlook/outlookEmailService';
import { getClinicSenderProfile } from '../../features/clinic-settings/clinicSenderProfile';

export type EmailJobType = 'staff_notification' | 'appointment_reminder' | 'billing_notice';

export interface EmailJobData {
  type: EmailJobType;
  clinicId: string;
  staffId?: string;
  patientId?: string;
  appointmentId?: string;
  scheduledFor?: string;
  severity?: 'info' | 'warning' | 'critical';
  category?: string;
  title?: string;
  body?: string | null;
  actionUrl?: string | null;
  channel?: string;
  invoiceId?: string;
  paymentId?: string;
  amountCents?: number;
  currency?: string;
}

interface EmailRecipient {
  email: string;
  displayName: string;
  staffId?: string;
}

interface ResolvedEmailPayload {
  clinicId: string;
  recipient: EmailRecipient;
  subject: string;
  textBody: string;
  htmlBody: string;
}

export interface EmailWorkerDeps {
  findStaffRecipient: (clinicId: string, staffId: string) => Promise<EmailRecipient | null>;
  findPatientRecipient: (clinicId: string, patientId: string) => Promise<EmailRecipient | null>;
  canSendAppointmentReminder: (clinicId: string, appointmentId: string, patientId: string) => Promise<boolean>;
  canUseSmtp: () => boolean;
  sendSmtp: (input: ResolvedEmailPayload) => Promise<void>;
  sendOutlook: (staffId: string, input: ResolvedEmailPayload) => Promise<void>;
  logInfo: (meta: Record<string, unknown>, msg: string) => void;
  logWarn: (meta: Record<string, unknown>, msg: string) => void;
}

export interface EmailDispatchResult {
  delivered: boolean;
  provider: 'smtp' | 'outlook';
  recipient: string;
  subject: string;
  type: EmailJobType;
}

export class PermanentEmailJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentEmailJobError';
  }
}

function asIsoDateString(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function buildReminderText(data: EmailJobData): { subject: string; text: string; html: string } {
  const whenIso = asIsoDateString(data.scheduledFor);
  const whenLine = whenIso
    ? `Scheduled for: ${new Date(whenIso).toLocaleString('en-AU', { hour12: false })}`
    : 'Scheduled for: upcoming appointment';
  const subject = data.title?.trim() || 'Appointment reminder';
  const textBody = [
    data.body?.trim() || 'You have an upcoming appointment.',
    whenLine,
    data.appointmentId ? `Appointment reference: ${data.appointmentId}` : '',
  ].filter(Boolean).join('\n');
  const htmlBody = [
    `<p>${escapeHtml(data.body?.trim() || 'You have an upcoming appointment.')}</p>`,
    `<p><strong>${escapeHtml(whenLine)}</strong></p>`,
    data.appointmentId ? `<p>Appointment reference: ${escapeHtml(data.appointmentId)}</p>` : '',
  ].join('');
  return { subject, text: textBody, html: htmlBody };
}

function buildStaffNotificationText(data: EmailJobData): { subject: string; text: string; html: string } {
  const subject = data.title?.trim() || 'Clinical notification';
  const severity = data.severity ? `Severity: ${data.severity}` : '';
  const category = data.category ? `Category: ${data.category}` : '';
  const action = data.actionUrl ? `Action: ${data.actionUrl}` : '';
  const textBody = [
    data.body?.trim() || 'A clinical notification requires your attention.',
    severity,
    category,
    action,
  ].filter(Boolean).join('\n');
  const htmlBody = [
    `<p>${escapeHtml(data.body?.trim() || 'A clinical notification requires your attention.')}</p>`,
    severity ? `<p>${escapeHtml(severity)}</p>` : '',
    category ? `<p>${escapeHtml(category)}</p>` : '',
    action ? `<p>${escapeHtml(action)}</p>` : '',
  ].join('');
  return { subject, text: textBody, html: htmlBody };
}

function buildBillingNoticeText(data: EmailJobData): { subject: string; text: string; html: string } {
  const subject = data.title?.trim() || 'Billing update';
  const amountLine = Number.isFinite(data.amountCents)
    ? `Amount: ${(data.currency ?? 'AUD').trim().toUpperCase()} ${(Number(data.amountCents) / 100).toFixed(2)}`
    : '';
  const referenceLine = data.invoiceId ? `Invoice reference: ${data.invoiceId}` : '';
  const paymentLine = data.paymentId ? `Payment reference: ${data.paymentId}` : '';
  const actionLine = data.actionUrl ? `Action: ${data.actionUrl}` : '';
  const textBody = [
    data.body?.trim() || 'There is an update to your billing record.',
    amountLine,
    referenceLine,
    paymentLine,
    actionLine,
  ].filter(Boolean).join('\n');
  const htmlBody = [
    `<p>${escapeHtml(data.body?.trim() || 'There is an update to your billing record.')}</p>`,
    amountLine ? `<p>${escapeHtml(amountLine)}</p>` : '',
    referenceLine ? `<p>${escapeHtml(referenceLine)}</p>` : '',
    paymentLine ? `<p>${escapeHtml(paymentLine)}</p>` : '',
    actionLine ? `<p>${escapeHtml(actionLine)}</p>` : '',
  ].join('');
  return { subject, text: textBody, html: htmlBody };
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function findStaffRecipient(clinicId: string, staffId: string): Promise<EmailRecipient | null> {
  const row = await db('staff')
    .where({ clinic_id: clinicId, id: staffId })
    .whereNull('deleted_at')
    .first('id', 'email', 'given_name', 'family_name');
  if (!row?.email) return null;
  const displayName = `${row.given_name ?? ''} ${row.family_name ?? ''}`.trim() || String(row.email);
  return {
    email: String(row.email),
    displayName,
    staffId: String(row.id),
  };
}

async function findPatientRecipient(clinicId: string, patientId: string): Promise<EmailRecipient | null> {
  const row = await db('patients')
    .where({ clinic_id: clinicId, id: patientId })
    .whereNull('deleted_at')
    .first('email_primary', 'email', 'given_name', 'family_name');
  const email = row?.email_primary ?? row?.email;
  if (!email) return null;
  const displayName = `${row.given_name ?? ''} ${row.family_name ?? ''}`.trim() || String(email);
  return {
    email: String(email),
    displayName,
  };
}

async function canSendAppointmentReminder(
  clinicId: string,
  appointmentId: string,
  patientId: string,
): Promise<boolean> {
  const row = await db('appointments')
    .where({ id: appointmentId, clinic_id: clinicId, patient_id: patientId })
    .whereNull('deleted_at')
    .first('status', 'start_time');
  if (!row) return false;

  const status = String(row.status ?? '').toLowerCase();
  if (['cancelled', 'no_show', 'completed', 'rescheduled'].includes(status)) return false;

  const start = new Date(String(row.start_time ?? ''));
  if (Number.isFinite(start.getTime()) && start.getTime() < Date.now() - 10 * 60 * 1000) {
    return false;
  }
  return true;
}

function getSmtpConfig(): {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
} | null {
  const host = process.env['SMTP_HOST']?.trim();
  const portRaw = process.env['SMTP_PORT']?.trim();
  const from = process.env['SMTP_FROM']?.trim() ?? process.env['SMTP_NOREPLY']?.trim();
  if (!host || !portRaw || !from) return null;
  const port = Number(portRaw);
  if (!Number.isFinite(port) || port <= 0) return null;
  return {
    host,
    port,
    secure: port === 465,
    user: process.env['SMTP_USER']?.trim() || undefined,
    pass: process.env['SMTP_PASS']?.trim() || undefined,
    from,
  };
}

let cachedTransportKey: string | null = null;
let cachedTransporter: {
  sendMail: (opts: {
    from: string;
    replyTo?: string;
    to: string[];
    subject: string;
    text: string;
    html: string;
  }) => Promise<unknown>;
} | null = null;

async function sendSmtp(input: ResolvedEmailPayload): Promise<void> {
  const smtp = getSmtpConfig();
  if (!smtp) {
    throw new PermanentEmailJobError('SMTP is not configured (SMTP_HOST/SMTP_PORT/SMTP_FROM required).');
  }
  const senderProfile = await getClinicSenderProfile(input.clinicId);
  const clinicMailboxSender =
    senderProfile.emailSenderMode === 'clinic_mailbox' && senderProfile.clinicSenderEmail
      ? senderProfile.clinicSenderEmail
      : null;
  const senderDisplayName = senderProfile.clinicSenderName?.trim() || 'Signacare EMR';
  const envelopeFrom = clinicMailboxSender ?? smtp.from;
  const key = `${smtp.host}:${smtp.port}:${smtp.from}:${smtp.user ?? ''}`;
  if (!cachedTransporter || cachedTransportKey !== key) {
    const nodemailer = await import('nodemailer');
    cachedTransporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.user && smtp.pass ? { user: smtp.user, pass: smtp.pass } : undefined,
    });
    cachedTransportKey = key;
  }
  await cachedTransporter.sendMail({
    from: `"${senderDisplayName}" <${envelopeFrom}>`,
    replyTo: envelopeFrom,
    to: [input.recipient.email],
    subject: input.subject,
    text: input.textBody,
    html: input.htmlBody,
  });
}

async function sendOutlook(staffId: string, input: ResolvedEmailPayload): Promise<void> {
  await sendEmail(staffId, {
    to: [input.recipient.email],
    subject: input.subject,
    htmlBody: input.htmlBody,
  });
}

function buildDefaultDeps(): EmailWorkerDeps {
  return {
    findStaffRecipient,
    findPatientRecipient,
    canSendAppointmentReminder,
    canUseSmtp: () => getSmtpConfig() !== null,
    sendSmtp,
    sendOutlook,
    logInfo: (meta, msg) => logger.info(meta, msg),
    logWarn: (meta, msg) => logger.warn(meta, msg),
  };
}

function resolvePayload(data: EmailJobData, recipient: EmailRecipient): ResolvedEmailPayload {
  if (data.type === 'appointment_reminder') {
    const payload = buildReminderText(data);
    return {
      clinicId: data.clinicId,
      recipient,
      subject: payload.subject,
      textBody: payload.text,
      htmlBody: payload.html,
    };
  }
  if (data.type === 'billing_notice') {
    const payload = buildBillingNoticeText(data);
    return {
      clinicId: data.clinicId,
      recipient,
      subject: payload.subject,
      textBody: payload.text,
      htmlBody: payload.html,
    };
  }
  const payload = buildStaffNotificationText(data);
  return {
    clinicId: data.clinicId,
    recipient,
    subject: payload.subject,
    textBody: payload.text,
    htmlBody: payload.html,
  };
}

export async function processEmailJobData(
  data: EmailJobData,
  deps: EmailWorkerDeps = buildDefaultDeps(),
): Promise<EmailDispatchResult> {
  let recipient: EmailRecipient | null = null;

  if (data.type === 'staff_notification') {
    if (!data.staffId) {
      throw new PermanentEmailJobError('staff_notification email job missing staffId');
    }
    recipient = await deps.findStaffRecipient(data.clinicId, data.staffId);
  } else if (data.type === 'appointment_reminder') {
    if (!data.patientId) {
      throw new PermanentEmailJobError('appointment_reminder email job missing patientId');
    }
    if (!data.appointmentId) {
      throw new PermanentEmailJobError('appointment_reminder email job missing appointmentId');
    }
    const canSend = await deps.canSendAppointmentReminder(
      data.clinicId,
      data.appointmentId,
      data.patientId,
    );
    if (!canSend) {
      throw new PermanentEmailJobError(
        `appointment_reminder suppressed (appointment missing/cancelled/completed): ${data.appointmentId}`,
      );
    }
    recipient = await deps.findPatientRecipient(data.clinicId, data.patientId);
  } else if (data.type === 'billing_notice') {
    if (!data.patientId) {
      throw new PermanentEmailJobError('billing_notice email job missing patientId');
    }
    recipient = await deps.findPatientRecipient(data.clinicId, data.patientId);
  }

  if (!recipient) {
    throw new PermanentEmailJobError(
      `No recipient email found for ${data.type} (clinicId=${data.clinicId})`,
    );
  }

  const payload = resolvePayload(data, recipient);

  if (deps.canUseSmtp()) {
    await deps.sendSmtp(payload);
    deps.logInfo(
      { clinicId: data.clinicId, type: data.type, recipient: recipient.email, provider: 'smtp' },
      'email worker — sent via SMTP',
    );
    return {
      delivered: true,
      provider: 'smtp',
      recipient: recipient.email,
      subject: payload.subject,
      type: data.type,
    };
  }

  if (data.type === 'staff_notification' && recipient.staffId) {
    try {
      await deps.sendOutlook(recipient.staffId, payload);
      deps.logInfo(
        { clinicId: data.clinicId, type: data.type, recipient: recipient.email, provider: 'outlook' },
        'email worker — sent via Outlook',
      );
      return {
        delivered: true,
        provider: 'outlook',
        recipient: recipient.email,
        subject: payload.subject,
        type: data.type,
      };
    } catch (err) {
      deps.logWarn(
        { err, clinicId: data.clinicId, type: data.type, recipient: recipient.email },
        'email worker — Outlook send failed',
      );
      throw err;
    }
  }

  throw new PermanentEmailJobError(
    'No configured email provider for this job type (configure SMTP for patient reminders).',
  );
}

export async function processEmailJob(job: Job<EmailJobData>): Promise<EmailDispatchResult> {
  return processEmailJobData(job.data);
}
