// apps/api/src/repositories/clinicRepository.ts
import { db } from "../../db/db";

/**
 * Mirrors `clinics` exactly. Phase 0.7.5 c24 C10 (SD17) dropped
 * three ghost columns (clinic_type, fax, logo_url) — none exist.
 * Added previously-invisible country, legal_name, time_zone
 * (`time_zone` is the canonical timezone column; there's an older
 * `timezone` alias on the table that remains for backwards compat).
 *
 * @schema-drift-exempt partial-shape
 * BUG-535 — `nominated_admin_staff_id` and `delegated_admin_staff_id`
 * exist on the DB (clinic admin delegation feature) but are NOT yet
 * declared here. Surfacing them is the BUG-535 work item; reverse-
 * direction guard is silenced until that BUG ships.
 */
export interface ClinicRow {
  id: string;
  name: string;
  legal_name: string | null;
  abn: string | null;
  address_line1: string | null;
  address_line2: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  timezone: string;
  time_zone: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  // BUG-295 / BUG-302 — eRx identity columns (see CLAUDE.md §15 schema-drift
  // regression shield). Nullable until ops backfill; BUG-334 tightens
  // hpio to NOT NULL. BUG-339 admin-UI is the canonical entry point.
  hpio: string | null;
  npds_conformance_id: string | null;
  erx_etp1_site_id: string | null;
}

export class ClinicRepository {
  async findById(id: string): Promise<ClinicRow | undefined> {
    const row = await db<ClinicRow>("clinics")
      .where({ id, deleted_at: null })
      .first();
    return row ?? undefined;
  }

  async findAll(): Promise<ClinicRow[]> {
    return db<ClinicRow>("clinics")
      .where({ deleted_at: null })
      .orderBy("name", "asc");
  }

  async insert(
    data: Omit<ClinicRow, "created_at" | "updated_at">
  ): Promise<ClinicRow> {
    const now = new Date();
    const [row] = await db<ClinicRow>("clinics")
      .insert({ ...data, created_at: now, updated_at: now })
      .returning("*");
    return row;
  }

  async update(
    id: string,
    data: Partial<ClinicRow>
  ): Promise<ClinicRow | undefined> {
    const now = new Date();
    const [row] = await db<ClinicRow>("clinics")
      .where({ id, deleted_at: null })
      .update({ ...data, updated_at: now })
      .returning("*");
    return row ?? undefined;
  }
}