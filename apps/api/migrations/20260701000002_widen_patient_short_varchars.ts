import { Knex } from 'knex';

/**
 * Phase R v1.1.1 follow-up — patient varchar columns too tight for real
 * clinical inputs. The web PATCH `/patients/:id` was failing with
 * `value too long for type character varying(30)` whenever a clinician
 * entered a gender-identity string longer than 30 chars (e.g.
 * "Non-binary / genderqueer / prefer not to say" = 46 chars).
 *
 * **Three-layer contract alignment.** This migration is layer 1 of 3.
 * The same commit updates Zod (`packages/shared/src/patient.schemas.ts`
 * `.max(100)`) and frontend form inputs (`inputProps={{ maxLength: 100 }}`).
 * Layers land together so the contract is consistent across DB,
 * backend validation, and UI input gating.
 *
 * Width chosen: 100 chars. Clinical gender-identity strings peak around
 * 46 chars ("Non-binary / genderqueer / prefer not to say"). 100 provides
 * headroom for compound entries and clinical notation. Phone 100 absorbs
 * the "+61 4 1234 5678 (ask for Sarah)" dual-line entry that the pre-R2
 * varchar(30) rejected.
 *
 * Scope determined by pre-flight `information_schema.columns` audit:
 * only `gender` and `phone_mobile` reported real breakage. Other varchar
 * columns on `patients` are wider already (≥50) or hold codes/enums with
 * known bounded length (state, status, medicare_number, etc.).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('patients', (t) => {
    t.string('gender', 100).alter();
    t.string('phone_mobile', 100).alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  // Down-migration is safe because this is a widening; no truncation risk
  // reverting to 30 unless a row exceeds that length (which is exactly the
  // bug we're fixing — so rollback is only sensible immediately after up).
  await knex.schema.alterTable('patients', (t) => {
    t.string('gender', 30).alter();
    t.string('phone_mobile', 30).alter();
  });
}
