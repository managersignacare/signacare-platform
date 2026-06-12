// apps/api/src/integrations/outlook/outlookCalendarService.ts
import axios from 'axios';
import { dbAdmin } from '../../db/db';
import { config } from '../../config';

interface StaffTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  email: string;
}

async function getStaffTokens(staffId: string): Promise<StaffTokens> {
  const staff = await dbAdmin('staff')
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

  await dbAdmin('staff')
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

export interface StaffGraphCalendarEvent {
  id: string;
  subject?: string | null;
  start?: { dateTime?: string | null; timeZone?: string | null } | null;
  end?: { dateTime?: string | null; timeZone?: string | null } | null;
  location?: { displayName?: string | null } | null;
  onlineMeeting?: { joinUrl?: string | null } | null;
  isCancelled?: boolean | null;
  changeKey?: string | null;
  lastModifiedDateTime?: string | null;
}

export interface StaffGraphSubscription {
  id: string;
  resource: string;
  expirationDateTime: string;
}

function graphRequestHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Prefer: 'outlook.timezone="UTC"',
  };
}

export function buildOutlookSubscriptionResource(email: string): string {
  return `users/${encodeURIComponent(email)}/events`;
}

export async function getStaffGraphIdentity(
  staffId: string,
): Promise<{ email: string }> {
  const tokens = await ensureStaffAccessToken(staffId);
  return { email: tokens.email };
}

export async function createStaffEvent(
  staffId: string,
  payload: {
    subject: string;
    htmlBody: string;
    startIso: string;
    endIso: string;
    location?: string;
    attendeeEmails?: string[];
    isTeamsMeeting?: boolean;
  },
): Promise<{
  eventId: string;
  joinUrl?: string | null;
  changeKey?: string | null;
  lastModifiedDateTime?: string | null;
}> {
  const tokens = await ensureStaffAccessToken(staffId);
  const res = await axios.post<{
    id: string;
    changeKey?: string | null;
    lastModifiedDateTime?: string | null;
    onlineMeeting?: { joinUrl?: string | null };
  }>(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(tokens.email)}/calendar/events`,
    {
      subject: payload.subject,
      body: { contentType: 'HTML', content: payload.htmlBody },
      start: { dateTime: payload.startIso, timeZone: 'Australia/Melbourne' },
      end: { dateTime: payload.endIso, timeZone: 'Australia/Melbourne' },
      location: payload.location ? { displayName: payload.location } : undefined,
      attendees: (payload.attendeeEmails ?? []).map((email) => ({
        emailAddress: { address: email },
        type: 'required',
      })),
      ...(payload.isTeamsMeeting
        ? {
          isOnlineMeeting: true,
          onlineMeetingProvider: 'teamsForBusiness',
        }
        : {}),
    },
    {
      headers: {
        ...graphRequestHeaders(tokens.accessToken),
      },
    },
  );
  return {
    eventId: res.data.id,
    joinUrl: res.data.onlineMeeting?.joinUrl ?? null,
    changeKey: res.data.changeKey ?? null,
    lastModifiedDateTime: res.data.lastModifiedDateTime ?? null,
  };
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
    attendeeEmails?: string[];
    isTeamsMeeting?: boolean;
  },
): Promise<{
  changeKey?: string | null;
  lastModifiedDateTime?: string | null;
  joinUrl?: string | null;
}> {
  const tokens = await ensureStaffAccessToken(staffId);
  await axios.patch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(tokens.email)}/calendar/events/${eventId}`,
    {
      subject: payload.subject,
      body: { contentType: 'HTML', content: payload.htmlBody },
      start: { dateTime: payload.startIso, timeZone: 'Australia/Melbourne' },
      end: { dateTime: payload.endIso, timeZone: 'Australia/Melbourne' },
      location: payload.location ? { displayName: payload.location } : undefined,
      attendees: (payload.attendeeEmails ?? []).map((email) => ({
        emailAddress: { address: email },
        type: 'required',
      })),
      ...(payload.isTeamsMeeting
        ? {
          isOnlineMeeting: true,
          onlineMeetingProvider: 'teamsForBusiness',
        }
        : {}),
    },
    {
      headers: {
        ...graphRequestHeaders(tokens.accessToken),
      },
    },
  );
  const refreshed = await getStaffEvent(staffId, eventId);
  return {
    changeKey: refreshed.changeKey ?? null,
    lastModifiedDateTime: refreshed.lastModifiedDateTime ?? null,
    joinUrl: refreshed.onlineMeeting?.joinUrl ?? null,
  };
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

export async function getStaffEvent(
  staffId: string,
  eventId: string,
): Promise<StaffGraphCalendarEvent> {
  const tokens = await ensureStaffAccessToken(staffId);
  const res = await axios.get<StaffGraphCalendarEvent>(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(tokens.email)}/calendar/events/${eventId}?$select=id,subject,start,end,location,onlineMeeting,isCancelled,changeKey,lastModifiedDateTime`,
    {
      headers: graphRequestHeaders(tokens.accessToken),
    },
  );
  return res.data;
}

export async function createStaffEventSubscription(
  staffId: string,
  input: {
    changeNotificationUrl: string;
    lifecycleNotificationUrl?: string | null;
    clientState: string;
    expirationDateTime: string;
  },
): Promise<StaffGraphSubscription> {
  const tokens = await ensureStaffAccessToken(staffId);
  const resource = buildOutlookSubscriptionResource(tokens.email);
  const res = await axios.post<StaffGraphSubscription>(
    'https://graph.microsoft.com/v1.0/subscriptions',
    {
      changeType: 'created,updated,deleted',
      notificationUrl: input.changeNotificationUrl,
      lifecycleNotificationUrl: input.lifecycleNotificationUrl ?? input.changeNotificationUrl,
      resource,
      expirationDateTime: input.expirationDateTime,
      clientState: input.clientState,
      latestSupportedTlsVersion: 'v1_2',
    },
    {
      headers: graphRequestHeaders(tokens.accessToken),
    },
  );
  return res.data;
}

export async function renewStaffEventSubscription(
  staffId: string,
  subscriptionId: string,
  expirationDateTime: string,
): Promise<StaffGraphSubscription> {
  const tokens = await ensureStaffAccessToken(staffId);
  const res = await axios.patch<StaffGraphSubscription>(
    `https://graph.microsoft.com/v1.0/subscriptions/${subscriptionId}`,
    { expirationDateTime },
    {
      headers: graphRequestHeaders(tokens.accessToken),
    },
  );
  return res.data;
}

export async function deleteStaffEventSubscription(
  staffId: string,
  subscriptionId: string,
): Promise<void> {
  const tokens = await ensureStaffAccessToken(staffId);
  await axios.delete(
    `https://graph.microsoft.com/v1.0/subscriptions/${subscriptionId}`,
    {
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
      },
    },
  );
}
