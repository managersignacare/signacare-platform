// apps/api/src/shared/pdfGenerator.ts
//
// Server-side PDF generation for letters, discharge summaries, reports.
// Uses PDFKit (pure Node.js — no Chromium dependency).

import PDFDocument from 'pdfkit';

/**
 * Generate a PDF buffer from structured letter content.
 */
export async function generateLetterPdf(params: {
  clinicName: string;
  clinicAddress?: string;
  clinicPhone?: string;
  clinicEmail?: string;
  date: string;
  recipientName: string;
  patientName: string;
  patientDob: string;
  patientUrNumber: string;
  body: string;
  authorName: string;
  authorTitle?: string;
  authorQualifications?: string;
  /** Base64 data URL of the author's digital signature (data:image/png;base64,...) */
  signatureDataUrl?: string | null;
  /** Whether to include the signature in the PDF */
  includeSignature?: boolean;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 60 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // ── Letterhead ──
      doc.fontSize(16).font('Helvetica-Bold').fillColor('#327C8D')
        .text(params.clinicName, { align: 'left' });
      doc.fontSize(9).font('Helvetica').fillColor('#666666');
      if (params.clinicAddress) doc.text(params.clinicAddress);
      const contactLine = [
        params.clinicPhone ? `Ph: ${params.clinicPhone}` : '',
        params.clinicEmail ?? '',
      ].filter(Boolean).join('  |  ');
      if (contactLine) doc.text(contactLine);
      doc.moveDown(0.5);

      // Divider
      doc.strokeColor('#327C8D').lineWidth(1.5)
        .moveTo(60, doc.y).lineTo(535, doc.y).stroke();
      doc.moveDown(1);

      // ── Date ──
      doc.fontSize(10).font('Helvetica').fillColor('#333333')
        .text(params.date, { align: 'right' });
      doc.moveDown(1);

      // ── Recipient ──
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#333333')
        .text(params.recipientName);
      doc.moveDown(0.5);

      // ── Re: Patient ──
      doc.fontSize(11).font('Helvetica-Bold')
        .text(`Re: ${params.patientName}`);
      doc.fontSize(9).font('Helvetica').fillColor('#666666')
        .text(`DOB: ${params.patientDob}  |  UR: ${params.patientUrNumber}`);
      doc.moveDown(1);

      // ── Greeting ──
      doc.fontSize(10).font('Helvetica').fillColor('#333333')
        .text(`Dear ${params.recipientName.split(',')[0]},`);
      doc.moveDown(0.5);

      // ── Body ──
      const lines = params.body.split('\n');
      for (const line of lines) {
        doc.fontSize(10).font('Helvetica').fillColor('#333333')
          .text(line, { lineGap: 3 });
      }
      doc.moveDown(1.5);

      // ── Closing ──
      doc.fontSize(10).font('Helvetica').fillColor('#333333')
        .text('Yours sincerely,');
      doc.moveDown(0.5);

      // ── Signature image ──
      // Only embed if base64 is substantial (a real signature is 2KB+)
      // and is a valid PNG. Tiny/corrupt PNGs cause zlib crashes in PDFKit.
      if (params.includeSignature && params.signatureDataUrl) {
        const base64Match = params.signatureDataUrl.match(/^data:image\/png;base64,(.+)$/);
        if (base64Match && base64Match[1].length > 500) {
          try {
            const imgBuffer = Buffer.from(base64Match[1], 'base64');
            // Validate: PNG magic bytes + minimum viable size (> 100 bytes raw)
            const isPng = imgBuffer.length > 100
              && imgBuffer[0] === 0x89 && imgBuffer[1] === 0x50
              && imgBuffer[2] === 0x4E && imgBuffer[3] === 0x47;
            if (isPng) {
              doc.image(imgBuffer, { width: 160, height: 50 });
              doc.moveDown(0.3);
            }
          } catch {
            // Skip silently — don't block PDF generation
          }
        }
      }

      // ── Author details ──
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#333333')
        .text(params.authorName);
      if (params.authorTitle) {
        doc.fontSize(9).font('Helvetica').fillColor('#666666')
          .text(params.authorTitle);
      }
      if (params.authorQualifications) {
        doc.fontSize(8).font('Helvetica').fillColor('#888888')
          .text(params.authorQualifications);
      }

      // ── Footer ──
      doc.moveDown(3);
      doc.fontSize(8).font('Helvetica').fillColor('#999999')
        .text('Signacare — Confidential Clinical Document', { align: 'center' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
