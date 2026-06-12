// apps/web/src/features/medications/hooks/usePrescriber.ts
//
// BUG-524-B — extracted from MedicationsTab.tsx (was L43-63 + L167-314)
// per the hybrid 2-tab split plan. Two related hooks consumed by the
// CurrentMeds + LAI + Clozapine sub-sections of ActiveMedicationsTab.
//
// `usePrescriberStatus` checks whether the current user has a
// `prescriberNumber` set on their staff profile. Required for the
// "Prescribe" button affordance and the print-prescription path.
//
// `usePrintPrescription` builds an A5 landscape prescription HTML
// document (Australian PBS / Schedule 8 / LAI / Clozapine layout) and
// opens a print window. Reads staff + clinic + patient context via
// React-Query so the prescription header is auto-populated.

import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { tryAsync, isErr, isPrescriberSystemRole } from '@signacare/shared';
import { apiClient } from '../../../shared/services/apiClient';
import { useAuthStore } from '../../../shared/store/authStore';
import { escapeHtml } from '../../../shared/utils/escapeHtml';
import { patientsKeys, prescriptionKeys } from '../../patients/queryKeys';
import type { MedicationRow } from '../types';

interface StaffMeResponse {
  role?: string | null;
  prescriberNumber?: string | null;
  prescriber_number?: string | null;
  hasPrescribingPrivileges?: boolean | null;
  isPrescribingDisciplineEligible?: boolean | null;
}

export interface PrescriberEligibilitySnapshot {
  isPrescriber: boolean;
  isDisciplineEligible: boolean;
  canPrescribeClozapine: boolean;
}

// BUG-547 fix-registry compatibility contract (do not remove):
// `{ isPrescriber: boolean; isError: boolean }`
type PrescriberStatusLegacyContract = { isPrescriber: boolean; isError: boolean };

export function evaluatePrescriberEligibility(staff: StaffMeResponse | null | undefined): PrescriberEligibilitySnapshot {
  const hasPrescribingPrivileges = staff?.hasPrescribingPrivileges === true
    || isPrescriberSystemRole(staff?.role);
  const hasPrescriberNumber = !!(staff?.prescriberNumber ?? staff?.prescriber_number);
  const isPrescriber = hasPrescribingPrivileges && hasPrescriberNumber;
  const isDisciplineEligible = hasPrescribingPrivileges;
  return {
    isPrescriber,
    isDisciplineEligible,
    canPrescribeClozapine: isPrescriber,
  };
}

interface PrescriberPrintStaff {
  givenName?: string | null;
  given_name?: string | null;
  familyName?: string | null;
  family_name?: string | null;
  prescriberNumber?: string | null;
  prescriber_number?: string | null;
  providerNumber?: string | null;
  provider_number?: string | null;
  ahpraNumber?: string | null;
  ahpra_number?: string | null;
  hpii?: string | null;
  hpii_number?: string | null;
  qualifications?: string | null;
}

interface PrescriberPrintClinic {
  name?: string | null;
  address?: string | null;
  phone?: string | null;
  fax?: string | null;
  hpio?: string | null;
}

interface PrescriberPrintPatient {
  givenName?: string | null;
  given_name?: string | null;
  familyName?: string | null;
  family_name?: string | null;
  dateOfBirth?: string | null;
  date_of_birth?: string | null;
  addressLine1?: string | null;
  address_line1?: string | null;
  suburb?: string | null;
  state?: string | null;
  postcode?: string | null;
  medicareNumber?: string | null;
  medicare_number?: string | null;
  medicareSubNumerate?: string | null;
  medicare_irn?: string | null;
  ihi?: string | null;
  dvaNumber?: string | null;
  dva_number?: string | null;
  dvaCardColour?: string | null;
  dva_card_colour?: string | null;
  phone?: string | null;
  mobile?: string | null;
  gender?: string | null;
  sex?: string | null;
}

interface PrescriptionPrintData {
  prescriber: PrescriberPrintStaff | null;
  clinic: PrescriberPrintClinic | null;
  patient: PrescriberPrintPatient | null;
}

// ── Prescriber check ──
//
// BUG-547 closes the fail-CLOSED silent-catch class on the prescriber-
// status check. Pre-fix the queryFn used `try { ... } catch { return
// false; }` — fail-CLOSED is the right safety posture (block prescribing
// on transient failure rather than permit non-prescribers) BUT the
// silent catch hid every transient `staff/me` failure from observability
// (BUG-441 root shape). A clinician who just renewed their prescriber
// number could be told "you're not a prescriber" indefinitely with no
// indication that the staff/me fetch was failing. Per BUG-530 SSoT
// (CLAUDE.md §16.2), use tryAsync to surface failure via React-Query's
// isError state; fail-CLOSED safety preserved by the `data ?? false`
// fallback. Consumers (CurrentMedsPanel / LaiPanel / ClozapinePanel via
// usePrintPrescription, plus ActiveMedicationsTab parent) destructure
// the new `isError` flag to render a `<Alert severity="warning">`
// non-blocking advisory.
export function usePrescriberStatus(): PrescriberStatusLegacyContract & PrescriberEligibilitySnapshot {
  const user = useAuthStore(s => s.user);

  // All roles check /staff/me (no permission gate) for prescriberNumber.
  // Clinicians, admins, and superadmins must enter their prescriber number
  // via Settings > My Profile before they can prescribe.
  const { data, isError } = useQuery({
    queryKey: patientsKeys.staffPrescriber(user?.id),
    queryFn: async () => {
      if (!user?.id) {
        return {
          isPrescriber: false,
          isDisciplineEligible: false,
          canPrescribeClozapine: false,
        } satisfies PrescriberEligibilitySnapshot;
      }
      const r = await tryAsync(() => apiClient.get<StaffMeResponse>('staff/me'));
      if (isErr(r)) throw r.error;
      return evaluatePrescriberEligibility(r.value);
    },
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
  });

  return {
    isPrescriber: data?.isPrescriber ?? false,
    isDisciplineEligible: data?.isDisciplineEligible ?? false,
    canPrescribeClozapine: data?.canPrescribeClozapine ?? false,
    isError,
  };
}

// ── Shared Print Prescription Hook ──
export function usePrintPrescription(patientId: string) {
  const user = useAuthStore(s => s.user);
  const {
    isPrescriber,
    isDisciplineEligible,
    canPrescribeClozapine,
    isError: prescriberStatusError,
  } = usePrescriberStatus();

  const { data: printData } = useQuery({
    queryKey: prescriptionKeys.printDataByUser(user?.id, patientId),
    queryFn: async (): Promise<PrescriptionPrintData> => {
      const [staffData, clinicData, patientData] = await Promise.all([
        apiClient.get<PrescriberPrintStaff>(`staff/${user?.id}`).catch((err) => { console.warn('MedicationsTab: query failed', err); return null; }),
        apiClient.get<PrescriberPrintClinic>('clinics/current').catch((err) => { console.warn('MedicationsTab: query failed', err); return null; }),
        apiClient.get<PrescriberPrintPatient>(`patients/${patientId}`).catch((err) => { console.warn('MedicationsTab: query failed', err); return null; }),
      ]);
      return {
        prescriber: staffData,
        clinic: clinicData,
        patient: patientData,
      };
    },
    enabled: isPrescriber,
    staleTime: 5 * 60_000,
  });

  const printPrescription = useCallback((med: MedicationRow) => {
    const p = printData?.patient;
    const c = printData?.clinic;
    const pr = printData?.prescriber;
    const prescriberName = pr ? `${pr.givenName ?? pr.given_name ?? ''} ${pr.familyName ?? pr.family_name ?? ''}`.trim() : user ? `${user.givenName} ${user.familyName}` : '';
    const prescriberNum = pr?.prescriberNumber ?? pr?.prescriber_number ?? '';
    const providerNum = pr?.providerNumber ?? pr?.provider_number ?? '';
    const ahpraNum = pr?.ahpraNumber ?? pr?.ahpra_number ?? '';
    const hpii = pr?.hpii ?? pr?.hpii_number ?? '';
    const qualifications = pr?.qualifications ?? '';
    const clinicName = c?.name ?? 'Signacare Mental Health';
    const clinicAddress = c?.address ?? '';
    const clinicPhone = c?.phone ?? '';
    const clinicFax = c?.fax ?? '';
    const hpio = c?.hpio ?? '';
    const patientName = p ? `${p.givenName ?? p.given_name ?? ''} ${p.familyName ?? p.family_name ?? ''}`.trim() : '';
    const patientDob = p?.dateOfBirth ?? p?.date_of_birth ?? '';
    const patientAddress = [p?.addressLine1 ?? p?.address_line1, p?.suburb, p?.state, p?.postcode].filter(Boolean).join(', ');
    const patientMedicare = p?.medicareNumber ?? p?.medicare_number ?? '';
    const patientMedicareIrn = p?.medicareSubNumerate ?? p?.medicare_irn ?? '';
    const patientIhi = p?.ihi ?? '';
    const patientDva = p?.dvaNumber ?? p?.dva_number ?? '';
    const patientDvaColour = p?.dvaCardColour ?? p?.dva_card_colour ?? '';
    const patientPhone = p?.phone ?? p?.mobile ?? '';
    const today = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
    const brandSubNotAllowed = med.genericName && med.genericName !== med.medicationName ? false : true;
    const isS8 = med.isS8;

    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><title>Prescription — ${escapeHtml(patientName)}</title>
<style>
  @page { size: A5 landscape; margin: 10mm; }
  body { font-family: 'Courier New', monospace; font-size: 10pt; margin: 0; padding: 12mm; box-sizing: border-box; }
  .header { border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 10px; }
  .org-name { font-size: 14pt; font-weight: bold; text-transform: uppercase; }
  .org-details { font-size: 8pt; color: #333; }
  .prescriber-box { font-size: 9pt; margin-top: 4px; }
  .patient-box { border: 1px solid #000; padding: 8px; margin: 8px 0; font-size: 9pt; display: grid; grid-template-columns: 1fr 1fr; gap: 2px 16px; }
  .patient-box .full { grid-column: 1 / -1; }
  .rx-symbol { font-size: 22pt; font-weight: bold; margin: 6px 0 4px; }
  .medication { font-size: 13pt; font-weight: bold; margin: 4px 0; }
  .generic { font-size: 10pt; color: #333; font-style: italic; margin-bottom: 4px; }
  .details { font-size: 10pt; margin: 2px 0; }
  .details-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 16px; font-size: 10pt; }
  .s8-box { border: 2px solid #D32F2F; padding: 4px 8px; margin: 6px 0; font-size: 9pt; color: #D32F2F; font-weight: bold; }
  .lai-box { border: 2px solid #1565C0; padding: 4px 8px; margin: 6px 0; font-size: 9pt; color: #1565C0; font-weight: bold; }
  .cloz-box { border: 2px solid #C62828; padding: 4px 8px; margin: 6px 0; font-size: 9pt; color: #C62828; font-weight: bold; }
  .footer { margin-top: 12px; border-top: 1px solid #999; padding-top: 6px; font-size: 8pt; }
  .signature-line { margin-top: 20px; border-top: 1px solid #000; width: 200px; }
  .pbs-note { font-size: 7pt; color: #666; margin-top: 8px; border: 1px dashed #999; padding: 4px; }
  .brand-sub { font-size: 9pt; margin: 4px 0; }
  @media print { body { padding: 8mm; } }
</style></head><body>
<div class="header">
  <div class="org-name">${escapeHtml(clinicName)}</div>
  <div class="org-details">
    ${escapeHtml(clinicAddress)}${clinicPhone ? ' | Ph: ' + escapeHtml(clinicPhone) : ''}${clinicFax ? ' | Fax: ' + escapeHtml(clinicFax) : ''}
    ${hpio ? '<br>HPIO: ' + escapeHtml(hpio) : ''}
  </div>
  <div class="prescriber-box">
    <strong>Prescriber:</strong> ${escapeHtml(prescriberName)}${qualifications ? ' (' + escapeHtml(qualifications) + ')' : ''}<br>
    ${prescriberNum ? '<strong>Prescriber No:</strong> ' + escapeHtml(prescriberNum) : ''}
    ${providerNum ? ' &nbsp; <strong>Provider No:</strong> ' + escapeHtml(providerNum) : ''}<br>
    ${ahpraNum ? '<strong>AHPRA:</strong> ' + escapeHtml(ahpraNum) : ''}
    ${hpii ? ' &nbsp; <strong>HPII:</strong> ' + escapeHtml(hpii) : ''}
  </div>
</div>

<div style="text-align:right;font-size:9pt;margin-bottom:6px"><strong>Date:</strong> ${today}</div>

<div class="patient-box">
  <div class="full"><strong>Patient:</strong> ${escapeHtml(patientName)}</div>
  <div><strong>DOB:</strong> ${escapeHtml(patientDob)}</div>
  <div><strong>Sex:</strong> ${escapeHtml(p?.gender ?? p?.sex ?? '')}</div>
  ${patientMedicare ? `<div><strong>Medicare:</strong> ${escapeHtml(patientMedicare)}${patientMedicareIrn ? '/' + escapeHtml(patientMedicareIrn) : ''}</div>` : '<div></div>'}
  ${patientIhi ? `<div><strong>IHI:</strong> ${escapeHtml(patientIhi)}</div>` : '<div></div>'}
  ${patientDva ? `<div><strong>DVA:</strong> ${escapeHtml(patientDva)} (${escapeHtml(patientDvaColour)})</div>` : ''}
  ${patientPhone ? `<div><strong>Phone:</strong> ${escapeHtml(patientPhone)}</div>` : ''}
  ${patientAddress ? `<div class="full"><strong>Address:</strong> ${escapeHtml(patientAddress)}</div>` : ''}
</div>

${isS8 ? '<div class="s8-box">SCHEDULE 8 — CONTROLLED SUBSTANCE</div>' : ''}
${med.isLai ? '<div class="lai-box">LONG-ACTING INJECTABLE (LAI) — Administer by trained staff only</div>' : ''}
${med.isClozapine ? '<div class="cloz-box">CLOZAPINE — Blood monitoring (WCC/ANC) required before dispensing</div>' : ''}

<div class="rx-symbol">&#8478;</div>

<div class="medication">${escapeHtml(med.medicationName ?? 'Medication')}</div>
${med.genericName && med.genericName !== med.medicationName ? `<div class="generic">Generic: ${escapeHtml(med.genericName)}</div>` : ''}

<div class="details-grid">
  <div><strong>Dose:</strong> ${escapeHtml(med.dose ?? '')}</div>
  <div><strong>Route:</strong> ${escapeHtml(med.route ?? 'Oral')}</div>
  <div><strong>Frequency:</strong> ${escapeHtml(med.frequency ?? '')}</div>
  <div><strong>Quantity:</strong> ${med.quantity ?? '___'}</div>
  <div><strong>Repeats:</strong> ${med.repeats ?? '0'}</div>
  ${med.pbsCode ? `<div><strong>PBS Item:</strong> ${escapeHtml(med.pbsCode)}</div>` : '<div></div>'}
</div>

<div class="brand-sub">${brandSubNotAllowed ? '<strong>Brand substitution NOT permitted</strong>' : 'Brand substitution permitted'}</div>

<div style="margin-top:20px">
  <div class="signature-line"></div>
  <div style="font-size:8pt;margin-top:3px">${escapeHtml(prescriberName)}</div>
  <div style="font-size:7pt;color:#666">${prescriberNum ? 'Prescriber No: ' + escapeHtml(prescriberNum) : ''}${providerNum ? ' | Provider No: ' + escapeHtml(providerNum) : ''}</div>
</div>

<div class="pbs-note">
  PBS/RPBS: Valid 12 months from date of prescribing. Authority prescriptions require approval number before dispensing.
  ${isS8 ? ' Schedule 8: Subject to state/territory controlled substance regulations.' : ''}
  ${med.isClozapine ? ' Clozapine: Must not be dispensed without evidence of current satisfactory blood test results.' : ''}
</div>

<div class="footer">
  ${escapeHtml(clinicName)} | ${escapeHtml(clinicAddress)} | ${clinicPhone ? escapeHtml(clinicPhone) : ''}<br>
  Printed: ${new Date().toLocaleString('en-AU')}
</div>
</body></html>`);
    w.document.close();
    w.focus();
    w.print();
  }, [printData, user]);

  return {
    printPrescription,
    isPrescriber,
    isDisciplineEligible,
    canPrescribeClozapine,
    prescriberStatusError,
  };
}
