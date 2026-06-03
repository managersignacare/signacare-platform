// tests/hl7-parser.test.ts — HL7v2 message parser tests
import { describe, it, expect } from 'vitest';
import { parseHL7Message, buildACK } from '../src/integrations/hl7/hl7v2Parser';

const SAMPLE_ADT_A01 = `MSH|^~\\&|HIS|Hospital|Signacare|EMR|20260330120000||ADT^A01|MSG001|P|2.4
PID|||PAT123||Brown^William||19850315|M|||123 Main St^Melbourne^VIC^3000||0400111222
PV1||I|ACUTE^Room1^Bed3|||||||||||||||||||||||||||||||||||||||20260330100000`;

const SAMPLE_ADT_A03 = `MSH|^~\\&|HIS|Hospital|Signacare|EMR|20260330140000||ADT^A03|MSG002|P|2.4
PID|||PAT123||Brown^William||19850315|M
PV1||I|ACUTE^Room1^Bed3|||||||||||||||||||||||||||||||||||||||||||||20260330140000`;

const SAMPLE_ORM = `MSH|^~\\&|EMR|Signacare|Lab|PathCo|20260330090000||ORM^O01|MSG003|P|2.4
PID|||PAT456||Smith^Jane||19900101|F
ORC|NW|ORD001||||||20260330090000||
OBR|1|ORD001||FBC^Full Blood Count|||20260330090000`;

describe('HL7v2 Parser', () => {
  describe('ADT A01 (Admit)', () => {
    it('parses message type', () => {
      const msg = parseHL7Message(SAMPLE_ADT_A01);
      expect(msg.type).toBe('ADT^A01');
    });

    it('extracts message ID', () => {
      const msg = parseHL7Message(SAMPLE_ADT_A01);
      expect(msg.messageId).toBe('MSG001');
    });

    it('extracts patient demographics', () => {
      const msg = parseHL7Message(SAMPLE_ADT_A01);
      expect(msg.patient).toBeDefined();
      expect(msg.patient!.familyName).toBe('Brown');
      expect(msg.patient!.givenName).toBe('William');
      expect(msg.patient!.dateOfBirth).toBe('1985-03-15');
      expect(msg.patient!.gender).toBe('male');
      expect(msg.patient!.id).toBe('PAT123');
    });

    it('extracts visit information', () => {
      const msg = parseHL7Message(SAMPLE_ADT_A01);
      expect(msg.visit).toBeDefined();
      expect(msg.visit!.patientClass).toBe('I');
      expect(msg.visit!.ward).toBe('ACUTE');
      expect(msg.visit!.room).toBe('Room1');
      expect(msg.visit!.bed).toBe('Bed3');
    });

    it('parses phone number', () => {
      const msg = parseHL7Message(SAMPLE_ADT_A01);
      expect(msg.patient!.phone).toBe('0400111222');
    });
  });

  describe('ADT A03 (Discharge)', () => {
    it('parses discharge event', () => {
      const msg = parseHL7Message(SAMPLE_ADT_A03);
      expect(msg.type).toBe('ADT^A03');
    });
  });

  describe('ORM^O01 (Order)', () => {
    it('parses order message', () => {
      const msg = parseHL7Message(SAMPLE_ORM);
      expect(msg.type).toBe('ORM^O01');
      expect(msg.order).toBeDefined();
      expect(msg.order!.orderId).toBe('ORD001');
      expect(msg.order!.orderType).toBe('NW');
    });

    it('extracts patient from order', () => {
      const msg = parseHL7Message(SAMPLE_ORM);
      expect(msg.patient!.familyName).toBe('Smith');
      expect(msg.patient!.givenName).toBe('Jane');
      expect(msg.patient!.gender).toBe('female');
    });
  });

  describe('ACK Builder', () => {
    it('builds ACK for accepted message', () => {
      const msg = parseHL7Message(SAMPLE_ADT_A01);
      const ack = buildACK(msg, 'AA');
      expect(ack).toContain('MSH|');
      expect(ack).toContain('MSA|AA|MSG001');
    });

    it('builds NACK with error message', () => {
      const msg = parseHL7Message(SAMPLE_ADT_A01);
      const ack = buildACK(msg, 'AE', 'Patient not found');
      expect(ack).toContain('MSA|AE|MSG001|Patient not found');
    });
  });

  describe('Edge Cases', () => {
    it('throws on invalid message (no MSH)', () => {
      expect(() => parseHL7Message('PID|||123')).toThrow('Invalid HL7 message');
    });

    it('handles empty fields gracefully', () => {
      const msg = parseHL7Message('MSH|^~\\&||||||20260330||ADT^A01|X|P|2.4\nPID|||');
      expect(msg.patient).toBeDefined();
      expect(msg.patient!.familyName).toBe('');
    });
  });
});
