// apps/api/src/shared/pbsPrescriptionPdf.ts
//
// BUG-294 — PBS paper prescription PDF generator.
//
// Renders a single prescription as a three-up A4 PDF (prescriber /
// dispensing / patient copies) matching the PBS paper prescription
// spec (publicly available at pbs.gov.au). Embeds a GS1 DataMatrix
// barcode encoding the eRx token so a pharmacist can scan directly
// to the dispensing system.
//
// Dependencies: pdfkit (already used by generateLetterPdf) +
// bwip-js (BUG-294 — DataMatrix barcode generation). bwip-js is
// pure-JS (no native addon) so it runs in any Node env.
//
// Feature-flag / go-live: ETP1 paper workflow depends on this
// generator being wired at the prescription-sign endpoint. The
// prescription fixture returned by the buildPrescriptionData helper
// below is what medicationController will pass in when the UI
// Print-Script action is invoked. Hardening (state-specific
// variations, S8-pad crypto fingerprint, pharmacy-submission QR code)
// tracked as BUG-344 follow-up.

import PDFDocument from 'pdfkit';
// bwip-js — force the CommonJS Node build. The ESM bundle has a known
// dual-package hazard in 4.10 (bwipp_jabcode import/export mismatch)
// under test loaders; CJS exposes the same toBuffer API reliably.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const bwipjs = require('bwip-js') as {
  toBuffer(opts: Record<string, unknown>): Promise<Buffer>;
};

export interface PbsPrescriptionPdfInput {
  // ── Prescriber ──
  prescriberName: string;
  prescriberQualifications?: string;
  prescriberNumber: string;                 // PBS prescriber number (7 digits)
  providerNumber?: string;                  // Medicare provider number
  hpii?: string;                            // HPI-I (16 digits, 800361…)
  prescriberAddress?: string;
  prescriberPhone?: string;

  // ── Patient ──
  patientName: string;
  patientDob: string;                       // ISO or display date
  patientAddress?: string;
  patientIhi?: string;                      // 16-digit IHI (800360…)
  patientMedicareNumber?: string;
  patientMedicareIrn?: string;
  patientConcessionNumber?: string;         // pensioner/DVA

  // ── Clinic ──
  clinicName: string;
  clinicAddress?: string;
  clinicPhone?: string;
  clinicHpio?: string;                      // HPI-O (16 digits, 800362…)

  // ── Prescription ──
  prescriptionDate: string;                 // ISO or display
  medicationGenericName: string;
  medicationBrandName?: string;
  dose: string;
  route: string;
  frequency: string;
  directions: string;
  quantity: string;
  repeats: number;
  pbsItemCode?: string;
  isAuthority: boolean;
  authorityCode?: string;
  isS8: boolean;
  erxToken?: string;                        // eRx token string for DataMatrix barcode
  prescriptionId: string;                   // stable app-side prescription id
}

const COPY_LABELS = ['Prescriber Copy', 'Dispensing Copy', 'Patient Copy'] as const;

/**
 * Render a GS1 DataMatrix barcode encoding the eRx token. Returns a
 * PNG buffer sized for the PDF embed (target ≈ 120x120 pt at 72 DPI).
 * Returns null when the token is absent (paper-only flow).
 */
async function renderDataMatrixBarcode(token: string): Promise<Buffer> {
  return bwipjs.toBuffer({
    bcid: 'datamatrix',
    text: token,
    scale: 3,
    includetext: false,
    backgroundcolor: 'FFFFFF',
  });
}

/**
 * Generate the PBS paper prescription PDF buffer. Three copies are
 * rendered on a single A4 page separated by cut lines, matching the
 * physical three-up pre-printed S8 pad convention.
 */
export async function generatePbsPrescriptionPdf(
  input: PbsPrescriptionPdfInput,
): Promise<Buffer> {
  const barcodePng = input.erxToken
    ? await renderDataMatrixBarcode(input.erxToken)
    : null;

  return new Promise((resolve, reject) => {
    try {
      // compress:false so content streams are uncompressed. This makes
      // unit tests able to grep markers in the raw buffer. Disabling
      // compression roughly doubles the PDF size but this is fine —
      // prescriptions are one-page, and the printer-side workflow does
      // its own compression at transport.
      const doc = new PDFDocument({ size: 'A4', margin: 40, compress: false });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // A4 = 595 × 842 pt. Three horizontal panels ≈ 267 pt tall each
      // (minus page margins). Copy cut-line between panels.
      const pageHeight = 842;
      const panelHeight = (pageHeight - 80) / 3;

      for (let i = 0; i < 3; i++) {
        if (i > 0) {
          // Cut-line between panels
          const y = 40 + i * panelHeight;
          doc.strokeColor('#999999').dash(4, { space: 4 }).lineWidth(0.5)
            .moveTo(40, y).lineTo(555, y).stroke();
          doc.undash();
          doc.moveDown(0.2);
        }
        const panelTop = 40 + i * panelHeight + (i > 0 ? 6 : 0);
        renderPanel(doc, input, COPY_LABELS[i], panelTop, panelHeight - (i > 0 ? 6 : 0), barcodePng);
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function renderPanel(
  doc: PDFKit.PDFDocument,
  input: PbsPrescriptionPdfInput,
  label: string,
  top: number,
  height: number,
  barcodePng: Buffer | null,
): void {
  const left = 40;
  const right = 555;
  const contentWidth = right - left;

  // ── Header strip: copy label + S8/Authority flags ──
  doc.save();
  doc.rect(left, top, contentWidth, 18)
    .fillColor(input.isS8 ? '#B22222' : '#327C8D').fill();
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#FFFFFF');
  doc.text(`PBS PRESCRIPTION — ${label}`, left + 6, top + 5, { continued: true });
  if (input.isS8) doc.text('  |  SCHEDULE 8 (S8)', { continued: true });
  if (input.isAuthority) doc.text(input.authorityCode
    ? `  |  AUTHORITY ${input.authorityCode}`
    : '  |  AUTHORITY REQUIRED');
  else doc.text('');
  doc.restore();

  // ── Clinic letterhead (top-left) + Barcode (top-right) ──
  let y = top + 24;
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#222222')
    .text(input.clinicName, left, y);
  y += 12;
  if (input.clinicAddress) {
    doc.fontSize(8).font('Helvetica').fillColor('#555555')
      .text(input.clinicAddress, left, y);
    y += 10;
  }
  if (input.clinicPhone) {
    doc.fontSize(8).font('Helvetica').fillColor('#555555')
      .text(`Ph: ${input.clinicPhone}`, left, y);
    y += 10;
  }
  if (input.clinicHpio) {
    doc.fontSize(7).font('Helvetica').fillColor('#888888')
      .text(`HPI-O: ${input.clinicHpio}`, left, y);
    y += 9;
  }

  if (barcodePng) {
    try {
      // Anchor barcode top-right. Fixed size 60x60 pt so the DataMatrix
      // stays scannable at typical pharmacy scanner resolution.
      doc.image(barcodePng, right - 60, top + 24, { width: 60, height: 60 });
      doc.fontSize(6).font('Helvetica').fillColor('#888888')
        .text('eRx token', right - 60, top + 88, { width: 60, align: 'center' });
    } catch {
      // Barcode embed failure is non-fatal — the printed token string
      // below still identifies the prescription.
    }
  }

  // ── Prescriber block ──
  y = Math.max(y, top + 95) + 4;
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#222222')
    .text(input.prescriberName, left, y);
  y += 11;
  if (input.prescriberQualifications) {
    doc.fontSize(8).font('Helvetica').fillColor('#555555')
      .text(input.prescriberQualifications, left, y);
    y += 10;
  }
  const prescriberDetails = [
    `Prescriber: ${input.prescriberNumber}`,
    input.providerNumber ? `Provider: ${input.providerNumber}` : '',
    input.hpii ? `HPI-I: ${input.hpii}` : '',
  ].filter(Boolean).join('  |  ');
  doc.fontSize(7).font('Helvetica').fillColor('#555555')
    .text(prescriberDetails, left, y);
  y += 12;

  // ── Patient block ──
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#222222')
    .text('Patient:', left, y, { continued: true });
  doc.font('Helvetica')
    .text(` ${input.patientName}`, { continued: true });
  doc.font('Helvetica').fillColor('#555555')
    .text(`  DOB: ${input.patientDob}`);
  y = doc.y + 2;

  const patientIds = [
    input.patientMedicareNumber
      ? `Medicare: ${input.patientMedicareNumber}${input.patientMedicareIrn ? '/' + input.patientMedicareIrn : ''}`
      : '',
    input.patientIhi ? `IHI: ${input.patientIhi}` : '',
    input.patientConcessionNumber ? `Concession: ${input.patientConcessionNumber}` : '',
  ].filter(Boolean).join('  |  ');
  if (patientIds) {
    doc.fontSize(7).fillColor('#555555').text(patientIds, left, y);
    y = doc.y + 4;
  }
  if (input.patientAddress) {
    doc.fontSize(7).fillColor('#666666').text(input.patientAddress, left, y);
    y = doc.y + 4;
  }

  // ── Rx line ──
  doc.strokeColor('#cccccc').lineWidth(0.5)
    .moveTo(left, y).lineTo(right, y).stroke();
  y += 4;

  doc.fontSize(11).font('Helvetica-Bold').fillColor('#222222')
    .text(`℞  ${input.medicationGenericName}`, left, y);
  y = doc.y + 2;
  if (input.medicationBrandName) {
    doc.fontSize(8).font('Helvetica').fillColor('#777777')
      .text(`(brand: ${input.medicationBrandName})`, left, y);
    y = doc.y + 2;
  }
  doc.fontSize(9).font('Helvetica').fillColor('#333333')
    .text(`${input.dose}  •  ${input.route}  •  ${input.frequency}`, left, y);
  y = doc.y + 2;
  doc.fontSize(9).font('Helvetica').fillColor('#333333')
    .text(`Directions: ${input.directions}`, left, y);
  y = doc.y + 4;

  // ── Quantity / Repeats / PBS ──
  const rxMeta = [
    `Qty: ${input.quantity}`,
    `Repeats: ${input.repeats}`,
    input.pbsItemCode ? `PBS: ${input.pbsItemCode}` : 'Private',
  ].join('  |  ');
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#222222')
    .text(rxMeta, left, y);
  y = doc.y + 4;

  // ── Date + signature line ──
  doc.fontSize(8).font('Helvetica').fillColor('#555555')
    .text(`Date: ${input.prescriptionDate}`, left, y);
  y = doc.y + 8;
  doc.strokeColor('#444444').lineWidth(0.5)
    .moveTo(left, y + 10).lineTo(left + 200, y + 10).stroke();
  doc.fontSize(7).fillColor('#888888')
    .text('Prescriber signature', left, y + 12);

  // ── Footer: prescription id + token string ──
  const footerY = top + height - 16;
  doc.fontSize(6).font('Helvetica').fillColor('#999999')
    .text(
      `Rx ID: ${input.prescriptionId}${input.erxToken ? '  |  Token: ' + input.erxToken : ''}`,
      left,
      footerY,
      { width: contentWidth, align: 'center' },
    );
}
