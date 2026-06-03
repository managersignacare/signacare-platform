// apps/api/src/integrations/hl7/hl7v2Parser.ts
//
// HL7 v2.x Message Parser
// Parses ADT (Admit/Discharge/Transfer), ORM (Orders), ORU (Results)
//
// HL7v2 message structure:
//   MSH|^~\&|SendingApp|SendingFac|ReceivingApp|ReceivingFac|...
//   PID|||PatientID||FamilyName^GivenName||DOB|Sex|...
//   PV1||I|Ward^Room^Bed|...
//
// This parser handles the most common Australian healthcare HL7v2 messages.

import { logger } from '../../utils/logger';

export interface HL7Segment {
  name: string;
  fields: string[];
}

export interface HL7Message {
  raw: string;
  segments: HL7Segment[];
  type: string;      // e.g. "ADT^A01", "ORM^O01", "ORU^R01"
  messageId: string;
  timestamp: string;
  patient?: {
    id: string;
    familyName: string;
    givenName: string;
    dateOfBirth: string;
    gender: string;
    medicareNumber?: string;
    phone?: string;
    address?: string;
  };
  visit?: {
    patientClass: string; // I=inpatient, O=outpatient, E=emergency
    ward: string;
    room: string;
    bed: string;
    admitDate?: string;
    dischargeDate?: string;
    attendingDoctor?: string;
  };
  order?: {
    orderId: string;
    orderType: string;
    orderDate: string;
    status: string;
  };
}

/**
 * Parse an HL7v2 message string into a structured object.
 */
export function parseHL7Message(raw: string): HL7Message {
  const lines = raw.trim().split(/\r?\n/).filter(Boolean);
  const segments: HL7Segment[] = lines.map(line => {
    const fields = line.split('|');
    return { name: fields[0], fields };
  });

  const msh = segments.find(s => s.name === 'MSH');
  if (!msh) throw new Error('Invalid HL7 message: no MSH segment');

  // MSH field numbering: when split by |, MSH|^~\&|... gives
  // fields[0]="MSH", fields[1]="^~\&", fields[2]=SendingApp, ...
  // MSH-7 (timestamp) = fields[6], MSH-9 (type) = fields[8], MSH-10 (id) = fields[9]
  const messageType = msh.fields[8] ?? '';
  const messageId = msh.fields[9] ?? '';
  const timestamp = msh.fields[6] ?? '';

  const msg: HL7Message = { raw, segments, type: messageType, messageId, timestamp };

  // Parse PID (Patient Identification)
  const pid = segments.find(s => s.name === 'PID');
  if (pid) {
    const patientId = pid.fields[3]?.split('^')[0] ?? '';
    const nameComponents = (pid.fields[5] ?? '').split('^');
    const dob = pid.fields[7] ?? '';
    const sex = pid.fields[8] ?? '';
    const phone = pid.fields[13] ?? '';
    const address = pid.fields[11] ?? '';

    // Australian Medicare number often in PID-19 or an identifier component
    const ssn = pid.fields[19] ?? '';

    msg.patient = {
      id: patientId,
      familyName: nameComponents[0] ?? '',
      givenName: nameComponents[1] ?? '',
      dateOfBirth: formatHL7Date(dob),
      gender: sex === 'M' ? 'male' : sex === 'F' ? 'female' : 'other',
      medicareNumber: ssn || undefined,
      phone: phone.split('^')[0] ?? undefined,
      address: address.replace(/\^/g, ', ') || undefined,
    };
  }

  // Parse PV1 (Patient Visit)
  const pv1 = segments.find(s => s.name === 'PV1');
  if (pv1) {
    const patientClass = pv1.fields[2] ?? '';
    const locationParts = (pv1.fields[3] ?? '').split('^');
    const admitDate = pv1.fields[44] ?? '';
    const dischargeDate = pv1.fields[45] ?? '';
    const attendingParts = (pv1.fields[7] ?? '').split('^');

    msg.visit = {
      patientClass,
      ward: locationParts[0] ?? '',
      room: locationParts[1] ?? '',
      bed: locationParts[2] ?? '',
      admitDate: admitDate ? formatHL7Date(admitDate) : undefined,
      dischargeDate: dischargeDate ? formatHL7Date(dischargeDate) : undefined,
      attendingDoctor: attendingParts.length > 1 ? `${attendingParts[1]} ${attendingParts[0]}` : attendingParts[0] ?? undefined,
    };
  }

  // Parse ORC/OBR (Orders)
  const orc = segments.find(s => s.name === 'ORC');
  if (orc) {
    msg.order = {
      orderId: orc.fields[2]?.split('^')[0] ?? '',
      orderType: orc.fields[1] ?? '',
      orderDate: formatHL7Date(orc.fields[9] ?? ''),
      status: orc.fields[5] ?? '',
    };
  }

  return msg;
}

/**
 * Build an HL7v2 ACK message.
 */
export function buildACK(originalMsg: HL7Message, ackCode: 'AA' | 'AE' | 'AR', errorMsg?: string): string {
  const now = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const msh = `MSH|^~\\&|Signacare|EMR|${originalMsg.segments[0]?.fields[3] ?? ''}|${originalMsg.segments[0]?.fields[4] ?? ''}|${now}||ACK^${originalMsg.type.split('^')[1] ?? 'A01'}|${now}|P|2.4`;
  const msa = `MSA|${ackCode}|${originalMsg.messageId}${errorMsg ? `|${errorMsg}` : ''}`;
  return `${msh}\r${msa}\r`;
}

/**
 * Process an inbound ADT message (admit, discharge, transfer).
 */
export async function processADT(msg: HL7Message, _clinicId: string): Promise<{ action: string; patientId?: string }> {
  const eventType = msg.type.split('^')[1] ?? '';

  switch (eventType) {
    case 'A01': // Admit
      logger.info({ patient: msg.patient?.familyName, ward: msg.visit?.ward }, 'HL7 ADT A01: Patient admitted');
      return { action: 'admit', patientId: msg.patient?.id };

    case 'A02': // Transfer
      logger.info({ patient: msg.patient?.familyName, ward: msg.visit?.ward }, 'HL7 ADT A02: Patient transferred');
      return { action: 'transfer', patientId: msg.patient?.id };

    case 'A03': // Discharge
      logger.info({ patient: msg.patient?.familyName }, 'HL7 ADT A03: Patient discharged');
      return { action: 'discharge', patientId: msg.patient?.id };

    case 'A08': // Update patient info
      logger.info({ patient: msg.patient?.familyName }, 'HL7 ADT A08: Patient info updated');
      return { action: 'update', patientId: msg.patient?.id };

    case 'A28': // Add person information
      logger.info({ patient: msg.patient?.familyName }, 'HL7 ADT A28: New patient registered');
      return { action: 'register', patientId: msg.patient?.id };

    default:
      logger.warn({ eventType }, 'HL7 ADT: Unhandled event type');
      return { action: 'unknown' };
  }
}

/** Convert HL7 date (YYYYMMDD or YYYYMMDDHHmm) to ISO format */
function formatHL7Date(hl7Date: string): string {
  if (!hl7Date || hl7Date.length < 8) return '';
  const y = hl7Date.slice(0, 4);
  const m = hl7Date.slice(4, 6);
  const d = hl7Date.slice(6, 8);
  if (hl7Date.length >= 12) {
    const h = hl7Date.slice(8, 10);
    const mi = hl7Date.slice(10, 12);
    return `${y}-${m}-${d}T${h}:${mi}:00`;
  }
  return `${y}-${m}-${d}`;
}
