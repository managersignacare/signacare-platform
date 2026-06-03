// apps/api/src/features/llm/letterDeliveryService.ts
//
// Tier 16 — letter delivery / export / translation / revision service.
//
// The service is thin — each function is the single place that knows
// how to dispatch to the integration clients (Tier 8 skeletons),
// record an attempt in letter_deliveries, and interpret the response.
// Routes stay thin adapters.

import PDFDocument from 'pdfkit';
import type { AuthContext } from '@signacare/shared';
import { db } from '../../db/db';
import { HttpError } from '../../shared/errors';
import { logger } from '../../utils/logger';
// BUG-276 L4 absorb — deliver + export are PHI-egress paths. An
// unrelated clinician must not be able to fax, email, MHR-push, or
// export a letter for a patient they have no care relationship with.
// Rule 6 (PHI egress consent).
import { requirePatientRelationship } from '../../shared/authGuards';
import {
  isHealthLinkConfigured,
  sendLetter as healthlinkSendLetter,
} from '../../integrations/healthlink/healthLinkClient';
import {
  isMhrDocumentApiConfigured,
  pushDocument as mhrPushDocument,
} from '../../integrations/mhr/mhrDocumentClient';

export type DeliveryChannel =
  | 'healthlink' | 'mhr_docref' | 'email' | 'fax' | 'print' | 'secure_link';

export interface DeliveryRequest {
  channel: DeliveryChannel;
  recipientName: string;
  recipientAddress?: string;
  recipientEmail?: string;
  recipientFax?: string;
  recipientMhrIhi?: string;
}

export interface DeliveryResult {
  deliveryId: string;
  status: 'queued' | 'in_flight' | 'delivered' | 'failed';
  receiptId?: string;
  error?: string;
}

/**
 * Attempt delivery on the supplied channel. Records the attempt in
 * letter_deliveries in ALL paths — success records receipt_id, failure
 * records error text. NOT_IMPLEMENTED throws (when integration flag is
 * disabled) are treated as failures so the audit trail is complete.
 */
export async function deliverLetter(
  auth: AuthContext,
  letterId: string,
  req: DeliveryRequest,
): Promise<DeliveryResult> {
  const letter = await db('letters')
    .where({ id: letterId, clinic_id: auth.clinicId })
    .first();
  if (!letter) throw new HttpError(404, 'LETTER_NOT_FOUND', 'Letter not found');

  // BUG-276 L4 absorb — PHI egress gate. An unrelated clinician must
  // not be able to deliver (healthlink / MHR / email / fax / print /
  // secure_link) a letter. Relationship check runs BEFORE the status
  // check so cross-patient probes get uniform 403 not a state-
  // discriminating 409.
  await requirePatientRelationship(auth, letter.patient_id);

  if (letter.status !== 'approved' && letter.status !== 'sent') {
    throw new HttpError(409, 'INVALID_TRANSITION', 'Letter must be approved before delivery');
  }

  // Create the row first so we have an id for the receipt mapping.
  const [delivery] = await db('letter_deliveries')
    .insert({
      clinic_id: auth.clinicId,
      letter_id: letterId,
      channel: req.channel,
      recipient_name: req.recipientName,
      recipient_address: req.recipientAddress ?? null,
      recipient_email: req.recipientEmail ?? null,
      recipient_fax: req.recipientFax ?? null,
      recipient_mhr_ihi: req.recipientMhrIhi ?? null,
      status: 'in_flight',
      sent_by: auth.staffId,
      attempted_at: new Date(),
      attempt_count: 1,
    })
    .returning(['id']);

  let status: DeliveryResult['status'] = 'failed';
  let receiptId: string | undefined;
  let error: string | undefined;

  try {
    if (req.channel === 'healthlink') {
      if (!isHealthLinkConfigured()) {
        throw new Error('HEALTHLINK_NOT_CONFIGURED');
      }
      // Build a minimal CDA envelope — full CDA construction lives in
      // Tier 16.x once the HealthLink partner contract is in place.
      const cdaStub = `<?xml version="1.0" encoding="UTF-8"?>\n<ClinicalDocument><id root="${letter.id}"/><title>${letter.subject}</title><text>${letter.rendered_text ?? ''}</text></ClinicalDocument>`;
      const result = await healthlinkSendLetter({
        letterId: letter.id,
        recipientHealthLinkId: req.recipientAddress ?? '',
        recipientName: req.recipientName,
        cdaXml: cdaStub,
      });
      receiptId = result.externalId;
      status = 'delivered';
    } else if (req.channel === 'mhr_docref') {
      if (!isMhrDocumentApiConfigured()) {
        throw new Error('MHR_NOT_CONFIGURED');
      }
      if (!req.recipientMhrIhi) {
        throw new Error('MHR_IHI_REQUIRED');
      }
      // See Tier 16.3 — the full CDA builder + HPI-O/HPII lookup
      // flow will live in the scribe/integrations layer; the stubbed
      // fields here are what the wiring layer will supply in the
      // finished implementation.
      const result = await mhrPushDocument({
        patientId: letter.patient_id,
        patientIhi: req.recipientMhrIhi,
        clinicHpio: '',
        authorHpii: '',
        letterId: letter.id,
        documentType: 'specialist_letter',
        cdaXml: `<?xml version="1.0" encoding="UTF-8"?>\n<ClinicalDocument><id root="${letter.id}"/></ClinicalDocument>`,
        createdAt: new Date().toISOString(),
      });
      receiptId = result.externalDocId;
      status = 'delivered';
    } else if (req.channel === 'print') {
      // "Print" is a local action — the clinician downloads the PDF
      // and posts it. Delivery is marked delivered immediately; the
      // real-world receipt is the physical despatch, tracked
      // elsewhere.
      status = 'delivered';
      receiptId = `print:${delivery.id}`;
    } else if (req.channel === 'email' || req.channel === 'fax' || req.channel === 'secure_link') {
      // email + fax + secure_link are Tier 16.x follow-ups that
      // require SMTP / fax-provider / short-link infrastructure
      // (all flag-gated). For now the delivery is queued; the
      // background worker (future) picks it up.
      status = 'queued';
    } else {
      throw new Error(`UNKNOWN_CHANNEL:${req.channel}`);
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    status = 'failed';
    logger.warn({ err: error, letterId, channel: req.channel }, 'Letter delivery failed');
  }

  await db('letter_deliveries')
    .where({ id: delivery.id, clinic_id: auth.clinicId })
    .update({
      status,
      receipt_id: receiptId ?? null,
      delivered_at: status === 'delivered' ? new Date() : null,
      error: error ?? null,
      updated_at: new Date(),
    });

  // Advance the letter to 'sent' on first successful delivery.
  if (status === 'delivered' && letter.status === 'approved') {
    await db('letters').where({ id: letterId, clinic_id: auth.clinicId }).update({
      status: 'sent',
      sent_by: auth.staffId,
      sent_at: new Date(),
      updated_at: new Date(),
    });
    await db('letter_audit_log').insert({
      clinic_id: auth.clinicId,
      letter_id: letterId,
      event: 'sent',
      actor_id: auth.staffId,
      actor_role: auth.role,
      diff_summary: JSON.stringify({ channel: req.channel, receiptId }),
    });
  }

  return {
    deliveryId: delivery.id,
    status,
    receiptId,
    error,
  };
}

/**
 * Render a letter to an export artefact. PDF uses pdfkit + the clinic
 * letterhead; CDA + FHIR produce placeholder XML/JSON pointing at the
 * Tier 8 clients (they throw NOT_IMPLEMENTED until their integration
 * flag is flipped). plain_text is always available.
 */
export async function exportLetter(
  auth: AuthContext,
  letterId: string,
  format: 'pdf' | 'cda_document' | 'fhir_composition' | 'plain_text',
): Promise<{ exportId: string; format: string; contentRef: string; contentSize: number; content: Buffer }> {
  const letter = await db('letters')
    .where({ id: letterId, clinic_id: auth.clinicId })
    .first();
  if (!letter) throw new HttpError(404, 'LETTER_NOT_FOUND', 'Letter not found');

  // BUG-276 L4 absorb — export hands PDF/CDA/FHIR bytes to the caller.
  // Same PHI-egress concern as deliverLetter (Rule 6).
  await requirePatientRelationship(auth, letter.patient_id);

  const sections = await db('letter_sections')
    .where({ letter_id: letterId, clinic_id: auth.clinicId })
    .orderBy('section_order', 'asc');

  const settings = await db('clinic_settings')
    .where({ clinic_id: auth.clinicId })
    .select('letterhead_html', 'letterhead_logo_url')
    .first();

  let content: Buffer;
  if (format === 'plain_text') {
    const body = sections
      .map((s) => `${s.label}\n\n${s.content?.trim() ?? ''}`)
      .join('\n\n');
    content = Buffer.from(`${letter.subject}\n\n${body}`, 'utf8');
  } else if (format === 'pdf') {
    content = await renderPdf({
      subject: letter.subject,
      sections,
      letterhead: settings?.letterhead_html ?? null,
    });
  } else if (format === 'cda_document') {
    // CDA R2 document is a well-defined shape; the full renderer
    // requires a CDA-schema-validated builder + clinic OID that the
    // Tier 8 HealthLink client will carry. For now produce a
    // structural stub XML + tag with the letter id so the export
    // trail is recorded; wiring to the HealthLink/MHR CDA pipeline
    // is a Tier 16.x follow-up.
    content = Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?>\n<ClinicalDocument xmlns="urn:hl7-org:v3">\n  <id root="${letter.id}"/>\n  <title>${escapeXml(letter.subject)}</title>\n  <!-- STUB: full CDA rendering pending Tier 16.x wiring to HealthLink CDA pipeline -->\n</ClinicalDocument>`,
      'utf8',
    );
  } else {
    // fhir_composition — FHIR R4 Composition JSON. Structural stub
    // pending Tier 16.x wiring.
    content = Buffer.from(JSON.stringify({
      resourceType: 'Composition',
      id: letter.id,
      status: letter.status === 'sent' ? 'final' : 'preliminary',
      type: { coding: [{ system: 'http://loinc.org', code: '11488-4', display: 'Consult note' }] },
      subject: { reference: `Patient/${letter.patient_id}` },
      date: letter.created_at,
      title: letter.subject,
      section: sections.map((s) => ({
        title: s.label,
        text: { status: 'generated', div: `<div xmlns="http://www.w3.org/1999/xhtml">${escapeXml(s.content ?? '')}</div>` },
      })),
      _note: 'STUB: full FHIR composition rendering pending Tier 16.x',
    }, null, 2), 'utf8');
  }

  const contentRef = `letter-exports/${auth.clinicId}/${letterId}/${format}-${Date.now()}`;
  const [row] = await db('letter_exports')
    .insert({
      clinic_id: auth.clinicId,
      letter_id: letterId,
      format,
      content_ref: contentRef,
      content_size_bytes: content.length,
      generated_by: auth.staffId,
    })
    .returning(['id']);

  return {
    exportId: row.id,
    format,
    contentRef,
    contentSize: content.length,
    content,
  };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function renderPdf(input: {
  subject: string;
  sections: Array<{ label: string; content: string }>;
  letterhead: string | null;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    if (input.letterhead) {
      // Render the letterhead as plain text (strip HTML tags naively).
      // A richer renderer (HTML-to-PDF via e.g. Puppeteer) is Tier 16.x
      // — this keeps the structural path in place so the swap is
      // mechanical.
      const plain = input.letterhead.replace(/<[^>]+>/g, '').trim();
      doc.fontSize(10).text(plain, { align: 'right' });
      doc.moveDown();
    }

    doc.fontSize(16).text(input.subject, { align: 'left' });
    doc.moveDown();

    for (const s of input.sections) {
      doc.fontSize(12).text(s.label, { underline: true });
      doc.moveDown(0.2);
      doc.fontSize(11).text(s.content?.trim() ?? '', { align: 'left' });
      doc.moveDown();
    }

    doc.end();
  });
}

/**
 * Create a revision after an approved letter is re-opened. The
 * previous rendered_text is captured so the pre-change state is
 * preserved forever.
 */
export async function openRevision(
  auth: AuthContext,
  letterId: string,
  reasonCategory: string,
  reasonDetail: string,
): Promise<{ revisionNumber: number }> {
  return db.transaction(async (trx) => {
    const letter = await trx('letters')
      .where({ id: letterId, clinic_id: auth.clinicId })
      .first();
    if (!letter) throw new HttpError(404, 'LETTER_NOT_FOUND', 'Letter not found');

    // BUG-276 L4 absorb — revising an already-approved letter creates
    // a new clinical edit surface. Relationship gate required.
    await requirePatientRelationship(auth, letter.patient_id);

    if (letter.status !== 'approved' && letter.status !== 'sent') {
      throw new HttpError(409, 'INVALID_TRANSITION', 'Only approved or sent letters can be revised');
    }

    const nextRev = (letter.revision ?? 1) + 1;
    await trx('letter_revisions').insert({
      clinic_id: auth.clinicId,
      letter_id: letterId,
      revision_number: nextRev,
      previous_rendered_text: letter.rendered_text,
      reason_category: reasonCategory,
      reason_detail: reasonDetail,
      requested_by: auth.staffId,
    });

    await trx('letters').where({ id: letterId }).update({
      status: 'revised',
      revision: nextRev,
      updated_at: new Date(),
    });

    await trx('letter_audit_log').insert({
      clinic_id: auth.clinicId,
      letter_id: letterId,
      event: 'revised',
      actor_id: auth.staffId,
      actor_role: auth.role,
      diff_summary: JSON.stringify({ reasonCategory, reasonDetail, revisionNumber: nextRev }),
    });

    return { revisionNumber: nextRev };
  });
}
