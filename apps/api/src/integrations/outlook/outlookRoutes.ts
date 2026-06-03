// apps/api/src/features/integrations/outlook/outlookRoutes.ts
import { Router } from 'express';
import axios from 'axios';
import { config } from '../../config';
import { db } from '../../db/db';
import { authMiddleware } from '../../middleware/authMiddleware';
import { logger } from '../../utils/logger';

export const outlookRoutes = Router();

outlookRoutes.use(authMiddleware);

// Step 1 — frontend calls this to get the Microsoft login URL
outlookRoutes.get('/auth-url', (req, res) => {
  if (!config.O365_CLIENT_ID || !config.O365_TENANT_ID || !config.O365_REDIRECT_URI) {
    res.status(503).json({ error: 'Outlook integration not configured. Set O365_CLIENT_ID, O365_TENANT_ID, O365_CLIENT_SECRET, and O365_REDIRECT_URI in environment.' });
    return;
  }
  const params = new URLSearchParams({
    client_id: config.O365_CLIENT_ID,
    response_type: 'code',
    redirect_uri: config.O365_REDIRECT_URI,
    response_mode: 'query',
    scope: 'offline_access Calendars.ReadWrite Mail.Send Mail.Read Mail.ReadWrite OnlineMeetings.ReadWrite Files.ReadWrite.All Sites.ReadWrite.All',
    state: req.user?.id ?? 'unknown',
  });
  res.json({
    url: `https://login.microsoftonline.com/${config.O365_TENANT_ID}/oauth2/v2.0/authorize?${params.toString()}`,
  });
});

// Step 2 — Microsoft redirects here after consent
outlookRoutes.get('/auth-callback', async (req, res, next) => {
  try {
    const code = req.query['code'] as string;
    const staffId = req.query['state'] as string;

    const tokenUrl = `https://login.microsoftonline.com/${config.O365_TENANT_ID}/oauth2/v2.0/token`;
    const params = new URLSearchParams({
      client_id: config.O365_CLIENT_ID!,
      client_secret: config.O365_CLIENT_SECRET!,
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.O365_REDIRECT_URI!,
    });

    const tokenResp = await axios.post<{
      access_token: string;
      refresh_token: string;
      expires_in: number;
    }>(tokenUrl, params);

    const { access_token, refresh_token, expires_in } = tokenResp.data;

    // Get the clinician's Outlook email from Microsoft Graph
    const meResp = await axios.get<{ mail?: string; userPrincipalName: string }>(
      'https://graph.microsoft.com/v1.0/me',
      { headers: { Authorization: `Bearer ${access_token}` } },
    );

    const outlookEmail = meResp.data.mail ?? meResp.data.userPrincipalName;

    await db('staff')
      .where({ id: staffId })
      .update({
        outlook_email: outlookEmail,
        outlook_refresh_token: refresh_token,
        outlook_token_expires_at: Date.now() + (expires_in - 60) * 1000,
        updated_at: new Date(),
      });

    res.redirect('/settings/integrations?outlook=connected');
  } catch (err) {
    next(err);
  }
});

// Step 3 — disconnect
outlookRoutes.delete('/disconnect', async (req, res, next) => {
  try {
    const staffId = req.user?.id as string;
    await db('staff')
      .where({ id: staffId })
      .update({
        outlook_email: null,
        outlook_refresh_token: null,
        outlook_token_expires_at: null,
        updated_at: new Date(),
      });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Step 4 — check connection status
outlookRoutes.get('/status', async (req, res, _next) => {
  try {
    const staffId = req.user?.id as string;
    const staff = await db('staff').where({ id: staffId }).first('outlook_email');
    res.json({
      connected: !!staff?.outlook_email,
      email: staff?.outlook_email ?? null,
      configured: !!(config.O365_CLIENT_ID && config.O365_TENANT_ID),
    });
  } catch {
    // Column might not exist yet
    res.json({ connected: false, email: null, configured: !!(config.O365_CLIENT_ID && config.O365_TENANT_ID) });
  }
});

// ── Email: Send ──
outlookRoutes.post('/send-email', async (req, res, next) => {
  try {
    const { sendEmail, formatClinicalLetterHtml } = await import('./outlookEmailService');
    const staffId = req.user?.id as string;
    const { to, cc, subject, body, recipientName, patientName, isLetter } = req.body;

    // Get sender details
    const staff = await db('staff').where({ id: staffId }).first('given_name', 'family_name');
    const clinicianName = staff ? `${staff.given_name} ${staff.family_name}` : 'Clinician';

    let htmlBody: string;
    if (isLetter) {
      htmlBody = formatClinicalLetterHtml({
        recipientName: recipientName ?? 'Doctor',
        patientName: patientName ?? 'Patient',
        clinicianName,
        clinicianTitle: 'Treating Clinician',
        serviceName: 'Mental Health Service',
        body,
      });
    } else {
      htmlBody = `<div style="font-family: 'Segoe UI', Arial, sans-serif; white-space: pre-wrap;">${body}</div>`;
    }

    await sendEmail(staffId, {
      to: Array.isArray(to) ? to : [to],
      cc: cc ? (Array.isArray(cc) ? cc : [cc]) : undefined,
      subject,
      htmlBody,
    });
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, 'Outlook send-email failed');
    next(err);
  }
});

// ── Teams: Create meeting ──
outlookRoutes.post('/teams-meeting', async (req, res, next) => {
  try {
    const { createTeamsMeeting } = await import('./office365Service');
    const { subject, startIso, endIso, attendees } = req.body;
    const result = await createTeamsMeeting(req.user!.id, { subject, startIso, endIso, attendees });
    res.json(result);
  } catch (err) {
    logger.error({ err }, 'Outlook teams-meeting failed');
    next(err);
  }
});

// ── Calendar: Create event with optional Teams ──
outlookRoutes.post('/calendar-event', async (req, res, next) => {
  try {
    const { createCalendarEvent } = await import('./office365Service');
    const result = await createCalendarEvent(req.user!.id, req.body);
    res.json(result);
  } catch (err) {
    logger.error({ err }, 'Outlook calendar-event failed');
    next(err);
  }
});

// ── Calendar: List upcoming ──
outlookRoutes.get('/calendar', async (req, res, next) => {
  try {
    const { listUpcomingEvents } = await import('./office365Service');
    const days = parseInt(req.query.days as string, 10) || 7;
    const events = await listUpcomingEvents(req.user!.id, days);
    res.json({ events });
  } catch (err) {
    logger.error({ err }, 'Outlook calendar list failed');
    next(err);
  }
});

// ── SharePoint: Upload ──
outlookRoutes.post('/sharepoint/upload', async (req, res, next) => {
  try {
    const { uploadToSharePoint, getSharepointSiteForClinic } = await import('./office365Service');
    // Audit Tier 7.5 — read the per-clinic Sharepoint site from
    // clinic_settings before the upload. Falls back to the env
    // default when unset.
    const sharepointSiteId = await getSharepointSiteForClinic(req.clinicId);
    const result = await uploadToSharePoint(req.user!.id, { ...req.body, sharepointSiteId });
    res.json(result);
  } catch (err) {
    logger.error({ err }, 'Outlook sharepoint upload failed');
    next(err);
  }
});

// ── Office 365 status ──
outlookRoutes.get('/o365-status', async (req, res, _next) => {
  try {
    const { isOffice365Configured } = await import('./office365Service');
    const staff = await db('staff').where({ id: req.user!.id }).first('outlook_email');
    res.json({
      configured: isOffice365Configured(),
      connected: !!staff?.outlook_email,
      email: staff?.outlook_email ?? null,
      features: {
        email: true,
        calendar: true,
        teams: true,
        sharepoint: !!process.env.O365_SHAREPOINT_SITE,
      },
    });
  } catch {
    res.json({ configured: false, connected: false, email: null, features: {} });
  }
});

// ── Email: Read inbox ──
outlookRoutes.get('/inbox', async (req, res, next) => {
  try {
    const { readInboxEmails } = await import('./outlookEmailService');
    const staffId = req.user?.id as string;
    const unreadOnly = req.query.unreadOnly === 'true';
    const limit = parseInt(req.query.limit as string, 10) || 20;
    const emails = await readInboxEmails(staffId, { unreadOnly, limit });
    res.json({ emails });
  } catch (err) {
    logger.error({ err }, 'Outlook inbox read failed');
    next(err);
  }
});