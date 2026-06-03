/**
 * Office 365 Integration Service
 *
 * Extends Outlook integration with:
 * - Calendar sync (two-way appointment sync)
 * - Teams meeting link generation
 * - SharePoint document storage
 * - OneDrive file access
 *
 * All use Microsoft Graph API with delegated permissions.
 */

import axios from 'axios';
import { db } from '../../db/db';
import { config } from '../../config';
import { logger as _logger } from '../../utils/logger';

interface GraphEventAttendee {
  emailAddress: { address: string };
  type: 'required';
}

interface GraphEventPayload {
  subject: string;
  body: { contentType: 'HTML'; content: string };
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  location?: { displayName: string };
  attendees: GraphEventAttendee[];
  isOnlineMeeting?: boolean;
  onlineMeetingProvider?: 'teamsForBusiness';
}

interface GraphCalendarEvent {
  id: string;
  subject?: string | null;
  start?: { dateTime?: string | null } | null;
  end?: { dateTime?: string | null } | null;
  location?: { displayName?: string | null } | null;
  onlineMeeting?: { joinUrl?: string | null } | null;
  attendees?: Array<{ emailAddress?: { address?: string | null } | null }> | null;
}

interface UpcomingCalendarEvent {
  id: string;
  subject: string;
  start?: string | null;
  end?: string | null;
  location?: string | null;
  isTeams: boolean;
  teamsUrl?: string | null;
  attendees: string[];
}

interface GraphDriveItem {
  id: string;
  name: string;
  size: number;
  lastModifiedDateTime: string;
  webUrl: string;
}

interface OneDriveFileSummary {
  id: string;
  name: string;
  size: number;
  lastModified: string;
  webUrl: string;
}

// ── Token Management (shared with outlookCalendarService) ──

async function getStaffAccessToken(staffId: string): Promise<{ token: string; email: string }> {
  const staff = await db('staff').where({ id: staffId }).first('outlook_email', 'outlook_refresh_token', 'outlook_token_expires_at');
  if (!staff?.outlook_refresh_token) throw new Error('Office 365 not connected. Go to Settings > Integrations.');

  // Check if token needs refresh
  if (!staff.outlook_token_expires_at || Date.now() >= Number(staff.outlook_token_expires_at)) {
    const tokenUrl = `https://login.microsoftonline.com/${config.O365_TENANT_ID}/oauth2/v2.0/token`;
    const resp = await axios.post(tokenUrl, new URLSearchParams({
      client_id: config.O365_CLIENT_ID!,
      client_secret: config.O365_CLIENT_SECRET!,
      grant_type: 'refresh_token',
      refresh_token: staff.outlook_refresh_token,
    }));

    const { access_token, refresh_token, expires_in } = resp.data;
    await db('staff').where({ id: staffId }).update({
      outlook_refresh_token: refresh_token ?? staff.outlook_refresh_token,
      outlook_token_expires_at: Date.now() + (expires_in - 60) * 1000,
      updated_at: new Date(),
    });
    return { token: access_token, email: staff.outlook_email };
  }

  // Token still valid — but we don't cache the access token in DB for security
  // In production, use a proper token cache (Redis)
  const tokenUrl = `https://login.microsoftonline.com/${config.O365_TENANT_ID}/oauth2/v2.0/token`;
  const resp = await axios.post(tokenUrl, new URLSearchParams({
    client_id: config.O365_CLIENT_ID!,
    client_secret: config.O365_CLIENT_SECRET!,
    grant_type: 'refresh_token',
    refresh_token: staff.outlook_refresh_token,
  }));
  return { token: resp.data.access_token, email: staff.outlook_email };
}

// ── Teams Meeting ──

export async function createTeamsMeeting(staffId: string, opts: {
  subject: string;
  startIso: string;
  endIso: string;
  attendees?: string[];
}): Promise<{ joinUrl: string; meetingId: string }> {
  const { token, email } = await getStaffAccessToken(staffId);

  const resp = await axios.post(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}/onlineMeetings`,
    {
      subject: opts.subject,
      startDateTime: opts.startIso,
      endDateTime: opts.endIso,
      participants: {
        attendees: (opts.attendees ?? []).map(e => ({ upn: e, role: 'attendee' })),
      },
    },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
  );

  return { joinUrl: resp.data.joinWebUrl, meetingId: resp.data.id };
}

// ── Calendar: Create event with optional Teams link ──

export async function createCalendarEvent(staffId: string, opts: {
  subject: string;
  htmlBody: string;
  startIso: string;
  endIso: string;
  location?: string;
  attendees?: string[];
  isTeamsMeeting?: boolean;
}): Promise<{ eventId: string; teamsUrl?: string }> {
  const { token, email } = await getStaffAccessToken(staffId);

  const event: GraphEventPayload = {
    subject: opts.subject,
    body: { contentType: 'HTML', content: opts.htmlBody },
    start: { dateTime: opts.startIso, timeZone: 'Australia/Melbourne' },
    end: { dateTime: opts.endIso, timeZone: 'Australia/Melbourne' },
    location: opts.location ? { displayName: opts.location } : undefined,
    attendees: (opts.attendees ?? []).map(e => ({
      emailAddress: { address: e },
      type: 'required',
    })),
  };

  if (opts.isTeamsMeeting) {
    event.isOnlineMeeting = true;
    event.onlineMeetingProvider = 'teamsForBusiness';
  }

  const resp = await axios.post(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}/calendar/events`,
    event,
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
  );

  return {
    eventId: resp.data.id,
    teamsUrl: resp.data.onlineMeeting?.joinUrl,
  };
}

// ── Calendar: List upcoming events ──

export async function listUpcomingEvents(staffId: string, days = 7): Promise<UpcomingCalendarEvent[]> {
  const { token, email } = await getStaffAccessToken(staffId);
  const start = new Date().toISOString();
  const end = new Date(Date.now() + days * 86400000).toISOString();

  const resp = await axios.get(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}/calendarView?startDateTime=${start}&endDateTime=${end}&$orderby=start/dateTime&$top=50`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  const events = Array.isArray(resp.data?.value) ? (resp.data.value as GraphCalendarEvent[]) : [];

  return events.map((ev) => ({
    id: ev.id,
    subject: ev.subject ?? '',
    start: ev.start?.dateTime,
    end: ev.end?.dateTime,
    location: ev.location?.displayName,
    isTeams: !!ev.onlineMeeting?.joinUrl,
    teamsUrl: ev.onlineMeeting?.joinUrl,
    attendees: (ev.attendees ?? [])
      .map((attendee) => attendee.emailAddress?.address)
      .filter((address): address is string => typeof address === 'string' && address.length > 0),
  }));
}

// ── SharePoint: Upload document ──

export async function uploadToSharePoint(staffId: string, opts: {
  fileName: string;
  content: Buffer | string;
  folder?: string;
  /**
   * Audit Tier 7.5 (MED-I4) — per-clinic Sharepoint site override.
   * When provided, takes precedence over the O365_SHAREPOINT_SITE
   * env-var default. Caller is expected to pass this from the
   * clinic_settings.sharepoint_site_id column (route uses
   * getSharepointSiteForClinic() to fetch it).
   */
  sharepointSiteId?: string;
}): Promise<{ fileUrl: string; fileId: string }> {
  const { token } = await getStaffAccessToken(staffId);
  const folder = opts.folder ?? 'Clinical Documents';
  // Precedence: per-clinic override > env default > 'root'.
  const sitePath = opts.sharepointSiteId ?? process.env.O365_SHAREPOINT_SITE ?? 'root';

  const resp = await axios.put(
    `https://graph.microsoft.com/v1.0/sites/${sitePath}/drive/root:/${folder}/${opts.fileName}:/content`,
    opts.content,
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' } },
  );

  return { fileUrl: resp.data.webUrl, fileId: resp.data.id };
}

/**
 * Audit Tier 7.5 — fetch the clinic's configured Sharepoint site id
 * from clinic_settings. Returns `undefined` when the row is absent
 * or the column is NULL; caller then uses the env default.
 */
export async function getSharepointSiteForClinic(clinicId: string): Promise<string | undefined> {
  const { db } = await import('../../db/db');
  try {
    const row = await db('clinic_settings')
      .where({ clinic_id: clinicId })
      .select('sharepoint_site_id')
      .first();
    return (row?.sharepoint_site_id as string | null | undefined) ?? undefined;
  } catch {
    return undefined;
  }
}

// ── OneDrive: List files in a folder ──

export async function listOneDriveFiles(staffId: string, folder = 'Clinical Documents'): Promise<OneDriveFileSummary[]> {
  const { token } = await getStaffAccessToken(staffId);

  const resp = await axios.get(
    `https://graph.microsoft.com/v1.0/me/drive/root:/${folder}:/children?$orderby=lastModifiedDateTime desc&$top=20`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  const files = Array.isArray(resp.data?.value) ? (resp.data.value as GraphDriveItem[]) : [];

  return files.map((file) => ({
    id: file.id,
    name: file.name,
    size: file.size,
    lastModified: file.lastModifiedDateTime,
    webUrl: file.webUrl,
  }));
}

export function isOffice365Configured(): boolean {
  return !!(config.O365_CLIENT_ID && config.O365_TENANT_ID && config.O365_CLIENT_SECRET);
}
