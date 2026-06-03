import { describe, it, expect } from 'vitest';
import { buildLegalOrders } from '../src/seed-good-health/generators/13_legal_orders';
import { buildPatients } from '../src/seed-good-health/generators/06_patients';
import { buildEpisodes } from '../src/seed-good-health/generators/07_episodes';
import {
  MENTAL_HEALTH_CLINICS,
  TEAM_SLUGS,
} from '../src/seed-good-health/config/catalog';
import { clinicId, staffId, patientId } from '../src/seed-good-health/config/ids';

describe('seed-good-health generator 13: legal orders', () => {
  it('emits exactly 1 lookup row and 8 order rows', () => {
    const { lookupRows, orderRows } = buildLegalOrders();
    expect(lookupRows).toHaveLength(1);
    expect(orderRows).toHaveLength(8);
  });

  it('lookup row is the VIC TTO template', () => {
    const [tto] = buildLegalOrders().lookupRows;
    expect(tto.code).toBe('TTO');
    expect(tto.jurisdiction).toBe('VIC');
    expect(tto.max_duration_days).toBe(28);
    expect(tto.requires_tribunal).toBe(true);
    expect(tto.is_active).toBe(true);
  });

  it('every order row references the TTO lookup id', () => {
    const { lookupRows, orderRows } = buildLegalOrders();
    const ttoId = lookupRows[0].id;
    for (const row of orderRows) {
      expect(row.order_type_id).toBe(ttoId);
    }
  });

  it('every order targets exactly patient #1 of each team (2 per clinic)', () => {
    const expected = new Set(
      MENTAL_HEALTH_CLINICS.flatMap((c) =>
        TEAM_SLUGS.map((t) => patientId(c.slug, t, 1)),
      ),
    );
    const actual = new Set(buildLegalOrders().orderRows.map((r) => r.patient_id));
    expect(actual.size).toBe(8);
    expect(actual).toStrictEqual(expected);
  });

  it('every order references a patient from gen 06 and open episode from gen 07', () => {
    const patients = new Set(buildPatients().rows.map((p) => p.id));
    const openEpisodes = new Set(
      buildEpisodes().rows.filter((e) => e.status === 'open').map((e) => e.id),
    );
    for (const row of buildLegalOrders().orderRows) {
      expect(patients.has(row.patient_id)).toBe(true);
      expect(openEpisodes.has(row.episode_id)).toBe(true);
    }
  });

  it('each clinic has exactly 2 orders (Alpha + Beta)', () => {
    const { orderRows } = buildLegalOrders();
    const byClinic = new Map<string, number>();
    for (const row of orderRows) {
      byClinic.set(row.clinic_id, (byClinic.get(row.clinic_id) ?? 0) + 1);
    }
    expect(byClinic.size).toBe(4);
    for (const count of byClinic.values()) {
      expect(count).toBe(2);
    }
  });

  it('every order is active, issued by MHT Victoria, and expiry > start', () => {
    for (const row of buildLegalOrders().orderRows) {
      expect(row.status).toBe('active');
      expect(row.issuing_authority).toContain('Mental Health Tribunal');
      expect(row.expires_at > row.start_date).toBe(true);
      expect(row.review_date > row.start_date).toBe(true);
      expect(row.review_date < row.expires_at).toBe(true);
    }
  });

  it('order_number is unique across 8 rows and follows the TTO pattern', () => {
    const numbers = new Set(buildLegalOrders().orderRows.map((r) => r.order_number));
    expect(numbers.size).toBe(8);
    for (const row of buildLegalOrders().orderRows) {
      expect(row.order_number).toMatch(/^TTO-[A-Z]{3}-[AB]-\d{3}$/);
    }
  });

  it('created_by_staff_id always points at a team-lead', () => {
    const leads = new Set(
      MENTAL_HEALTH_CLINICS.flatMap((c) =>
        TEAM_SLUGS.map((t) => staffId(c.slug, `${t}.team-lead`)),
      ),
    );
    for (const row of buildLegalOrders().orderRows) {
      expect(leads.has(row.created_by_staff_id)).toBe(true);
    }
  });

  it('clinic_id matches the MH clinic set', () => {
    const mhIds = new Set(MENTAL_HEALTH_CLINICS.map((c) => clinicId(c.slug)));
    for (const row of buildLegalOrders().orderRows) {
      expect(mhIds.has(row.clinic_id)).toBe(true);
    }
  });

  it('rows are byte-stable across two builds', () => {
    const a = buildLegalOrders();
    const b = buildLegalOrders();
    expect(a.lookupRows.map((r) => r.id)).toStrictEqual(
      b.lookupRows.map((r) => r.id),
    );
    expect(a.orderRows.map((r) => r.id)).toStrictEqual(
      b.orderRows.map((r) => r.id),
    );
  });
});
