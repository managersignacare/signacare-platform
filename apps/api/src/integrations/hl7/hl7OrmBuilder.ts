import { dispatchHl7, type DispatchResult } from './hl7Transport';
import { AppError } from '../../shared/errors';

export interface Hl7PharmacyOrderInput {
  orderNumber: string;
  patientId: string;
  patientGivenName: string;
  patientFamilyName: string;
  prescriberStaffId: string;
  medicationCode: string;
  medicationDisplay: string;
  doseAmount: string;
  doseUnit?: string;
  route?: string;
  frequency?: string;
  quantity: string;
  quantityUnit?: string;
  startAt?: Date;
  sendingFacility?: string;
  receivingApplication?: string;
  receivingFacility?: string;
  messageControlId?: string;
}

export interface ParsedRdeO11DispenseConfirmation {
  messageControlId: string;
  orderNumber: string;
  orderStatus: string;
  ackCode: string | null;
  dispenseDateTime: string | null;
  actualDispenseAmount: string | null;
  actualDispenseUnit: string | null;
}

function toHl7DateTime(date: Date): string {
  return date.toISOString().replace(/[-:T.Z]/g, '').substring(0, 14);
}

function escapeHl7(value: string | undefined): string {
  if (!value) return '';
  return value
    .replace(/\\/g, '\\E\\')
    .replace(/\|/g, '\\F\\')
    .replace(/\^/g, '\\S\\')
    .replace(/~/g, '\\R\\')
    .replace(/&/g, '\\T\\')
    .replace(/[\r\n]/g, ' ');
}

function getField(segment: string, index: number): string {
  const fields = segment.split('|');
  return fields[index] ?? '';
}

/**
 * BUG-300 — canonical HL7 v2 ORM^O01 pharmacy outbound builder.
 * Segment shape: MSH, PID, ORC, RXO, RXE.
 */
export function buildPharmacyOrmO01(
  input: Hl7PharmacyOrderInput,
  now = new Date(),
): string {
  const timestamp = toHl7DateTime(now);
  const messageControlId = escapeHl7(
    input.messageControlId ?? `ORM-${input.orderNumber}-${timestamp}`,
  );
  const sendingFacility = escapeHl7(input.sendingFacility ?? 'SIGNACARE');
  const receivingApplication = escapeHl7(input.receivingApplication ?? 'PHARMACY');
  const receivingFacility = escapeHl7(input.receivingFacility ?? '');
  const patientId = escapeHl7(input.patientId);
  const patientFamily = escapeHl7(input.patientFamilyName);
  const patientGiven = escapeHl7(input.patientGivenName);
  const orderNumber = escapeHl7(input.orderNumber);
  const prescriberStaffId = escapeHl7(input.prescriberStaffId);
  const medicationCode = escapeHl7(input.medicationCode);
  const medicationDisplay = escapeHl7(input.medicationDisplay);
  const doseAmount = escapeHl7(input.doseAmount);
  const doseUnit = escapeHl7(input.doseUnit);
  const route = escapeHl7(input.route);
  const frequency = escapeHl7(input.frequency);
  const quantity = escapeHl7(input.quantity);
  const quantityUnit = escapeHl7(input.quantityUnit);
  const startAt = toHl7DateTime(input.startAt ?? now);

  const msh = `MSH|^~\\&|SIGNACARE_EMR|${sendingFacility}|${receivingApplication}|${receivingFacility}|${timestamp}||ORM^O01|${messageControlId}|P|2.5`;
  const pid = `PID|1||${patientId}^^^SIGNACARE||${patientFamily}^${patientGiven}`;
  const orc = `ORC|NW|${orderNumber}|||||||${timestamp}|${prescriberStaffId}`;
  const rxo = `RXO|${medicationCode}^${medicationDisplay}||${doseAmount}|${doseUnit}|${route}|${frequency}|${quantity}|${quantityUnit}`;
  const rxe = `RXE|${startAt}|${doseAmount}|${doseUnit}|${frequency}|${route}|${quantity}|${quantityUnit}|||${medicationCode}^${medicationDisplay}`;

  return [msh, pid, orc, rxo, rxe].join('\r');
}

export async function dispatchPharmacyOrmO01(
  input: Hl7PharmacyOrderInput,
): Promise<{ message: string; dispatch: DispatchResult }> {
  const message = buildPharmacyOrmO01(input);
  const dispatch = await dispatchHl7(message);
  return { message, dispatch };
}

/**
 * BUG-300 — parser for HL7 v2 RDE^O11 dispense confirmations.
 * Pulls core dispense/ack fields used by downstream reconciliation.
 */
export function parseRdeO11DispenseConfirmation(
  message: string,
): ParsedRdeO11DispenseConfirmation {
  const segments = message.split('\r').filter(Boolean);
  const msh = segments.find((s) => s.startsWith('MSH|'));
  const orc = segments.find((s) => s.startsWith('ORC|'));
  const rxd = segments.find((s) => s.startsWith('RXD|'));
  const msa = segments.find((s) => s.startsWith('MSA|'));

  if (!msh) {
    throw new AppError('RDE_O11_PARSE_FAILED: missing MSH segment', 422, 'HL7_RDE_PARSE_FAILED');
  }
  if (!orc) {
    throw new AppError('RDE_O11_PARSE_FAILED: missing ORC segment', 422, 'HL7_RDE_PARSE_FAILED');
  }

  const messageType = getField(msh, 8);
  if (!messageType.startsWith('RDE^O11')) {
    throw new AppError(
      `RDE_O11_PARSE_FAILED: unsupported message type ${messageType || '<empty>'}`,
      422,
      'HL7_RDE_INVALID_MESSAGE_TYPE',
    );
  }

  const orderNumber = getField(orc, 2);
  if (!orderNumber) {
    throw new AppError('RDE_O11_PARSE_FAILED: missing ORC-2 order number', 422, 'HL7_RDE_PARSE_FAILED');
  }

  const parsed: ParsedRdeO11DispenseConfirmation = {
    messageControlId: getField(msh, 9),
    orderNumber,
    // Some partner feeds omit ORC-4, which shifts status into field 4.
    orderStatus: getField(orc, 5) || getField(orc, 4),
    ackCode: msa ? getField(msa, 1) || null : null,
    dispenseDateTime: rxd ? getField(rxd, 3) || null : null,
    actualDispenseAmount: rxd ? getField(rxd, 4) || null : null,
    actualDispenseUnit: rxd ? getField(rxd, 5) || null : null,
  };

  return parsed;
}
