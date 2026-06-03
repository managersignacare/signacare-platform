// apps/api/src/services/clinicService.ts
import { v4 as uuidv4 } from "uuid";
import {
  ClinicCreateDTO,
  ClinicUpdateDTO,
  ClinicResponse,
} from "@signacare/shared";
import { ClinicRepository, ClinicRow } from "./clinicRepository";
import { HttpError } from "../../shared/errors";
import { logger } from '../../utils/logger';
import { sendAdminAlert } from '../patient-outreach/adminAlert';

function mapClinicRowToResponse(row: ClinicRow): ClinicResponse {
  return {
    id: row.id,
    name: row.name,
    abn: row.abn ?? undefined,
    phone: row.phone ?? undefined,
    email: row.email ?? undefined,
    addressStreet: row.address_line1 ?? undefined,
    addressSuburb: row.suburb ?? undefined,
    addressState: row.state ?? undefined,
    addressPostcode: row.postcode ?? undefined,
    timeZone: row.timezone,
    isActive: row.is_active,
    // BUG-339 — eRx identity passthrough. null DB → null response (not
    // undefined) so frontend can distinguish "never set" from "absent".
    hpio: row.hpio,
    npdsConformanceId: row.npds_conformance_id,
    erxEtp1SiteId: row.erx_etp1_site_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class ClinicService {
  constructor(private readonly repo: ClinicRepository) {}

  async listClinics(): Promise<ClinicResponse[]> {
    const rows = await this.repo.findAll();
    return rows.map(mapClinicRowToResponse);
  }

  async getClinic(id: string): Promise<ClinicResponse> {
    const row = await this.repo.findById(id);
    if (!row) {
      throw new HttpError(404, "NOT_FOUND", "Clinic not found");
    }
    return mapClinicRowToResponse(row);
  }

  async createClinic(dto: ClinicCreateDTO): Promise<ClinicResponse> {
    // Phase 0.7.5 c24 C10 (SD17) — `clinic_type`, `fax`, `logo_url`
    // columns don't exist on `clinics`. Dropped from the INSERT
    // payload. If the product needs them, add a migration + update
    // the ClinicRow interface.
    const row = await this.repo.insert({
      id: uuidv4(),
      name: dto.name,
      legal_name: null,
      abn: dto.abn ?? null,
      phone: dto.phone ?? null,
      email: dto.email ?? null,
      address_line1: dto.addressStreet ?? null,
      address_line2: null,
      suburb: dto.addressSuburb ?? null,
      state: dto.addressState ?? null,
      postcode: dto.addressPostcode ?? null,
      country: null,
      timezone: dto.timeZone,
      time_zone: dto.timeZone,
      is_active: dto.isActive,
      deleted_at: null,
      hpio: dto.hpio,
      npds_conformance_id: dto.npdsConformanceId ?? null,
      erx_etp1_site_id: dto.erxEtp1SiteId ?? null,
    });
    const adminSlots = row as ClinicRow & {
      nominated_admin_staff_id?: string | null;
      delegated_admin_staff_id?: string | null;
    };
    const nominatedAdminStaffId = adminSlots.nominated_admin_staff_id ?? null;
    const delegatedAdminStaffId = adminSlots.delegated_admin_staff_id ?? null;
    if (!nominatedAdminStaffId && !delegatedAdminStaffId) {
      try {
        await sendAdminAlert({
          clinicId: row.id,
          kind: 'clinic_admin_slots_unconfigured',
          payload: {
            source: 'clinicService.createClinic',
            reason: 'bootstrap_admin_slots_missing',
            clinic_name: row.name,
            nominated_admin_staff_id: null,
            delegated_admin_staff_id: null,
          },
        });
      } catch (err) {
        logger.warn(
          {
            err,
            clinicId: row.id,
            kind: 'clinic_admin_slots_unconfigured',
          },
          'clinicService.createClinic admin slot bootstrap alert failed (non-blocking)',
        );
      }
    }
    return mapClinicRowToResponse(row);
  }

  async updateClinic(id: string, dto: ClinicUpdateDTO): Promise<ClinicResponse> {
    const existing = await this.repo.findById(id);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "Clinic not found");
    }

    const patch: Partial<ClinicRow> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.abn !== undefined) patch.abn = dto.abn ?? null;
    if (dto.phone !== undefined) patch.phone = dto.phone ?? null;
    if (dto.email !== undefined) patch.email = dto.email ?? null;
    if (dto.addressStreet !== undefined) patch.address_line1 = dto.addressStreet ?? null;
    if (dto.addressSuburb !== undefined) patch.suburb = dto.addressSuburb ?? null;
    if (dto.addressState !== undefined) patch.state = dto.addressState ?? null;
    if (dto.addressPostcode !== undefined) patch.postcode = dto.addressPostcode ?? null;
    if (dto.timeZone !== undefined) patch.timezone = dto.timeZone;
    if (dto.isActive !== undefined) patch.is_active = dto.isActive;
    // BUG-334 A2-2 tightening: hpio can be updated when explicitly provided,
    // but null-clears are no longer allowed on app write surfaces.
    if (typeof dto.hpio === 'string') patch.hpio = dto.hpio;
    if (dto.npdsConformanceId !== undefined) patch.npds_conformance_id = dto.npdsConformanceId;
    if (dto.erxEtp1SiteId !== undefined) patch.erx_etp1_site_id = dto.erxEtp1SiteId;

    const updated = await this.repo.update(id, patch);
    if (!updated) {
      throw new HttpError(500, "INTERNAL_ERROR", "Failed to update clinic");
    }

    return mapClinicRowToResponse(updated);
  }
}
