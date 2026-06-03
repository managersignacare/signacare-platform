import type { Knex } from 'knex';
import {
  MENTAL_HEALTH_CLINICS,
  TEAM_SLUGS,
} from '../config/catalog';
import {
  clinicId,
  patientId,
  episodeId,
  staffId,
  derive,
} from '../config/ids';
import type { GeneratorResult } from './01_clinics';

// Phase 0.8 generator 13 — legal orders (1 TTO lookup row + 8 patient orders).
//
// Seeds a single row in the global `legal_order_types` catalogue
// (deterministic uuidv5 derived from 'good-health.legal-order-type.tto'
// so reseeds upsert in place) and then attaches one active
// Temporary Treatment Order to the "patient #1" from each team on
// each of the 4 mental-health clinics = 8 MHA orders.
//
// Why only 8: the plan spec calls for "8 TTO orders (2 per clinic,
// 1 Alpha + 1 Beta)" — this is the exact mapping. Demo reviewers
// can open any clinic, see two active MHA orders, and exercise the
// renewal/tribunal flow without every patient carrying paperwork
// they shouldn't.
//
// The lookup row is intentionally shared across tenants (the table
// has no clinic_id column — it's a global catalogue).

interface LegalOrderTypeRow {
  id: string;
  code: string;
  name: string;
  jurisdiction: string;
  max_duration_days: number | null;
  requires_tribunal: boolean;
  is_active: boolean;
}

interface LegalOrderRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  episode_id: string;
  order_type_id: string;
  order_number: string;
  start_date: string;
  expires_at: string;
  review_date: string;
  status: string;
  issuing_authority: string;
  conditions: string;
  notes: string | null;
  auto_flagged: boolean;
  created_by_staff_id: string;
}

export interface LegalOrdersBuild {
  readonly lookupRows: LegalOrderTypeRow[];
  readonly orderRows: LegalOrderRow[];
}

// Shared across all tenants — no clinic scoping on the lookup.
const TTO_TYPE_ID_SEED = 'good-health.legal-order-type.tto';
const TTO_TYPE_ID = derive('catalogue', TTO_TYPE_ID_SEED);

const TTO_TEMPLATE: LegalOrderTypeRow = {
  id: TTO_TYPE_ID,
  code: 'TTO',
  name: 'Temporary Treatment Order',
  jurisdiction: 'VIC',
  max_duration_days: 28,
  requires_tribunal: true,
  is_active: true,
};

const ORDER_START = '2026-03-20';
const ORDER_EXPIRY = '2026-04-17';   // +28 days
const ORDER_REVIEW = '2026-04-10';   // ~7 days before expiry

export function buildLegalOrders(): LegalOrdersBuild {
  const lookupRows: LegalOrderTypeRow[] = [TTO_TEMPLATE];
  const orderRows: LegalOrderRow[] = [];

  for (const clinic of MENTAL_HEALTH_CLINICS) {
    const cid = clinicId(clinic.slug);
    for (const team of TEAM_SLUGS) {
      // Exactly patient #1 per team (the "index case" for the MHA demo)
      const pid = patientId(clinic.slug, team, 1);
      const ep2 = episodeId(pid, 2);
      const leadId = staffId(clinic.slug, `${team}.team-lead`);

      orderRows.push({
        id: derive(pid, 'legal-order.tto-2026'),
        clinic_id: cid,
        patient_id: pid,
        episode_id: ep2,
        order_type_id: TTO_TYPE_ID,
        order_number: `TTO-${clinic.slug.slice(0, 3).toUpperCase()}-${team === 'alpha' ? 'A' : 'B'}-001`,
        start_date: ORDER_START,
        expires_at: ORDER_EXPIRY,
        review_date: ORDER_REVIEW,
        status: 'active',
        issuing_authority: 'Mental Health Tribunal Victoria (demo)',
        conditions:
          'Patient to remain engaged with treating team. Medication compliance as per plan. Authorised absences at clinician discretion.',
        notes: null,
        auto_flagged: false,
        created_by_staff_id: leadId,
      });
    }
  }

  return { lookupRows, orderRows };
}

async function upsertById<T extends { id: string }>(
  knex: Knex,
  table: string,
  rows: readonly T[],
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;
  for (const row of rows) {
    const existing = await knex(table).where({ id: row.id }).first();
    if (existing) {
      await knex(table).where({ id: row.id }).update(row);
      updated++;
    } else {
      await knex(table).insert(row);
      inserted++;
    }
  }
  return { inserted, updated };
}

export async function runLegalOrdersStep(knex: Knex): Promise<GeneratorResult> {
  const { lookupRows, orderRows } = buildLegalOrders();
  // Seed the lookup first — orders FK to it.
  const l = await upsertById(knex, 'legal_order_types', lookupRows);
  const o = await upsertById(knex, 'legal_orders', orderRows);
  return {
    inserted: l.inserted + o.inserted,
    updated: l.updated + o.updated,
  };
}
