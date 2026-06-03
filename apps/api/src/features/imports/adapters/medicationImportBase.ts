/**
 * Shared parse/commit for the LAI and clozapine import adapters.
 *
 * Both lists use the same schema — patient_medications — with two
 * boolean flags (`is_lai`, `is_clozapine`) distinguishing the
 * clinical category. The CSV columns are identical; only the flag
 * the adapter stamps on commitOne differs. Keeping one source of
 * truth here avoids the classic "the LAI adapter validated X, the
 * clozapine adapter forgot to" drift.
 *
 * CSV columns (required):
 *   emr_number, medication_name, dose, frequency
 * CSV columns (optional):
 *   generic_name, route, lai_frequency, prescriber, indication,
 *   episode_emr_number (reserved — currently ignored)
 */
import type { ImportAdapter, RowError } from '../importTypes';
import { medicationService } from '../../medications/medicationService';
import { resolvePatientByEmrNumber } from '../importResolvers';

export interface MedicationImportDto {
  patientId: string;
  medicationName: string;
  dose: string;
  frequency: string;
  genericName?: string;
  route?: string;
  laiFrequency?: string;
  prescriber?: string;
  indication?: string;
}

const REQUIRED = ['emr_number', 'medication_name', 'dose', 'frequency'] as const;
const OPTIONAL = [
  'generic_name', 'route', 'lai_frequency',
  'prescriber', 'indication',
] as const;

function strOrUndef(v: string | undefined): string | undefined {
  const t = (v ?? '').trim();
  return t.length === 0 ? undefined : t;
}

type MedKind = 'lai' | 'clozapine';

export function createMedicationImportAdapter(
  medKind: MedKind,
): ImportAdapter<MedicationImportDto> {
  return {
    kind: medKind,
    requiredColumns: REQUIRED,
    optionalColumns: OPTIONAL,

    async parseRow(row, rowIndex, ctx) {
      const errors: RowError[] = [];
      const emrNumber = strOrUndef(row.emr_number);
      const medicationName = strOrUndef(row.medication_name);
      const dose = strOrUndef(row.dose);
      const frequency = strOrUndef(row.frequency);

      if (!emrNumber) errors.push({ rowIndex, field: 'emr_number', message: 'emr_number is required' });
      if (!medicationName) errors.push({ rowIndex, field: 'medication_name', message: 'medication_name is required' });
      if (!dose) errors.push({ rowIndex, field: 'dose', message: 'dose is required' });
      if (!frequency) errors.push({ rowIndex, field: 'frequency', message: 'frequency is required' });

      if (errors.length > 0) return { ok: false, errors };

      const patientId = await resolvePatientByEmrNumber(ctx, emrNumber!);
      if (!patientId) {
        return {
          ok: false,
          errors: [{
            rowIndex,
            field: 'emr_number',
            message: `No patient found with EMR number '${emrNumber}' in this clinic`,
          }],
        };
      }

      return {
        ok: true,
        dto: {
          patientId,
          medicationName: medicationName!,
          dose: dose!,
          frequency: frequency!,
          genericName: strOrUndef(row.generic_name),
          route: strOrUndef(row.route),
          laiFrequency: strOrUndef(row.lai_frequency),
          prescriber: strOrUndef(row.prescriber),
          indication: strOrUndef(row.indication),
        },
      };
    },

    async commitOne(dto, ctx) {
      await medicationService.create(
        { staffId: ctx.uploadedByStaffId, clinicId: ctx.clinicId, role: 'admin', permissions: ['medication:create'] },
        {
        patientId: dto.patientId,
        medicationName: dto.medicationName,
        dose: dto.dose,
        frequency: dto.frequency,
        genericName: dto.genericName,
        route: dto.route,
        isLai: medKind === 'lai',
        isClozapine: medKind === 'clozapine',
        laiFrequency: dto.laiFrequency,
        prescriber: dto.prescriber,
        indication: dto.indication,
        // Stamped so the cross-specialty medication page can tag the
        // imported rows with the same discriminator the rest of the
        // codebase already uses.
        category: medKind === 'clozapine' ? 'clozapine' : 'lai',
      });
    },
  };
}
