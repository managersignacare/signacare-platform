/**
 * Outlook Email Service — Send/Receive via Microsoft Graph
 *
 * Features:
 * - Send clinical letters, discharge summaries, referrals via Outlook
 * - Read incoming referral emails from a designated inbox
 * - Attach PDFs to outgoing emails
 */

import axios from 'axios';
import { db } from '../../db/db';
import { config } from '../../config';

interface StaffTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  email: string;
}

async function getStaffTokens(staffId: string): Promise<StaffTokens> {
  const staff = await db('staff')
    .where({ id: staffId })
    .first('outlook_email', 'outlook_refresh_token', 'outlook_token_expires_at');

  if (!staff?.outlook_refresh_token || !staff.outlook_email) {
    throw new Error('Outlook not connected. Go to Settings > Integrations to connect.');
  }

  return {
    accessToken: '',
    refreshToken: staff.outlook_refresh_token as string,
    expiresAt: Number(staff.outlook_token_expires_at ?? 0),
    email: staff.outlook_email as string,
  };
}

async function refreshAccessToken(tokens: StaffTokens): Promise<StaffTokens> {
  const params = new URLSearchParams({
    client_id: config.O365_CLIENT_ID!,
    client_secret: config.O365_CLIENT_SECRET!,
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken,
  });

  const url = `https://login.microsoftonline.com/${config.O365_TENANT_ID}/oauth2/v2.0/token`;
  const res = await axios.post<{ access_token: string; refresh_token?: string; expires_in: number }>(url, params);

  const updated: StaffTokens = {
    accessToken: res.data.access_token,
    refreshToken: res.data.refresh_token ?? tokens.refreshToken,
    expiresAt: Date.now() + (res.data.expires_in - 60) * 1000,
    email: tokens.email,
  };

  await db('staff')
    .where({ outlook_email: tokens.email })
    .update({
      outlook_refresh_token: updated.refreshToken,
      outlook_token_expires_at: updated.expiresAt,
      updated_at: new Date(),
    });

  return updated;
}

async function ensureAccessToken(staffId: string): Promise<StaffTokens> {
  let tokens = await getStaffTokens(staffId);
  if (!tokens.accessToken || Date.now() >= tokens.expiresAt) {
    tokens = await refreshAccessToken(tokens);
  }
  return tokens;
}

// ============ Send Email ============

export interface SendEmailPayload {
  to: string[];
  cc?: string[];
  replyTo?: string[];
  subject: string;
  htmlBody: string;
  attachments?: { name: string; contentBytes: string; contentType: string }[];
  importance?: 'low' | 'normal' | 'high';
  saveToSentItems?: boolean;
}

interface GraphRecipient {
  emailAddress: {
    address: string;
  };
}

interface GraphMessagePayload {
  subject: string;
  body: {
    contentType: 'HTML';
    content: string;
  };
  toRecipients: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  replyTo?: GraphRecipient[];
  attachments?: Array<{
    '@odata.type': '#microsoft.graph.fileAttachment';
    name: string;
    contentBytes: string;
    contentType: string;
  }>;
  importance: 'low' | 'normal' | 'high';
}

interface GraphInboxMessage {
  id: string;
  subject?: string;
  from?: {
    emailAddress?: {
      address?: string;
    };
  };
  receivedDateTime: string;
  bodyPreview?: string;
  body?: {
    content?: string;
  };
  hasAttachments?: boolean;
}

export async function sendEmail(staffId: string, payload: SendEmailPayload): Promise<void> {
  const tokens = await ensureAccessToken(staffId);

  const message: GraphMessagePayload = {
    subject: payload.subject,
    body: { contentType: 'HTML', content: payload.htmlBody },
    toRecipients: payload.to.map(email => ({ emailAddress: { address: email } })),
    importance: payload.importance ?? 'normal',
  };

  if (payload.cc?.length) {
    message.ccRecipients = payload.cc.map(email => ({ emailAddress: { address: email } }));
  }
  if (payload.replyTo?.length) {
    message.replyTo = payload.replyTo.map(email => ({ emailAddress: { address: email } }));
  }

  if (payload.attachments?.length) {
    message.attachments = payload.attachments.map(att => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: att.name,
      contentBytes: att.contentBytes,
      contentType: att.contentType,
    }));
  }

  await axios.post(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(tokens.email)}/sendMail`,
    { message, saveToSentItems: payload.saveToSentItems ?? true },
    { headers: { Authorization: `Bearer ${tokens.accessToken}`, 'Content-Type': 'application/json' } },
  );
}

// ============ Read Emails (for referral inbox) ============

export interface EmailMessage {
  id: string;
  subject: string;
  from: string;
  receivedAt: string;
  bodyPreview: string;
  htmlBody: string;
  hasAttachments: boolean;
  attachments?: { id: string; name: string; contentType: string; size: number }[];
}

export async function readInboxEmails(
  staffId: string,
  opts: { folder?: string; unreadOnly?: boolean; limit?: number } = {},
): Promise<EmailMessage[]> {
  const tokens = await ensureAccessToken(staffId);
  const folder = opts.folder ?? 'inbox';
  const limit = opts.limit ?? 20;
  const filter = opts.unreadOnly ? '&$filter=isRead eq false' : '';

  const resp = await axios.get(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(tokens.email)}/mailFolders/${folder}/messages?$top=${limit}&$orderby=receivedDateTime desc${filter}&$select=id,subject,from,receivedDateTime,bodyPreview,body,hasAttachments`,
    { headers: { Authorization: `Bearer ${tokens.accessToken}` } },
  );

  const messages = (resp.data.value ?? []) as GraphInboxMessage[];
  return messages.map((m) => ({
    id: m.id,
    subject: m.subject ?? '',
    from: m.from?.emailAddress?.address ?? '',
    receivedAt: m.receivedDateTime,
    bodyPreview: m.bodyPreview ?? '',
    htmlBody: m.body?.content ?? '',
    hasAttachments: m.hasAttachments ?? false,
  }));
}

// ============ Format Clinical Letter as HTML Email ============

export function formatClinicalLetterHtml(opts: {
  recipientName: string;
  patientName: string;
  clinicianName: string;
  clinicianTitle: string;
  serviceName: string;
  body: string;
  date?: string;
}): string {
  const date = opts.date ?? new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  return `
<div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 700px; margin: 0 auto; color: #333;">
  <div style="border-bottom: 3px solid #327C8D; padding-bottom: 12px; margin-bottom: 20px;">
    <h2 style="margin: 0; color: #3D484B;">${opts.serviceName}</h2>
    <p style="margin: 4px 0 0; color: #888; font-size: 13px;">Clinical Correspondence</p>
  </div>

  <p style="margin-bottom: 4px;">${date}</p>
  <p style="margin-bottom: 16px;">Dear ${opts.recipientName},</p>
  <p style="margin-bottom: 8px;"><strong>RE: ${opts.patientName}</strong></p>

  <div style="white-space: pre-wrap; line-height: 1.6; font-size: 14px;">
${opts.body}
  </div>

  <div style="margin-top: 32px; border-top: 1px solid #ddd; padding-top: 16px;">
    <p style="margin: 0;">Yours sincerely,</p>
    <p style="margin: 8px 0 0; font-weight: 600;">${opts.clinicianName}</p>
    <p style="margin: 2px 0 0; color: #666; font-size: 13px;">${opts.clinicianTitle}</p>
    <p style="margin: 2px 0 0; color: #666; font-size: 13px;">${opts.serviceName}</p>
  </div>

  <div style="margin-top: 24px; padding: 8px; background: #f5f5f5; border-radius: 4px; font-size: 11px; color: #999;">
    CONFIDENTIAL: This email contains clinical information. If you are not the intended recipient,
    please notify the sender and delete this email. Do not copy, distribute, or act on its contents.
  </div>
</div>`;
}
