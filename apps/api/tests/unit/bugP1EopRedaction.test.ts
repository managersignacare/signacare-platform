import { describe, expect, it } from 'vitest';
import {
  buildRedactedEopEmailHtml,
  buildRedactedEopSmsBody,
  type TokenDeliveryPayload,
} from '../../src/integrations/escript/tokenDeliveryService';
import { buildTokenEoPXml } from '../../src/integrations/escript/erxRestPayloads';

const BASE_PAYLOAD: TokenDeliveryPayload = {
  patientId: '9f525d6f-2d14-4df2-a948-c32dbf6dc6df',
  erxToken: 'tok-1',
  scid: '2ABCDE12345FG6789',
  dspId: 'DSP-12345',
  patientName: 'Jane Citizen',
  medicationName: 'Clozapine 25mg',
  prescribedBy: 'Dr Jane Prescriber',
  prescribedDate: '2026-05-15',
  clinicName: 'Signacare Clinic',
};

describe('BUG-P1 token EoP redaction', () => {
  it('SMS body contains token identifiers only', () => {
    const body = buildRedactedEopSmsBody(BASE_PAYLOAD);
    expect(body).toContain('eScript Token: tok-1');
    expect(body).toContain('SCID: 2ABCDE12345FG6789');
    expect(body).toContain('DSPID: DSP-12345');

    expect(body).not.toContain('Jane Citizen');
    expect(body).not.toContain('Clozapine 25mg');
    expect(body).not.toContain('Dr Jane Prescriber');
    expect(body).not.toContain('Signacare Clinic');
  });

  it('Email body contains token identifiers only', () => {
    const html = buildRedactedEopEmailHtml(BASE_PAYLOAD);
    expect(html).toContain('tok-1');
    expect(html).toContain('2ABCDE12345FG6789');
    expect(html).toContain('DSP-12345');

    expect(html).not.toContain('Jane Citizen');
    expect(html).not.toContain('Clozapine 25mg');
    expect(html).not.toContain('Dr Jane Prescriber');
    expect(html).not.toContain('Signacare Clinic');
  });

  it('Token EoP XML excludes clinical/demographic fields', () => {
    const xml = buildTokenEoPXml({
      token: 'tok-1',
      scid: '2ABCDE12345FG6789',
      dspId: 'DSP-12345',
    });

    expect(xml).toContain('<SCID>2ABCDE12345FG6789</SCID>');
    expect(xml).toContain('<DSPID>DSP-12345</DSPID>');
    expect(xml).toContain('<Token>tok-1</Token>');

    for (const forbiddenTag of [
      'PatientFamilyName',
      'PatientFirstName',
      'PatientBirthdate',
      'DoctorPrescriberNumber',
      'DoctorFamilyName',
      'PatientInstructions',
      'ReasonForPrescribing',
    ]) {
      expect(xml).not.toContain(`<${forbiddenTag}>`);
    }
  });
});
