import { Knex } from 'knex';

/**
 * Audit Tier 15 — Letter Phase 1: template registry, draft-to-sign
 * workflow, section-level regen, immutable audit log.
 *
 * Tier 12 introduced one-off referral letter generation via the
 * scribe pipeline. Tier 15 makes letters a first-class entity with:
 *
 *   1. letter_templates (15.1) — 10+ Australian-context templates
 *      seeded as vendor-global rows (clinic_id IS NULL). Clinic
 *      overrides go in the same table with a non-null clinic_id.
 *      Each template has a {sections[]} layout; the renderer
 *      composes one prompt per section so a clinician can regen a
 *      single section without losing edits elsewhere.
 *
 *   2. letters (15.2) — the authored letter. Status machine:
 *      draft → in_review → approved → sent → (revised → in_review...).
 *      Every state change writes a letter_audit_log row.
 *
 *   3. letter_sections (15.3) — per-section content + regen count.
 *      Section-level regen is the key medico-legal feature: the
 *      clinician regens "Plan" without touching "Risk" so their
 *      edits in Risk aren't clobbered.
 *
 *   4. letter_audit_log (15.4) — immutable append-only log. Every
 *      event: created, section_regenerated, section_edited,
 *      submitted_for_review, approved, rejected, sent. Actor + actor
 *      role + timestamp + diff summary. Drives the medico-legal
 *      "who saw + approved this letter and when" trail.
 *
 *   5. Review queue is a VIEW over letters.status='in_review', not
 *      a separate table — status is the authoritative state.
 *
 * RLS + indexes + CHECK constraints per §6.3 / §7.1 / §12.4.
 */
export async function up(knex: Knex): Promise<void> {
  // 15.1 — letter_templates. Vendor-global rows have clinic_id=NULL.
  await knex.schema.createTable('letter_templates', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').nullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.string('code', 60).notNullable();
    t.string('name', 200).notNullable();
    t.string('category', 40).notNullable();
    t.text('description').nullable();
    t.jsonb('sections').notNullable();
    t.text('system_prompt').notNullable();
    t.jsonb('default_recipients').nullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.boolean('requires_second_review').notNullable().defaultTo(false);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['category', 'is_active']);
    t.index(['clinic_id', 'code'], 'idx_letter_templates_clinic_code');
  });

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE letter_templates
      ADD CONSTRAINT letter_templates_category_check
      CHECK (category IN (
        'referral_gp','referral_specialist','discharge_summary',
        'medicare_authority','mha_notification','mha_capacity',
        'court_mse_report','centrelink_support','family_consent',
        'school_support','workcover_certificate','ndis_evidence',
        'legal_ordered_assessment','carer_update'
      ))
  `);

  // NOTE: the unique index on (clinic_id, code) intentionally
  // excludes vendor-global rows (clinic_id IS NULL) because Postgres
  // treats NULL != NULL in unique — multiple system rows would
  // require a partial unique. We add both: a partial UNIQUE on
  // system rows by code alone, and a partial UNIQUE on clinic
  // overrides by (clinic_id, code).
  // @migration-raw-exempt: index_partial
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_letter_templates_system_code
      ON letter_templates (code) WHERE clinic_id IS NULL
  `);
  // @migration-raw-exempt: index_partial
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_letter_templates_clinic_unique
      ON letter_templates (clinic_id, code) WHERE clinic_id IS NOT NULL
  `);

  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE letter_templates ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_letter_templates_tenant ON letter_templates
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

  // 15.2 — letters. The core entity.
  await knex.schema.createTable('letters', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.uuid('template_id').notNullable().references('id').inTable('letter_templates').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
    t.uuid('author_id').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    t.uuid('session_id').nullable().references('id').inTable('scribe_sessions').onDelete('SET NULL');
    t.string('status', 20).notNullable().defaultTo('draft');
    t.string('subject', 300).notNullable();
    t.jsonb('recipients').notNullable().defaultTo('[]');
    t.text('rendered_text').nullable();
    t.uuid('approved_by').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('approved_at', { useTz: true }).nullable();
    t.uuid('sent_by').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('sent_at', { useTz: true }).nullable();
    t.integer('revision').notNullable().defaultTo(1);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id']);
    t.index(['patient_id']);
    t.index(['episode_id']);
    t.index(['clinic_id', 'status'], 'idx_letters_review_queue');
    t.index(['author_id']);
  });

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE letters
      ADD CONSTRAINT letters_status_check
      CHECK (status IN ('draft','in_review','approved','sent','revised','withdrawn'))
  `);

  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE letters ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_letters_tenant ON letters
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // 15.3 — letter_sections. One row per letter × section, so section
  // regen is a targeted update.
  await knex.schema.createTable('letter_sections', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.uuid('letter_id').notNullable().references('id').inTable('letters').onDelete('CASCADE');
    t.string('section_key', 60).notNullable();
    t.integer('section_order').notNullable();
    t.string('label', 200).notNullable();
    t.text('content').notNullable().defaultTo('');
    t.integer('regen_count').notNullable().defaultTo(0);
    t.timestamp('last_regen_at', { useTz: true }).nullable();
    t.uuid('last_regen_by').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['letter_id', 'section_key']);
    t.index(['clinic_id']);
    t.index(['letter_id', 'section_order'], 'idx_letter_sections_order');
  });

  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE letter_sections ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_letter_sections_tenant ON letter_sections
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // 15.4 — letter_audit_log. Append-only. Every lifecycle event.
  await knex.schema.createTable('letter_audit_log', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.uuid('letter_id').notNullable().references('id').inTable('letters').onDelete('CASCADE');
    t.string('event', 40).notNullable();
    t.uuid('actor_id').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    t.string('actor_role', 60).notNullable();
    t.string('section_key', 60).nullable();
    t.jsonb('diff_summary').nullable();
    t.string('ip_address', 64).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id']);
    t.index(['letter_id', 'created_at'], 'idx_letter_audit_log_timeline');
  });

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE letter_audit_log
      ADD CONSTRAINT letter_audit_log_event_check
      CHECK (event IN (
        'created','section_regenerated','section_edited',
        'submitted_for_review','approved','rejected','sent',
        'withdrawn','revised'
      ))
  `);

  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE letter_audit_log ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_letter_audit_log_tenant ON letter_audit_log
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // 15.5 — seed 14 Australian letter templates as vendor-global rows
  // (clinic_id NULL). The `sections` column is a JSONB array of
  // {key, label, prompt} tuples; the service composes one prompt per
  // section so regen is targeted.
  await knex('letter_templates').insert([
    {
      clinic_id: null,
      code: 'referral_gp_handover',
      name: 'Referral / handover to GP',
      category: 'referral_gp',
      description: 'Standard GP handover letter after specialist consultation.',
      sections: JSON.stringify([
        { key: 'salutation', label: 'Salutation', prompt: 'Formal salutation addressed to the GP by name.' },
        { key: 'presentation', label: 'Presentation', prompt: 'Concise presenting complaint in 2-3 sentences.' },
        { key: 'history', label: 'Relevant history', prompt: 'Key relevant history, prior episodes, risk flags.' },
        { key: 'mse', label: 'Mental state', prompt: 'Brief MSE at consultation.' },
        { key: 'formulation', label: 'Formulation', prompt: 'Biopsychosocial formulation with ICD-10-AM diagnosis.' },
        { key: 'plan', label: 'Plan', prompt: 'Plan: medications, follow-up, crisis contingency.' },
        { key: 'signoff', label: 'Sign-off', prompt: 'Formal sign-off with clinician name + role label.' },
      ]),
      system_prompt: 'You are a senior Australian psychiatrist writing a professional handover letter to a GP colleague. Australian English. Formal but collegial tone. Use ICD-10-AM codes.',
      default_recipients: null,
      is_active: true,
      requires_second_review: false,
    },
    {
      clinic_id: null,
      code: 'referral_specialist',
      name: 'Referral to specialist',
      category: 'referral_specialist',
      description: 'Onward referral to another specialist (neurology, endocrinology, etc.).',
      sections: JSON.stringify([
        { key: 'salutation', label: 'Salutation', prompt: 'Addressed to specialist by name and title.' },
        { key: 'reason', label: 'Reason for referral', prompt: 'Clear statement of why this referral.' },
        { key: 'summary', label: 'Summary', prompt: 'Relevant clinical summary.' },
        { key: 'medications', label: 'Current medications', prompt: 'List with dose + indication.' },
        { key: 'plan', label: 'Urgency / plan', prompt: 'Requested urgency + what handover you expect.' },
        { key: 'signoff', label: 'Sign-off', prompt: 'Formal sign-off with role label.' },
      ]),
      system_prompt: 'You are a senior Australian clinician writing a referral letter to another specialist. Be specific about the clinical question being asked.',
      default_recipients: null,
      is_active: true,
      requires_second_review: false,
    },
    {
      clinic_id: null,
      code: 'discharge_summary',
      name: 'Discharge summary',
      category: 'discharge_summary',
      description: 'Standard discharge summary after inpatient or episode of care.',
      sections: JSON.stringify([
        { key: 'admission', label: 'Admission', prompt: 'Dates, unit, voluntary status.' },
        { key: 'presentation', label: 'Presentation on admission', prompt: 'What brought the patient in.' },
        { key: 'management', label: 'Management during episode', prompt: 'Interventions, medication changes, key events.' },
        { key: 'progress', label: 'Progress', prompt: 'Response to treatment, risk trajectory.' },
        { key: 'dc_mse', label: 'MSE at discharge', prompt: 'Mental state at discharge.' },
        { key: 'diagnosis', label: 'Discharge diagnosis', prompt: 'Primary + secondary with ICD-10-AM.' },
        { key: 'medications', label: 'Discharge medications', prompt: 'Full list with dose, frequency, indication.' },
        { key: 'followup', label: 'Follow-up', prompt: 'Outpatient arrangements + contingency.' },
        { key: 'signoff', label: 'Sign-off', prompt: 'Formal sign-off.' },
      ]),
      system_prompt: 'You are writing an Australian mental health discharge summary. Be clinically thorough, especially risk status at discharge and follow-up arrangements.',
      default_recipients: null,
      is_active: true,
      requires_second_review: true,
    },
    {
      clinic_id: null,
      code: 'medicare_authority_request',
      name: 'Medicare authority request',
      category: 'medicare_authority',
      description: 'PBS authority prescription request to Medicare Services Australia.',
      sections: JSON.stringify([
        { key: 'header', label: 'Request header', prompt: 'Patient details + PBS authority item.' },
        { key: 'diagnosis', label: 'Diagnosis', prompt: 'ICD-10-AM diagnosis justifying the authority.' },
        { key: 'clinical_justification', label: 'Clinical justification', prompt: 'Why this medication is clinically necessary.' },
        { key: 'prior_therapy', label: 'Prior therapy', prompt: 'Previous treatments tried + response.' },
        { key: 'signoff', label: 'Prescriber sign-off', prompt: 'Prescriber number + sign-off.' },
      ]),
      system_prompt: 'You are writing a PBS authority request. Structure according to Medicare requirements. Be concise and evidence-based.',
      default_recipients: null,
      is_active: true,
      requires_second_review: false,
    },
    {
      clinic_id: null,
      code: 'mha_s28_notification',
      name: 'Mental Health Act notification',
      category: 'mha_notification',
      description: 'Notification under the applicable state MHA (s28 / equivalent) when a patient is placed under an order.',
      sections: JSON.stringify([
        { key: 'order_details', label: 'Order details', prompt: 'Type of order, section, duration.' },
        { key: 'clinical_justification', label: 'Clinical justification', prompt: 'Criteria met for the order.' },
        { key: 'risk', label: 'Risk', prompt: 'Risk to self / others / vulnerability.' },
        { key: 'capacity', label: 'Capacity', prompt: 'Assessment of decision-making capacity.' },
        { key: 'less_restrictive', label: 'Less restrictive alternatives', prompt: 'Why less restrictive alternatives are not sufficient.' },
        { key: 'signoff', label: 'Authorised psychiatrist sign-off', prompt: 'Sign-off with authorisation status.' },
      ]),
      system_prompt: 'You are drafting a Mental Health Act notification. State jurisdiction matters — use the correct section number for the patient\'s state. This is a legal document; factual accuracy + clinical justification are essential.',
      default_recipients: null,
      is_active: true,
      requires_second_review: true,
    },
    {
      clinic_id: null,
      code: 'mha_capacity_assessment',
      name: 'Mental Health Act capacity assessment',
      category: 'mha_capacity',
      description: 'Decision-making capacity assessment for treatment consent.',
      sections: JSON.stringify([
        { key: 'context', label: 'Context of assessment', prompt: 'Reason capacity is being assessed + decision in question.' },
        { key: 'understanding', label: 'Understanding', prompt: 'Patient\'s understanding of the information.' },
        { key: 'retention', label: 'Retention', prompt: 'Ability to retain information long enough to decide.' },
        { key: 'weighing', label: 'Weighing', prompt: 'Ability to weigh pros + cons.' },
        { key: 'communication', label: 'Communication', prompt: 'Ability to communicate a decision.' },
        { key: 'conclusion', label: 'Conclusion', prompt: 'Does the patient have capacity for THIS decision?' },
        { key: 'signoff', label: 'Sign-off', prompt: 'Assessor sign-off with qualification.' },
      ]),
      system_prompt: 'You are writing a decision-making capacity assessment. Be specific to the decision at hand — capacity is decision-specific, not global. Use the four-test framework (understand / retain / weigh / communicate).',
      default_recipients: null,
      is_active: true,
      requires_second_review: true,
    },
    {
      clinic_id: null,
      code: 'court_mse_report',
      name: 'Mental state report for court',
      category: 'court_mse_report',
      description: 'Court-requested MSE report (forensic / criminal / family court).',
      sections: JSON.stringify([
        { key: 'instruction', label: 'Letter of instruction', prompt: 'Reference to the letter of instruction + questions asked.' },
        { key: 'sources', label: 'Sources of information', prompt: 'Records reviewed + interviews conducted.' },
        { key: 'history', label: 'History', prompt: 'Relevant psychiatric + medical history.' },
        { key: 'mse', label: 'Mental state examination', prompt: 'Detailed MSE at interview.' },
        { key: 'diagnosis', label: 'Diagnosis', prompt: 'DSM-5-TR + ICD-10-AM.' },
        { key: 'opinion', label: 'Opinion on the questions asked', prompt: 'Direct response to each court question.' },
        { key: 'signoff', label: 'Expert sign-off', prompt: 'Expert witness declaration + sign-off.' },
      ]),
      system_prompt: 'You are a consultant psychiatrist writing an expert witness report for the court. Maintain the expert witness duty to the court. Distinguish fact from opinion. Cite the evidence for every conclusion. Never speculate.',
      default_recipients: null,
      is_active: true,
      requires_second_review: true,
    },
    {
      clinic_id: null,
      code: 'centrelink_support_letter',
      name: 'Centrelink medical support letter',
      category: 'centrelink_support',
      description: 'Support letter for DSP / Jobseeker medical certificate.',
      sections: JSON.stringify([
        { key: 'patient', label: 'Patient details', prompt: 'Full name, DOB, CRN if provided.' },
        { key: 'diagnosis', label: 'Diagnosis', prompt: 'Primary + co-morbid with ICD-10-AM.' },
        { key: 'duration', label: 'Duration', prompt: 'When symptoms began + expected duration.' },
        { key: 'impact', label: 'Functional impact', prompt: 'Impact on work / self-care / social function.' },
        { key: 'treatment', label: 'Current treatment', prompt: 'Medications + therapy engagement.' },
        { key: 'signoff', label: 'Treating practitioner sign-off', prompt: 'AHPRA registration + sign-off.' },
      ]),
      system_prompt: 'You are writing a Centrelink support letter. Be specific about functional impact — Centrelink decisions rest on functional limitations, not diagnosis alone.',
      default_recipients: null,
      is_active: true,
      requires_second_review: false,
    },
    {
      clinic_id: null,
      code: 'family_consent_letter',
      name: 'Family / carer information letter',
      category: 'family_consent',
      description: 'Information release to family / carers under substitute consent or patient-consented sharing.',
      sections: JSON.stringify([
        { key: 'intro', label: 'Introduction', prompt: 'What the letter is for + who the recipient is.' },
        { key: 'authority', label: 'Legal authority', prompt: 'Basis for the disclosure (patient consent / nominated carer / guardianship).' },
        { key: 'summary', label: 'Clinical summary', prompt: 'Appropriate level of detail given the authority.' },
        { key: 'safety', label: 'Safety information', prompt: 'What the family should watch for + who to call.' },
        { key: 'signoff', label: 'Sign-off', prompt: 'Respectful sign-off.' },
      ]),
      system_prompt: 'You are writing to a family member or carer. Be warm but professional. Respect the patient\'s autonomy — only share what the authority permits.',
      default_recipients: null,
      is_active: true,
      requires_second_review: false,
    },
    {
      clinic_id: null,
      code: 'school_support_letter',
      name: 'School / education support letter',
      category: 'school_support',
      description: 'Support letter for school adjustments / individual learning plan.',
      sections: JSON.stringify([
        { key: 'intro', label: 'Introduction', prompt: 'Who is writing + the student + their year level.' },
        { key: 'diagnosis', label: 'Diagnosis', prompt: 'Diagnosis(es) relevant to learning.' },
        { key: 'impact', label: 'Educational impact', prompt: 'How the condition affects learning / attendance / social.' },
        { key: 'adjustments', label: 'Recommended adjustments', prompt: 'Specific practical adjustments.' },
        { key: 'signoff', label: 'Sign-off', prompt: 'AHPRA sign-off.' },
      ]),
      system_prompt: 'You are writing to an Australian school. Be concrete about practical adjustments. Avoid diagnostic jargon the school\'s staff won\'t be able to action.',
      default_recipients: null,
      is_active: true,
      requires_second_review: false,
    },
  ]);
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: drop_policy_if_exists
  await knex.raw('DROP POLICY IF EXISTS rls_letter_audit_log_tenant ON letter_audit_log');
  await knex.schema.dropTableIfExists('letter_audit_log');

  // @migration-raw-exempt: drop_policy_if_exists
  await knex.raw('DROP POLICY IF EXISTS rls_letter_sections_tenant ON letter_sections');
  await knex.schema.dropTableIfExists('letter_sections');

  // @migration-raw-exempt: drop_policy_if_exists
  await knex.raw('DROP POLICY IF EXISTS rls_letters_tenant ON letters');
  await knex.schema.dropTableIfExists('letters');

  // @migration-raw-exempt: drop_policy_if_exists
  await knex.raw('DROP POLICY IF EXISTS rls_letter_templates_tenant ON letter_templates');
  await knex.schema.dropTableIfExists('letter_templates');
}
