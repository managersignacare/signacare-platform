import { Knex } from 'knex';

/**
 * Audit Tier 17 — Letter Phase 3: per-state MHA forms, structured
 * capacity + forensic risk assessments, fact citations, tone
 * presets, guideline grounding.
 *
 * Phase 1 (Tier 15) shipped free-form authored letters from the
 * scribe pipeline. Phase 2 (Tier 16) added delivery / export /
 * translation / revision. Phase 3 adds the structured clinical
 * artefacts that Phase 1's free-form letters cannot safely replace:
 *
 *   1. state_mha_forms (17.1) — per-state Mental Health Act form
 *      definitions. Each Australian state has its own MHA
 *      legislation (NSW, VIC, QLD, SA, WA, TAS, ACT, NT) with
 *      distinct section numbers + forms. Table seeded with a
 *      state-code × form-code matrix so a letter of type
 *      'mha_notification' can be rendered against the correct form
 *      schema at runtime.
 *
 *   2. capacity_assessments (17.2) — structured four-test capacity
 *      assessments (understand / retain / weigh / communicate) per
 *      decision, not per patient. Decision-specific is the
 *      legal test under AU common law + each state MHA.
 *
 *   3. forensic_risk_formulations (17.3) — structured forensic risk
 *      formulation (HCR-20 / SAPROF / START). Clinician fills the
 *      structured fields; the letter renderer composes the prose
 *      from the structured fields so the letter cannot silently
 *      diverge from the assessment.
 *
 *   4. letter_citations (17.4) — every factual claim in a letter
 *      that isn't common knowledge must point back to the source
 *      (transcript offset, prior note id, lab result id, patient
 *      self-report). Medico-legal rigour: "show your working".
 *
 *   5. letter_tone_presets (17.5) — named tone profiles (formal /
 *      collegial / patient-friendly / plain-language / medico-legal)
 *      that switch the system_prompt on the same template. Seed
 *      rows cover the common AU use cases.
 *
 *   6. clinic_settings.default_guidelines (17.6) — which clinical
 *      guidelines the letter renderer should cite as grounding
 *      (RANZCP / RACGP / NICE / ALA / etc.). Nullable; when set,
 *      the letter system_prompt includes an instruction to
 *      preferentially cite these guidelines. No guidelines ingested
 *      here — that belongs in a separate knowledge-base layer.
 */
export async function up(knex: Knex): Promise<void> {
  // 17.1 — state_mha_forms
  await knex.schema.createTable('state_mha_forms', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('state_code', 3).notNullable();
    t.string('form_code', 40).notNullable();
    t.string('name', 300).notNullable();
    t.string('act_reference', 200).notNullable();
    t.string('section_reference', 40).nullable();
    t.jsonb('field_schema').notNullable();
    t.boolean('requires_authorised_psychiatrist').notNullable().defaultTo(false);
    t.integer('max_duration_days').nullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['state_code', 'form_code']);
    t.index(['state_code', 'is_active']);
  });

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE state_mha_forms
      ADD CONSTRAINT state_mha_forms_state_check
      CHECK (state_code IN ('NSW','VIC','QLD','SA','WA','TAS','ACT','NT'))
  `);

  // state_mha_forms is vendor-global (no clinic_id) — it's
  // regulatory reference data. No RLS needed. GRANT read to app_user
  // via the default privilege setup already in place.

  // 17.2 — capacity_assessments
  await knex.schema.createTable('capacity_assessments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
    t.uuid('assessor_id').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    t.uuid('letter_id').nullable().references('id').inTable('letters').onDelete('SET NULL');
    t.string('decision_context', 200).notNullable();
    t.text('understand_notes').notNullable().defaultTo('');
    t.text('retain_notes').notNullable().defaultTo('');
    t.text('weigh_notes').notNullable().defaultTo('');
    t.text('communicate_notes').notNullable().defaultTo('');
    t.string('conclusion', 30).notNullable();
    t.text('conclusion_reasoning').notNullable().defaultTo('');
    t.timestamp('assessed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id']);
    t.index(['patient_id', 'assessed_at']);
    t.index(['letter_id']);
  });

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE capacity_assessments
      ADD CONSTRAINT capacity_assessments_conclusion_check
      CHECK (conclusion IN ('has_capacity','lacks_capacity','indeterminate'))
  `);

  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE capacity_assessments ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_capacity_assessments_tenant ON capacity_assessments
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // 17.3 — forensic_risk_formulations
  await knex.schema.createTable('forensic_risk_formulations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('assessor_id').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    t.uuid('letter_id').nullable().references('id').inTable('letters').onDelete('SET NULL');
    t.string('instrument', 40).notNullable();
    t.jsonb('scores').notNullable();
    t.text('historical_summary').notNullable().defaultTo('');
    t.text('clinical_summary').notNullable().defaultTo('');
    t.text('risk_management_summary').notNullable().defaultTo('');
    t.string('overall_risk', 20).notNullable();
    t.text('overall_reasoning').notNullable().defaultTo('');
    t.timestamp('assessed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id']);
    t.index(['patient_id', 'assessed_at']);
  });

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE forensic_risk_formulations
      ADD CONSTRAINT forensic_risk_instrument_check
      CHECK (instrument IN ('hcr_20','saprof','start','vrag','psychopathy_checklist','free_form'))
  `);

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE forensic_risk_formulations
      ADD CONSTRAINT forensic_risk_overall_check
      CHECK (overall_risk IN ('low','moderate','high','very_high','cannot_determine'))
  `);

  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE forensic_risk_formulations ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_forensic_risk_formulations_tenant ON forensic_risk_formulations
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // 17.4 — letter_citations
  await knex.schema.createTable('letter_citations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.uuid('letter_id').notNullable().references('id').inTable('letters').onDelete('CASCADE');
    t.uuid('section_id').nullable().references('id').inTable('letter_sections').onDelete('CASCADE');
    t.string('source_kind', 40).notNullable();
    t.string('source_ref', 200).notNullable();
    t.integer('source_offset').nullable();
    t.string('snippet', 500).nullable();
    t.text('claim').notNullable();
    t.decimal('confidence', 3, 2).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id']);
    t.index(['letter_id']);
    t.index(['section_id']);
  });

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE letter_citations
      ADD CONSTRAINT letter_citations_source_kind_check
      CHECK (source_kind IN (
        'scribe_transcript','clinical_note','lab_result','imaging',
        'medication_history','patient_self_report','collateral',
        'legal_document','other_letter'
      ))
  `);

  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE letter_citations ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_letter_citations_tenant ON letter_citations
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // 17.5 — letter_tone_presets. Vendor-global seed + per-clinic
  // overrides. tone_key is the identifier clients pass in to switch
  // the system prompt.
  await knex.schema.createTable('letter_tone_presets', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').nullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.string('tone_key', 40).notNullable();
    t.string('name', 200).notNullable();
    t.text('description').notNullable().defaultTo('');
    t.text('system_prompt_addendum').notNullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['tone_key']);
  });

  // @migration-raw-exempt: index_partial
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_letter_tone_presets_system_key
      ON letter_tone_presets (tone_key) WHERE clinic_id IS NULL
  `);
  // @migration-raw-exempt: index_partial
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_letter_tone_presets_clinic_key
      ON letter_tone_presets (clinic_id, tone_key) WHERE clinic_id IS NOT NULL
  `);

  // Vendor-global + per-clinic share the same table. Policy allows
  // clinic_id NULL OR match on tenant.
  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE letter_tone_presets ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_letter_tone_presets_tenant ON letter_tone_presets
      FOR ALL
      USING (
        clinic_id IS NULL
        OR clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid
      )
      WITH CHECK (
        clinic_id IS NULL
        OR clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid
      );
  `);

  // 17.6 — clinic_settings.default_guidelines
  await knex.schema.alterTable('clinic_settings', (t) => {
    t.jsonb('default_guidelines').nullable();
  });

  // Seed 5 tone presets + 8 per-state MHA notification form
  // placeholders. The field_schema for each state's form is a
  // structured JSONB that the UI renders as the form; every
  // jurisdiction has different field names (e.g. VIC "Mental Health
  // Tribunal" vs NSW "Tribunal") so we seed the canonical shape
  // per state and admins/clinical-leads refine the content.
  await knex('letter_tone_presets').insert([
    {
      clinic_id: null, tone_key: 'formal',
      name: 'Formal (default for specialists + legal)',
      description: 'Formal clinical correspondence tone. Default for specialist-to-specialist + legal.',
      system_prompt_addendum: 'Tone: formal. Use precise clinical language. No contractions. Structured sentences.',
      is_active: true,
    },
    {
      clinic_id: null, tone_key: 'collegial',
      name: 'Collegial (GP handover)',
      description: 'Warm but professional; appropriate for familiar GP colleagues.',
      system_prompt_addendum: 'Tone: collegial. Courteous, concise, acknowledges the reader as a clinical peer. Avoid diagnostic jargon the GP won\'t use day-to-day.',
      is_active: true,
    },
    {
      clinic_id: null, tone_key: 'patient_friendly',
      name: 'Patient-friendly (after-visit)',
      description: 'Plain language, second person, avoids medical jargon. For summaries going to the patient.',
      system_prompt_addendum: 'Tone: patient-friendly. Plain Australian English. Grade-8 reading level. Second person ("you"). Avoid medical jargon or define it when used.',
      is_active: true,
    },
    {
      clinic_id: null, tone_key: 'plain_language',
      name: 'Plain language (government + third party)',
      description: 'For Centrelink, schools, and other non-clinical third parties.',
      system_prompt_addendum: 'Tone: plain language. Avoid clinical jargon. Focus on functional impact. Decisions rest on functional limitations, not diagnosis.',
      is_active: true,
    },
    {
      clinic_id: null, tone_key: 'medico_legal',
      name: 'Medico-legal (court + tribunal)',
      description: 'Court + tribunal reports. Maintains expert-witness duty to the court.',
      system_prompt_addendum: 'Tone: medico-legal. Distinguish fact from opinion. Cite the evidence for every conclusion. Maintain expert-witness duty to the court. Never speculate.',
      is_active: true,
    },
  ]);

  await knex('state_mha_forms').insert([
    {
      state_code: 'NSW', form_code: 'schedule_1',
      name: 'Mental Health Act 2007 (NSW) — Schedule 1 detention',
      act_reference: 'Mental Health Act 2007 (NSW)',
      section_reference: 'Sch 1',
      field_schema: JSON.stringify({
        sections: ['patient_identification', 'detaining_authority', 'grounds_for_detention', 'mental_illness_criteria', 'risk_assessment', 'less_restrictive_alternatives', 'transport_arrangements', 'declaration'],
      }),
      requires_authorised_psychiatrist: false,
      max_duration_days: 5,
      is_active: true,
    },
    {
      state_code: 'VIC', form_code: 'assessment_order',
      name: 'Mental Health and Wellbeing Act 2022 (VIC) — Assessment Order',
      act_reference: 'Mental Health and Wellbeing Act 2022 (VIC)',
      section_reference: 's 31',
      field_schema: JSON.stringify({
        sections: ['patient_identification', 'assessment_criteria', 'temporary_treatment_reasoning', 'temporary_treatment_duration', 'transport_instructions', 'chief_psychiatrist_notification'],
      }),
      requires_authorised_psychiatrist: true,
      max_duration_days: 1,
      is_active: true,
    },
    {
      state_code: 'QLD', form_code: 'eau_order',
      name: 'Mental Health Act 2016 (QLD) — Examination Authority',
      act_reference: 'Mental Health Act 2016 (QLD)',
      section_reference: 's 30',
      field_schema: JSON.stringify({
        sections: ['patient_identification', 'examination_grounds', 'risk_of_harm', 'capacity_to_consent', 'least_restrictive'],
      }),
      requires_authorised_psychiatrist: true,
      max_duration_days: 7,
      is_active: true,
    },
    {
      state_code: 'SA', form_code: 'level_1_detention',
      name: 'Mental Health Act 2009 (SA) — Level 1 Detention Order',
      act_reference: 'Mental Health Act 2009 (SA)',
      section_reference: 's 21',
      field_schema: JSON.stringify({
        sections: ['patient_identification', 'medical_practitioner_reasons', 'mental_illness_criteria', 'protective_reason', 'duration'],
      }),
      requires_authorised_psychiatrist: false,
      max_duration_days: 7,
      is_active: true,
    },
    {
      state_code: 'WA', form_code: 'referral',
      name: 'Mental Health Act 2014 (WA) — Referral for Examination',
      act_reference: 'Mental Health Act 2014 (WA)',
      section_reference: 's 26',
      field_schema: JSON.stringify({
        sections: ['patient_identification', 'referring_practitioner', 'grounds_for_referral', 'risk_justification', 'next_steps'],
      }),
      requires_authorised_psychiatrist: false,
      max_duration_days: 3,
      is_active: true,
    },
    {
      state_code: 'TAS', form_code: 'assessment_order',
      name: 'Mental Health Act 2013 (TAS) — Assessment Order',
      act_reference: 'Mental Health Act 2013 (TAS)',
      section_reference: 's 23',
      field_schema: JSON.stringify({
        sections: ['patient_identification', 'assessment_criteria', 'risk_to_self', 'risk_to_others', 'duration_justification'],
      }),
      requires_authorised_psychiatrist: true,
      max_duration_days: 3,
      is_active: true,
    },
    {
      state_code: 'ACT', form_code: 'ea_order',
      name: 'Mental Health Act 2015 (ACT) — Emergency Action',
      act_reference: 'Mental Health Act 2015 (ACT)',
      section_reference: 's 80',
      field_schema: JSON.stringify({
        sections: ['patient_identification', 'emergency_grounds', 'clinical_justification', 'risk_statement'],
      }),
      requires_authorised_psychiatrist: false,
      max_duration_days: 3,
      is_active: true,
    },
    {
      state_code: 'NT', form_code: 'admission_recommendation',
      name: 'Mental Health and Related Services Act 1998 (NT) — Admission Recommendation',
      act_reference: 'Mental Health and Related Services Act 1998 (NT)',
      section_reference: 's 32',
      field_schema: JSON.stringify({
        sections: ['patient_identification', 'recommending_practitioner', 'mental_illness_criteria', 'risk_criteria', 'duration'],
      }),
      requires_authorised_psychiatrist: false,
      max_duration_days: 7,
      is_active: true,
    },
  ]);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clinic_settings', (t) => {
    t.dropColumn('default_guidelines');
  });

  // @migration-raw-exempt: drop_policy_if_exists
  await knex.raw('DROP POLICY IF EXISTS rls_letter_tone_presets_tenant ON letter_tone_presets');
  await knex.schema.dropTableIfExists('letter_tone_presets');

  // @migration-raw-exempt: drop_policy_if_exists
  await knex.raw('DROP POLICY IF EXISTS rls_letter_citations_tenant ON letter_citations');
  await knex.schema.dropTableIfExists('letter_citations');

  // @migration-raw-exempt: drop_policy_if_exists
  await knex.raw('DROP POLICY IF EXISTS rls_forensic_risk_formulations_tenant ON forensic_risk_formulations');
  await knex.schema.dropTableIfExists('forensic_risk_formulations');

  // @migration-raw-exempt: drop_policy_if_exists
  await knex.raw('DROP POLICY IF EXISTS rls_capacity_assessments_tenant ON capacity_assessments');
  await knex.schema.dropTableIfExists('capacity_assessments');

  await knex.schema.dropTableIfExists('state_mha_forms');
}
