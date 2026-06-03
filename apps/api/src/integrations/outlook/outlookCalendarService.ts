// apps/api/src/integrations/outlook/outlookCalendarService.ts
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
    throw new Error(`Outlook not connected for staff ${staffId}`);
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
  const res = await axios.post<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  }>(url, params);

  const now = Date.now();
  const updated: StaffTokens = {
    accessToken: res.data.access_token,
    refreshToken: res.data.refresh_token ?? tokens.refreshToken,
    expiresAt: now + (res.data.expires_in - 60) * 1000,
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

async function ensureStaffAccessToken(staffId: string): Promise<StaffTokens> {
  let tokens = await getStaffTokens(staffId);
  if (!tokens.accessToken || Date.now() >= tokens.expiresAt) {
    tokens = await refreshAccessToken(tokens);
  }
  return tokens;
}

export async function createStaffEvent(
  staffId: string,
  payload: {
    subject: string;
    htmlBody: string;
    startIso: string;
    endIso: string;
    location?: string;
  },
): Promise<string> {
  const tokens = await ensureStaffAccessToken(staffId);
  const res = await axios.post<{ id: string }>(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(tokens.email)}/calendar/events`,
    {
      subject: payload.subject,
      body: { contentType: 'HTML', content: payload.htmlBody },
      start: { dateTime: payload.startIso, timeZone: 'Australia/Melbourne' },
      end: { dateTime: payload.endIso, timeZone: 'Australia/Melbourne' },
      location: payload.location ? { displayName: payload.location } : undefined,
    },
    {
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
      },
    },
  );
  return res.data.id;
}

export async function updateStaffEvent(
  staffId: string,
  eventId: string,
  payload: {
    subject: string;
    htmlBody: string;
    startIso: string;
    endIso: string;
    location?: string;
  },
): Promise<void> {
  const tokens = await ensureStaffAccessToken(staffId);
  await axios.patch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(tokens.email)}/calendar/events/${eventId}`,
    {
      subject: payload.subject,
      body: { contentType: 'HTML', content: payload.htmlBody },
      start: { dateTime: payload.startIso, timeZone: 'Australia/Melbourne' },
      end: { dateTime: payload.endIso, timeZone: 'Australia/Melbourne' },
      location: payload.location ? { displayName: payload.location } : undefined,
    },
    {
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
      },
    },
  );
}

export async function deleteStaffEvent(
  staffId: string,
  eventId: string,
): Promise<void> {
  const tokens = await ensureStaffAccessToken(staffId);
  await axios.delete(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(tokens.email)}/calendar/events/${eventId}`,
    {
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
      },
    },
  );
}