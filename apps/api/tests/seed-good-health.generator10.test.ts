import { describe, it, expect } from 'vitest';
import { buildPathology } from '../src/seed-good-health/generators/10_pathology';
import { buildPatients } from '../src/seed-good-health/generators/06_patients';
import { buildEpisodes } from '../src/seed-good-health/generators/07_episodes';
import {
  MENTAL_HEALTH_CLINICS,
  TEAM_SLUGS,
} from '../src/seed-good-health/config/catalog';
import { clinicId, staffId } from '../src/seed-good-health/config/ids';

describe('seed-good-health generator 10: pathology', () => {
  it('emits exactly 80 orders + 320 results', () => {
    const { orderRows, resultRows } = buildPathology();
    expect(orderRows).toHaveLength(80);
    expect(resultRows).toHaveLength(320);
  });

  it('every order has exactly 4 result rows (Na + K + FBG + HbA1c)', () => {
    const { orderRows, resultRows } = buildPathology();
    const counts = new Map<string, number>();
    for (const row of resultRows) {
      counts.set(
        row.pathology_order_id,
        (counts.get(row.pathology_order_id) ?? 0) + 1,
      );
    }
    expect(counts.size).toBe(orderRows.length);
    for (const count of counts.values()) {
      expect(count).toBe(4);
    }
  });

  it('every order references a patient from gen 06 and an open episode from gen 07', () => {
    const patients = new Set(buildPatients().rows.map((p) => p.id));
    const openEpisodes = new Set(
      buildEpisodes()
        .rows.filter((e) => e.status === 'open')
        .map((e) => e.id),
    );
    for (const row of buildPathology().orderRows) {
      expect(patients.has(row.patient_id)).toBe(true);
      expect(openEpisodes.has(row.episode_id)).toBe(true);
    }
  });

  it('every result references its parent order and the same patient', () => {
    const { orderRows, resultRows } = buildPathology();
    const ordersById = new Map(orderRows.map((o) => [o.id, o]));
    for (const row of resultRows) {
      const order = ordersById.get(row.pathology_order_id);
      expect(order).toBeDefined();
      expect(row.patient_id).toBe(order!.patient_id);
      expect(row.clinic_id).toBe(order!.clinic_id);
    }
  });

  it('ordered_by_id always points at a team-lead staff row', () => {
    const leads = new Set(
      MENTAL_HEALTH_CLINICS.flatMap((c) =>
        TEAM_SLUGS.map((t) => staffId(c.slug, `${t}.team-lead`)),
      ),
    );
    for (const row of buildPathology().orderRows) {
      expect(leads.has(row.ordered_by_id)).toBe(true);
    }
  });

  it('order_number is unique across 80 orders and follows the ORD pattern', () => {
    const numbers = new Set(buildPathology().orderRows.map((r) => r.order_number));
    expect(numbers.size).toBe(80);
    for (const row of buildPathology().orderRows) {
      expect(row.order_number).toMatch(/^ORD-[A-Z]{3}-[AB]-\d{3}$/);
    }
  });

  it('every order is status=completed, urgency=routine, fasting=true', () => {
    for (const row of buildPathology().orderRows) {
      expect(row.status).toBe('completed');
      expect(row.urgency).toBe('routine');
      expect(row.fasting).toBe(true);
    }
  });

  it('all results are abnormal_flag=normal, result_status=final, is_critical=false', () => {
    for (const row of buildPathology().resultRows) {
      expect(row.abnormal_flag).toBe('normal');
      expect(row.result_status).toBe('final');
      expect(row.is_critical).toBe(false);
    }
  });

  it('every result test_code is one of the 4 expected codes', () => {
    const codes = new Set(['NA', 'K', 'GLUC', 'HBA1C']);
    for (const row of buildPathology().resultRows) {
      expect(codes.has(row.test_code)).toBe(true);
    }
  });

  it('clinic_id on orders matches the MH clinic set', () => {
    const mhIds = new Set(MENTAL_HEALTH_CLINICS.map((c) => clinicId(c.slug)));
    for (const row of buildPathology().orderRows) {
      expect(mhIds.has(row.clinic_id)).toBe(true);
    }
  });

  it('result collection_date precedes or equals result_date', () => {
    for (const row of buildPathology().resultRows) {
      expect(row.collection_date <= row.result_date).toBe(true);
    }
  });

  it('rows are byte-stable across two builds', () => {
    const a = buildPathology();
    const b = buildPathology();
    expect(a.orderRows.map((r) => r.id)).toStrictEqual(
      b.orderRows.map((r) => r.id),
    );
    expect(a.resultRows.map((r) => r.id)).toStrictEqual(
      b.resultRows.map((r) => r.id),
    );
  });
});
