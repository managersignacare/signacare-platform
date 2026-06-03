=== Phase -1.C direct investigation — started 2026-04-19T05:36:18Z ===

=== C.1 npm audit ===
{
  "critical": 1,
  "high": 1,
  "moderate": 2,
  "low": 1,
  "info": 0
}

=== C.2 audit_log permissions (REVOKE UPDATE/DELETE?) ===
                                                                                    Access privileges
 Schema |   Name    | Type  |            Access privileges             | Column privileges |                                          Policies                                           
--------+-----------+-------+------------------------------------------+-------------------+---------------------------------------------------------------------------------------------
 public | audit_log | table | signacare_owner=arwdDxtm/signacare_owner+|                   | rls_audit_log_preauth_insert (a):                                                          +
        |           |       | app_user=arwd/signacare_owner            |                   |   (c): (NULLIF(current_setting('app.clinic_id'::text, true), ''::text) IS NULL)            +
        |           |       |                                          |                   | rls_audit_log_tenant:                                                                      +
        |           |       |                                          |                   |   (u): (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)+
        |           |       |                                          |                   |   (c): (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
(1 row)


=== C.3 Every role_table_grant on audit_log ===
     grantee     | privilege_type 
-----------------+----------------
 app_user        | DELETE
 app_user        | INSERT
 app_user        | SELECT
 app_user        | UPDATE
 signacare_owner | DELETE
 signacare_owner | INSERT
 signacare_owner | REFERENCES
 signacare_owner | SELECT
 signacare_owner | TRIGGER
 signacare_owner | TRUNCATE
 signacare_owner | UPDATE
(11 rows)

=== C.4 Every RLS policy enumerated ===
 schemaname |           tablename           |                policyname                |  cmd   |                                                     qual                                                      
------------+-------------------------------+------------------------------------------+--------+---------------------------------------------------------------------------------------------------------------
 public     | active_sessions               | rls_active_sessions_tenant               | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | admin_impersonation_sessions  | rls_admin_impersonation_sessions_tenant  | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | admission_waitlist            | rls_admission_waitlist_tenant            | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | advance_directives            | rls_advance_directives_tenant            | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | ai_context_files              | rls_ai_context_files_tenant              | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | ai_model_approvals            | rls_ai_model_approvals_tenant            | ALL    | ((clinic_id IS NULL) OR (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid))
 public     | ai_modelfiles                 | rls_ai_modelfiles_tenant                 | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | ai_training_feedback          | rls_ai_training_feedback_tenant          | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | aims_assessments              | rls_aims_assessments_tenant              | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | alert_types                   | rls_alert_types_tenant                   | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | antenatal_visits              | rls_antenatal_visits_tenant              | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | appointment_attendees         | rls_appointment_attendees_tenant         | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | appointment_checklists        | rls_appointment_checklists_tenant        | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | appointment_checklists        | rls_appt_checklists                      | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | appointment_modes             | rls_appointment_modes_tenant             | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | appointments                  | rls_appointments_tenant                  | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | assessment_responses          | rls_assessment_responses_tenant          | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | audit_log                     | rls_audit_log_preauth_insert             | INSERT | 
 public     | audit_log                     | rls_audit_log_tenant                     | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | audit_runs                    | rls_audit_runs_tenant                    | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | audit_templates               | rls_audit_templates_tenant               | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | bed_movements                 | rls_bed_movements_tenant                 | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | beds                          | rls_beds_tenant                          | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | billing_accounts              | rls_billing_accounts_tenant              | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | billing_queue                 | rls_billing_queue_tenant                 | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | break_glass_sessions          | rls_break_glass_sessions_tenant          | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | cancer_treatment_plans        | rls_cancer_treatment_plans_tenant        | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | capacity_assessments          | rls_capacity_assessments_tenant          | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | care_plan_goals               | rls_care_plan_goals_tenant               | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | care_plan_interventions       | rls_care_plan_interventions_tenant       | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | care_plans                    | rls_care_plans_tenant                    | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | carers                        | rls_carers_tenant                        | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | checklist_instances           | rls_checklist_instances_tenant           | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | checklist_templates           | rls_checklist_templates_tenant           | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | chemo_cycles                  | rls_chemo_cycles_tenant                  | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | clinic_contact_options        | rls_clinic_contact_options_tenant        | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | clinic_enabled_specialties    | rls_clinic_enabled_specialties_tenant    | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | clinic_scribe_vocabulary      | rls_clinic_scribe_vocabulary_tenant      | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | clinic_settings               | rls_clinic_settings_tenant               | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | clinic_thresholds             | rls_clinic_thresholds_tenant             | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | clinical_formulations         | rls_clinical_formulations_tenant         | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | clinical_note_codes           | rls_clinical_note_codes_tenant           | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | clinical_note_evidence        | rls_clinical_note_evidence_tenant        | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | clinical_note_versions        | rls_clinical_note_versions_tenant        | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | clinical_notes                | rls_clinical_notes_tenant                | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | clinical_policies             | rls_clinical_policies_tenant             | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | clinical_reviews              | rls_clinical_reviews_tenant              | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | clinical_roles                | rls_clinical_roles_tenant                | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | clinical_templates            | rls_clinical_templates_tenant            | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | clinician_availability_blocks | rls_clinician_availability_blocks_tenant | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | clinician_fee_overrides       | rls_clinician_fee_overrides_tenant       | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | clozapine_administrations     | rls_clozapine_administrations_tenant     | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | clozapine_blood_results       | rls_clozapine_blood_results_tenant       | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | clozapine_monitoring_checks   | rls_clozapine_monitoring_checks_tenant   | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | clozapine_observations        | rls_clozapine_observations_tenant        | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | clozapine_registrations       | rls_clozapine_registrations_tenant       | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | clozapine_titration_days      | rls_clozapine_titration_days_tenant      | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | community_resources           | rls_community_resources_tenant           | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | consent_records               | rls_consent_records_tenant               | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | consultations                 | rls_consultations_tenant                 | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | contact_records               | rls_contact_records_tenant               | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | correspondence_letters        | rls_correspondence_letters_tenant        | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | data_breach_log               | rls_data_breach_log_tenant               | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | data_retention_policies       | rls_data_retention_policies_tenant       | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | data_sharing_agreements       | rls_data_sharing_agreements_tenant       | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | developmental_milestones      | rls_developmental_milestones_tenant      | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | diagnoses                     | rls_diagnoses_tenant                     | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | drug_products                 | rls_drug_products_tenant                 | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | ecog_performance_status       | rls_ecog_performance_status_tenant       | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | ect_courses                   | rls_ect_courses_tenant                   | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | ect_sessions                  | rls_ect_sessions_tenant                  | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | engagement_scores             | rls_engagement_scores_tenant             | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | episode_types                 | rls_episode_types_tenant                 | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | episodes                      | rls_episodes_tenant                      | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | ereferrals                    | rls_ereferrals_tenant                    | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | erx_tokens                    | rls_erx_tokens_tenant                    | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | escalations                   | rls_escalations_tenant                   | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | feature_flag_disable_requests | rls_ffd_requests_tenant                  | ALL    | ((clinic_id IS NULL) OR (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid))
 public     | feature_flags                 | rls_feature_flags_tenant                 | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | fee_schedules                 | rls_fee_schedules_tenant                 | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | fhir_bulk_export_jobs         | rls_fhir_bulk_export_jobs_tenant         | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | fhir_subscriptions            | rls_fhir_subscriptions_tenant            | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | forensic_risk_formulations    | rls_forensic_risk_formulations_tenant    | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | glucose_readings              | rls_glucose_readings_tenant              | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | group_sessions                | rls_group_sessions_tenant                | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | growth_measurements           | rls_growth_measurements_tenant           | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | hotspots                      | rls_hotspots_tenant                      | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | immunizations                 | rls_immunizations_tenant                 | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | import_jobs                   | rls_import_jobs_tenant                   | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | insulin_regimens              | rls_insulin_regimens_tenant              | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | investigation_types           | rls_investigation_types_tenant           | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | invoices                      | rls_invoices_tenant                      | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | key_issues                    | rls_key_issues_tenant                    | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | lai_given                     | rls_lai_given_tenant                     | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | lai_schedules                 | rls_lai_schedules_tenant                 | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | lai_validations               | rls_lai_validations_tenant               | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | legal_order_type_configs      | rls_legal_order_type_configs_tenant      | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | legal_orders                  | rls_legal_orders_tenant                  | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | letter_audit_log              | rls_letter_audit_log_tenant              | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | letter_citations              | rls_letter_citations_tenant              | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | letter_deliveries             | rls_letter_deliveries_tenant             | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | letter_exports                | rls_letter_exports_tenant                | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | letter_revisions              | rls_letter_revisions_tenant              | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | letter_sections               | rls_letter_sections_tenant               | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | letter_templates              | rls_letter_templates_tenant              | ALL    | ((clinic_id IS NULL) OR (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid))
 public     | letter_tone_presets           | rls_letter_tone_presets_tenant           | ALL    | ((clinic_id IS NULL) OR (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid))
 public     | letter_translations           | rls_letter_translations_tenant           | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | letters                       | rls_letters_tenant                       | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | llm_interactions              | rls_llm_interactions_tenant              | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | medication_administrations    | rls_medication_administrations_tenant    | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | medication_reconciliations    | rls_medication_reconciliations_tenant    | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | message_threads               | rls_message_threads_tenant               | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | messages                      | rls_messages_tenant                      | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | mfa_secrets                   | auth_bypass                              | ALL    | (NULLIF(current_setting('app.clinic_id'::text, true), ''::text) IS NULL)
 public     | mha_reviews                   | rls_mha_reviews_tenant                   | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | model_deployments             | rls_model_deployments_tenant             | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | notifications                 | rls_notifications_tenant                 | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | nursing_assessments           | rls_nursing_assessments_tenant           | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | oauth_access_tokens           | rls_oauth_access_tokens_tenant           | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | oauth_authorization_codes     | rls_oauth_authorization_codes_tenant     | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | oauth_refresh_tokens          | rls_oauth_refresh_tokens_tenant          | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | op_notes                      | rls_op_notes_tenant                      | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | org_level_labels              | rls_org_level_labels_tenant              | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | org_unit_programs             | rls_org_unit_programs_tenant             | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | org_units                     | rls_org_units_tenant                     | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | outcome_measures              | rls_outcome_measures_tenant              | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | pacu_records                  | rls_pacu_records_tenant                  | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | pathology_orders              | rls_pathology_orders_tenant              | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | pathology_results             | rls_pathology_results_tenant             | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | patient_alert_attachments     | rls_patient_alert_attachments_tenant     | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | patient_alerts                | rls_patient_alerts_tenant                | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | patient_allergies             | rls_patient_allergies_tenant             | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | patient_app_accounts          | rls_patient_app_accounts_tenant          | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | patient_attachments           | rls_patient_attachments_tenant           | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | patient_contacts              | rls_patient_contacts_tenant              | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | patient_fcm_tokens            | rls_patient_fcm_tokens_tenant            | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | patient_flags                 | rls_patient_flags_tenant                 | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | patient_invites               | rls_patient_invites                      | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | patient_invites               | rls_patient_invites_tenant               | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | patient_legal_attachments     | rls_patient_legal_attachments_tenant     | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | patient_legal_orders          | rls_patient_legal_orders_tenant          | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | patient_med_reminders         | rls_patient_med_reminders_tenant         | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | patient_medications           | rls_patient_medications_tenant           | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | patient_merges                | rls_patient_merges_tenant                | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | patient_outreach_log          | rls_patient_outreach_log_tenant          | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | patient_providers             | rls_patient_providers_tenant             | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | patient_shared_documents      | rls_patient_shared_documents_tenant      | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | patient_shared_documents      | rls_shared_docs                          | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | patient_sync_preferences      | rls_patient_sync_preferences_tenant      | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | patient_tasks                 | rls_patient_tasks                        | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | patient_tasks                 | rls_patient_tasks_tenant                 | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | patient_team_reallocations    | rls_patient_team_reallocations_tenant    | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | patient_tracking              | rls_patient_tracking                     | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | patient_tracking              | rls_patient_tracking_tenant              | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | patients                      | rls_patients_tenant                      | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | payments                      | rls_payments_tenant                      | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | phi_scrubber_rules            | rls_phi_scrubber_rules_tenant            | ALL    | ((clinic_id IS NULL) OR (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid))
 public     | phone_triage                  | rls_phone_triage_tenant                  | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | planned_transitions           | rls_planned_transitions_tenant           | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | pregnancies                   | rls_pregnancies_tenant                   | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | prescriptions                 | rls_prescriptions_tenant                 | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | primary_cancer_conditions     | rls_primary_cancer_conditions_tenant     | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | problem_list                  | rls_problem_list_tenant                  | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | professional_disciplines      | rls_professional_disciplines_tenant      | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | programs                      | rls_programs_tenant                      | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | psychology_session_notes      | rls_psychology_session_notes_tenant      | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | referral_attachments          | rls_referral_attachments_tenant          | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | referral_clinician_offers     | rls_referral_clinician_offers_tenant     | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | referral_feedback_log         | rls_referral_feedback_log_tenant         | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | referral_sources              | rls_referral_sources_tenant              | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | referral_state_transitions    | rls_referral_state_transitions_tenant    | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | referral_validity             | rls_referral_validity_tenant             | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | referral_workflow_events      | rls_referral_workflow_events_tenant      | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | referrals                     | rls_referrals_tenant                     | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | report_runs                   | rls_report_runs_tenant                   | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | report_schedules              | rls_report_schedules_tenant              | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | restrictive_interventions     | rls_restrictive_interventions_tenant     | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | review_plans                  | rls_review_plans_tenant                  | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | risk_assessments              | rls_risk_assessments_tenant              | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | safety_checklists             | rls_safety_checklists_tenant             | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | safety_plans                  | rls_safety_plans_tenant                  | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | scribe_action_items           | rls_scribe_action_items_tenant           | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | scribe_consents               | rls_scribe_consents_tenant               | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | scribe_note_templates         | rls_scribe_note_templates_tenant         | ALL    | ((clinic_id IS NULL) OR (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid))
 public     | scribe_sensitive_flags        | rls_scribe_sensitive_flags_tenant        | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | scribe_sessions               | rls_scribe_sessions_tenant               | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | scribe_talk_time_metrics      | rls_scribe_talk_time_metrics_tenant      | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | shift_handovers               | rls_shift_handovers_tenant               | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | side_effect_schedules         | rls_side_effect_schedules_tenant         | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | smart_apps                    | rls_smart_apps_tenant                    | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | smart_launch_contexts         | rls_smart_launch_contexts_tenant         | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | staff                         | auth_bypass                              | ALL    | (NULLIF(current_setting('app.clinic_id'::text, true), ''::text) IS NULL)
 public     | staff                         | rls_staff_tenant                         | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | staff_fcm_tokens              | rls_staff_fcm_tokens_tenant              | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | staff_leave                   | rls_staff_leave_tenant                   | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | staff_module_access           | rls_staff_module_access_tenant           | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | staff_sessions                | auth_bypass                              | ALL    | (NULLIF(current_setting('app.clinic_id'::text, true), ''::text) IS NULL)
 public     | staff_sessions                | rls_staff_sessions_tenant                | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | staff_specialties             | rls_staff_specialties_tenant             | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | structured_observations       | rls_structured_observations_tenant       | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | subscriber_branding           | rls_subscriber_branding_tenant           | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | subscriptions                 | rls_subscriptions_tenant                 | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | surgical_cases                | rls_surgical_cases_tenant                | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | tasks                         | rls_tasks_tenant                         | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | template_categories           | rls_template_categories_tenant           | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | templates                     | rls_templates_tenant                     | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | tms_courses                   | rls_tms_courses_tenant                   | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | tms_sessions                  | rls_tms_sessions_tenant                  | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | tnm_stage_groups              | rls_tnm_stage_groups_tenant              | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | training_export_requests      | rls_training_export_requests_tenant      | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | treatment_pathways            | rls_treatment_pathways_tenant            | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | treatment_plans               | rls_treatment_plans_tenant               | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | tumour_board_decisions        | rls_tumour_board_decisions_tenant        | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | viva_alert_thresholds         | rls_viva_alert_thresholds_tenant         | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | viva_alert_thresholds         | rls_viva_thresholds                      | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | voice_calls                   | rls_voice_calls_tenant                   | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | voice_patient_preferences     | rls_voice_patient_preferences_tenant     | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | voice_scripts                 | rls_voice_scripts_tenant                 | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | waitlist_entries              | rls_waitlist_entries_tenant              | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | webauthn_credentials          | rls_webauthn_credentials_tenant          | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | webhook_audit_log             | rls_webhook_audit_log_tenant             | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | webhook_secrets               | rls_webhook_secrets_tenant               | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | workflow_executions           | rls_workflow_executions_tenant           | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
 public     | workflows                     | rls_workflows_tenant                     | ALL    | (clinic_id = (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid)
(224 rows)


=== C.5 Tables with base type but no RLS policy ===
           table_name           
--------------------------------
 backup_config
 backup_history
 clinics
 escalation_events
 evidence_chunks
 evidence_documents
 group_session_attendees
 invoice_line_items
 knex_migrations
 knex_migrations_lock
 legal_order_types
 message_thread_participants
 model_registry
 model_surveillance_events
 patient_team_assignments
 permissions
 planned_transition_assignments
 specialties
 staff_permissions
 staff_role_assignments
 staff_settings
 staff_team_assignments
 state_mha_forms
 template_sections
 training_corpus_items
(25 rows)


=== C.6 Mass-assignment grep — raw req.body to update ===

=== C.7 CSP / CORS / helmet ===
apps/api/src/server.ts:250:  helmet({
apps/api/src/server.ts:282:  res.setHeader('X-Frame-Options', 'DENY');
apps/api/src/server.ts:290:  cors({
apps/api/src/server.ts-291-    origin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',').map(o => o.trim()).filter(Boolean),
apps/api/src/server.ts-292-    credentials: true,
apps/api/src/server.ts-293-    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

=== C.8 Timing-attack audit (login + token compare) ===
apps/api/src/integrations/fhir/smartAuth.ts:42:import { randomUUID, randomBytes, createHash, timingSafeEqual } from 'crypto';
apps/api/src/integrations/fhir/smartAuth.ts:65:    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
apps/api/src/features/calendar/icalTokenService.ts:31://      crypto.timingSafeEqual().
apps/api/src/features/calendar/icalTokenService.ts:46:import { createHmac, timingSafeEqual } from 'crypto';
apps/api/src/features/calendar/icalTokenService.ts:178:  // timingSafeEqual requires the two buffers to be the same
apps/api/src/features/calendar/icalTokenService.ts:182:  if (!timingSafeEqual(expectedSig, sigBuf)) return null;
apps/api/src/middleware/hmacSigning.ts:73:  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
apps/api/src/features/calendar/calendarIcalPublicRoutes.ts:16://     crypto.timingSafeEqual.
apps/api/src/features/auth/authRoutes.ts:155:  const valid = await bcrypt.compare(password, staff.password_hash);
apps/api/src/features/auth/authService.ts:102:    const passwordMatch = await bcrypt.compare(dto.password, staff.password_hash);
apps/api/src/features/auth/authService.ts:335:    const match = await bcrypt.compare(currentPassword, staff.password_hash);
apps/api/src/features/auth/authService.ts:354:    const sameAsOld = await bcrypt.compare(newPassword, staff.password_hash);
apps/api/src/features/auth/breakGlassRoutes.ts:154:    const passwordMatch = await bcrypt.compare(password, staff.password_hash);
apps/api/src/features/patient-app/patientAppRoutes.ts:364:    const valid = await bcrypt.compare(password, account.password_hash);
apps/api/src/features/webhooks/webhookVerifier.ts:15:import { createHash, createHmac, timingSafeEqual } from 'crypto';
--- any string equality on passwords/tokens? ---
apps/api/src/integrations/fcm/fcmClient.ts:61:  if (tokens.length === 0) {
apps/api/src/integrations/fhir/smartAuth.ts:570:    if (token_type_hint === 'refresh_token') {
apps/api/src/middleware/csrfMiddleware.ts:77:  if (token && token !== 'signacare-spa') {
apps/api/src/features/llm/llmRoutes.ts:385:      const token = typeof req.query.token === 'string' ? req.query.token : null;
apps/api/src/features/calendar/icalTokenService.ts:156:  if (typeof token !== 'string') return null;
apps/api/src/features/calendar/calendarIcalPublicRoutes.ts:65:    const token = typeof req.query.token === 'string' ? req.query.token : '';
apps/api/src/features/calendar/calendarIcalPublicRoutes.ts:112:      const token = typeof req.query.token === 'string' ? req.query.token : '';

=== C.9 useEffect with setInterval / setTimeout (leak candidates) ===
apps/web/src/shared/hooks/useEventStream.ts-39-
apps/web/src/shared/hooks/useEventStream.ts-40-    let reconnectTimeout: ReturnType<typeof setTimeout>;
apps/web/src/shared/hooks/useEventStream.ts-41-    let retryCount = 0;
apps/web/src/shared/hooks/useEventStream.ts-42-
apps/web/src/shared/hooks/useEventStream.ts-43-    function connect() {
--
apps/web/src/shared/hooks/useDebounce.ts:8:  useEffect(() => {
apps/web/src/shared/hooks/useDebounce.ts-9-    const timer = window.setTimeout(() => {
apps/web/src/shared/hooks/useDebounce.ts-10-      setDebouncedValue(value);
apps/web/src/shared/hooks/useDebounce.ts-11-    }, delay);
apps/web/src/shared/hooks/useDebounce.ts-12-
--
apps/web/src/shared/hooks/useInactivityTimer.ts-72-    resetTimer();
apps/web/src/shared/hooks/useInactivityTimer.ts-73-    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, resetTimer, { passive: true }));
apps/web/src/shared/hooks/useInactivityTimer.ts-74-    return () => {
apps/web/src/shared/hooks/useInactivityTimer.ts-75-      if (timerRef.current) clearTimeout(timerRef.current);
apps/web/src/shared/hooks/useInactivityTimer.ts-76-      if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
--
apps/web/src/features/dashboard/pages/DashboardPage.tsx-140-    if (!autoRefresh) return;
apps/web/src/features/dashboard/pages/DashboardPage.tsx-141-    const interval = setInterval(() => {
apps/web/src/features/dashboard/pages/DashboardPage.tsx-142-      qc.invalidateQueries({ queryKey: dashboardKeys.all });
apps/web/src/features/dashboard/pages/DashboardPage.tsx-143-      qc.invalidateQueries({ queryKey: dashboardKeys.dashPrefix() });
apps/web/src/features/dashboard/pages/DashboardPage.tsx-144-      setLastRefresh(new Date());
--
apps/web/src/features/calendar/components/AvailabilityGridEditor.tsx-115-    const onUp = () => commit();
apps/web/src/features/calendar/components/AvailabilityGridEditor.tsx-116-    window.addEventListener('mouseup', onUp);
apps/web/src/features/calendar/components/AvailabilityGridEditor.tsx-117-    return () => window.removeEventListener('mouseup', onUp);
apps/web/src/features/calendar/components/AvailabilityGridEditor.tsx-118-    // eslint-disable-next-line react-hooks/exhaustive-deps
apps/web/src/features/calendar/components/AvailabilityGridEditor.tsx-119-  }, [dragging, pending]);
--
apps/web/src/shared/components/ui/GuidedTour.tsx-112-    const handler = () => setDismissed(false);
apps/web/src/shared/components/ui/GuidedTour.tsx-113-    window.addEventListener('reopen-tour', handler);
apps/web/src/shared/components/ui/GuidedTour.tsx-114-    return () => window.removeEventListener('reopen-tour', handler);
apps/web/src/shared/components/ui/GuidedTour.tsx-115-  }, []);
apps/web/src/shared/components/ui/GuidedTour.tsx-116-  const navigate = useNavigate();
--
apps/web/src/shared/components/ui/GuidedTour.tsx-156-    };
apps/web/src/shared/components/ui/GuidedTour.tsx-157-    window.addEventListener('keydown', handler);
apps/web/src/shared/components/ui/GuidedTour.tsx-158-    return () => window.removeEventListener('keydown', handler);
apps/web/src/shared/components/ui/GuidedTour.tsx-159-  }, [activeTour, next]);

=== C.10 BullMQ queues + workers — back-pressure / concurrency limits ===
apps/api/src/routes/health.ts:81:    const q = new Queue('hl7-outbound', {
apps/api/src/routes/health.ts-82-      connection: { host: process.env['REDIS_HOST'] ?? 'localhost', port: 6379 },
apps/api/src/routes/health.ts-83-    });
apps/api/src/routes/health.ts-84-    const [waiting, active, failed] = await Promise.all([
apps/api/src/routes/health.ts-85-      q.getWaitingCount(),
apps/api/src/routes/health.ts-86-      q.getActiveCount(),
--
apps/api/src/jobs/workers/hl7Worker.ts:119:const outboundWorker = new Worker(
apps/api/src/jobs/workers/hl7Worker.ts-120-  'hl7-outbound',
apps/api/src/jobs/workers/hl7Worker.ts-121-  async (job) => {
apps/api/src/jobs/workers/hl7Worker.ts-122-    const { orderId, clinicId, orderNumber } = job.data as {
apps/api/src/jobs/workers/hl7Worker.ts-123-      orderId: string;
apps/api/src/jobs/workers/hl7Worker.ts-124-      clinicId: string;
--
apps/api/src/jobs/workers/hl7Worker.ts:194:const inboundQueue = new Queue('hl7-inbound', { connection });
apps/api/src/jobs/workers/hl7Worker.ts-195-
apps/api/src/jobs/workers/hl7Worker.ts:196:new Worker(
apps/api/src/jobs/workers/hl7Worker.ts-197-  'hl7-inbound',
apps/api/src/jobs/workers/hl7Worker.ts-198-  async (job) => {
apps/api/src/jobs/workers/hl7Worker.ts-199-    const { clinicId, hl7Message } = job.data as {
apps/api/src/jobs/workers/hl7Worker.ts-200-      clinicId: string;
apps/api/src/jobs/workers/hl7Worker.ts-201-      hl7Message: string;
--
apps/api/src/jobs/workers/outlookWorker.ts:30:new Worker(
apps/api/src/jobs/workers/outlookWorker.ts-31-  'outlook',
apps/api/src/jobs/workers/outlookWorker.ts-32-  async (job: Job) => {
apps/api/src/jobs/workers/outlookWorker.ts-33-    const data = job.data as OutlookJobData;
apps/api/src/jobs/workers/outlookWorker.ts-34-
apps/api/src/jobs/workers/outlookWorker.ts-35-    // Wrap all DB queries in tenant context for RLS
--
apps/api/src/jobs/workers/sessionCleanupWorker.ts:18:export const sessionCleanupQueue = redisConnection ? new Queue('session-cleanup', {
apps/api/src/jobs/workers/sessionCleanupWorker.ts-19-  connection: redisConnection,
apps/api/src/jobs/workers/sessionCleanupWorker.ts-20-  defaultJobOptions: { removeOnComplete: 10, removeOnFail: 5 },
apps/api/src/jobs/workers/sessionCleanupWorker.ts-21-}) : null;
apps/api/src/jobs/workers/sessionCleanupWorker.ts-22-
apps/api/src/jobs/workers/sessionCleanupWorker.ts-23-export async function scheduleSessionCleanup(): Promise<void> {
--
apps/api/src/jobs/workers/sessionCleanupWorker.ts:33:  new Worker(
apps/api/src/jobs/workers/sessionCleanupWorker.ts-34-    'session-cleanup',
apps/api/src/jobs/workers/sessionCleanupWorker.ts-35-    async (_job: Job) => {

=== C.11 CSV export formula injection ===
apps/api/src/integrations/cmi/cmiRoutes.ts:59:    res.setHeader('Content-Type', 'text/csv');
apps/api/src/features/reports/reportsService.ts:200:        mimeType: 'text/csv',
apps/api/src/features/patients/patientRoutes.ts:154:  'text/csv', 'text/plain', 'application/rtf', 'application/xml', 'application/json',
apps/api/src/features/contacts/contactRecordRoutes.ts:159:      res.setHeader('Content-Type', 'text/csv');

=== C.12 Email + SMS template rendering (XSS via patient name) ===
apps/api/src/integrations/outlook/outlookRoutes.ts:115:    const { sendEmail, formatClinicalLetterHtml } = await import('./outlookEmailService');
apps/api/src/integrations/outlook/outlookRoutes.ts-116-    const staffId = req.user?.id as string;
apps/api/src/integrations/outlook/outlookRoutes.ts-117-    const { to, cc, subject, body, recipientName, patientName, isLetter } = req.body;
apps/api/src/integrations/outlook/outlookRoutes.ts-118-
apps/api/src/integrations/outlook/outlookRoutes.ts-119-    // Get sender details
apps/api/src/integrations/outlook/outlookRoutes.ts-120-    const staff = await db('staff').where({ id: staffId }).first('given_name', 'family_name');
--
apps/api/src/integrations/outlook/outlookRoutes.ts:137:    await sendEmail(staffId, {
apps/api/src/integrations/outlook/outlookRoutes.ts-138-      to: Array.isArray(to) ? to : [to],
apps/api/src/integrations/outlook/outlookRoutes.ts-139-      cc: cc ? (Array.isArray(cc) ? cc : [cc]) : undefined,
apps/api/src/integrations/outlook/outlookRoutes.ts-140-      subject,
apps/api/src/integrations/outlook/outlookRoutes.ts-141-      htmlBody,
apps/api/src/integrations/outlook/outlookRoutes.ts-142-    });
--
apps/api/src/integrations/outlook/outlookEmailService.ts:87:export async function sendEmail(staffId: string, payload: SendEmailPayload): Promise<void> {
apps/api/src/integrations/outlook/outlookEmailService.ts-88-  const tokens = await ensureAccessToken(staffId);
apps/api/src/integrations/outlook/outlookEmailService.ts-89-
apps/api/src/integrations/outlook/outlookEmailService.ts-90-  const message: any = {
apps/api/src/integrations/outlook/outlookEmailService.ts-91-    subject: payload.subject,
apps/api/src/integrations/outlook/outlookEmailService.ts-92-    body: { contentType: 'HTML', content: payload.htmlBody },
--
apps/api/src/integrations/escript/tokenDeliveryService.ts:63:async function sendSms(phone: string, body: string): Promise<{ sent: boolean; error?: string }> {
apps/api/src/integrations/escript/tokenDeliveryService.ts-64-  if (!isSmsConfigured()) {
apps/api/src/integrations/escript/tokenDeliveryService.ts-65-    return { sent: false, error: 'SMS gateway not configured. Set SMS_GATEWAY_URL and SMS_GATEWAY_API_KEY.' };
apps/api/src/integrations/escript/tokenDeliveryService.ts-66-  }
apps/api/src/integrations/escript/tokenDeliveryService.ts-67-
apps/api/src/integrations/escript/tokenDeliveryService.ts-68-  // Tier 7.1 — requireEnv throws if the integration is configured-yet-
--
apps/api/src/integrations/escript/tokenDeliveryService.ts:135:    const { sendEmail } = await import('../outlook/outlookEmailService');
apps/api/src/integrations/escript/tokenDeliveryService.ts:136:    await sendEmail(payload.prescribedBy, {

=== C.13 PDF renderer format-string ===
apps/api/src/shared/pdfGenerator.ts:6:import PDFDocument from 'pdfkit';
apps/api/src/shared/pdfGenerator.ts:32:      const doc = new PDFDocument({ size: 'A4', margin: 60 });
apps/api/src/features/llm/letterDeliveryService.ts:10:import PDFDocument from 'pdfkit';
apps/api/src/features/llm/letterDeliveryService.ts:182: * Render a letter to an export artefact. PDF uses pdfkit + the clinic
apps/api/src/features/llm/letterDeliveryService.ts:284:    const doc = new PDFDocument({ size: 'A4', margin: 50 });

=== C.14 JWT secret rotation ===
apps/api/src/server.ts:19:// that reads process.env (config.ts validates JWT_ACCESS_SECRET etc.
apps/api/src/config/secrets.ts:50:  'JWT_ACCESS_SECRET',
apps/api/src/config/secrets.ts:51:  'JWT_REFRESH_SECRET',
apps/api/src/config/config.ts:19:  JWT_ACCESS_SECRET: z.string().min(32),
apps/api/src/config/config.ts:20:  JWT_REFRESH_SECRET: z.string().min(32),
apps/api/src/config/config.ts:114:    accessSecret: env.JWT_ACCESS_SECRET,
apps/api/src/config/config.ts:115:    refreshSecret: env.JWT_REFRESH_SECRET,

=== C.15 Redis subscribe / publish — unlimited channels? ===
apps/api/src/features/events/ssePublisher.ts:18:    await redis.publish(`clinic-events:${clinicId}`, JSON.stringify(event));
apps/api/src/features/events/ssePublisher.ts:27:    await redis.publish(`user-events:${userId}`, JSON.stringify(event));

=== C.16 audit_log unbounded? retention policy? ===

=== C.17 npm audit (JSON) ===
{
  "auditReportVersion": 2,
  "vulnerabilities": {
    "basic-ftp": {
      "name": "basic-ftp",
      "severity": "high",
      "isDirect": false,
      "via": [
        {
          "source": 1116454,
          "name": "basic-ftp",
          "dependency": "basic-ftp",
          "title": "basic-ftp: Incomplete CRLF Injection Protection Allows Arbitrary FTP Command Execution via Credentials and MKD Commands",
          "url": "https://github.com/advisories/GHSA-6v7q-wjvx-w8wg",
          "severity": "high",
          "cwe": [
            "CWE-93"
          ],
          "cvss": {
            "score": 8.2,
            "vectorString": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:L"
          },
          "range": "<=5.2.1"
        },
        {
          "source": 1116478,
          "name": "basic-ftp",
          "dependency": "basic-ftp",
          "title": "basic-ftp has FTP Command Injection via CRLF",
          "url": "https://github.com/advisories/GHSA-chqc-8p9q-pq6q",
          "severity": "high",
          "cwe": [
            "CWE-93"
          ],
          "cvss": {
            "score": 8.6,
            "vectorString": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:H/A:L"
          },
          "range": "=5.2.0"
        },
        {
          "source": 1116720,
          "name": "basic-ftp",
          "dependency": "basic-ftp",
          "title": "basic-ftp vulnerable to denial of service via unbounded memory consumption in Client.list()",
          "url": "https://github.com/advisories/GHSA-rp42-5vxx-qpwr",
          "severity": "high",
          "cwe": [
            "CWE-400",
            "CWE-770"
          ],
          "cvss": {
            "score": 7.5,
            "vectorString": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H"
          },
          "range": "<=5.2.2"
        }
      ],
      "effects": [],
      "range": "<=5.2.2",
      "nodes": [
        "node_modules/basic-ftp"
      ],
      "fixAvailable": true
    },
    "dompurify": {
      "name": "dompurify",
      "severity": "moderate",
      "isDirect": true,
      "via": [
        {
          "source": 1116663,
          "name": "dompurify",
          "dependency": "dompurify",
          "title": "DOMPurify's ADD_TAGS function form bypasses FORBID_TAGS due to short-circuit evaluation",
          "url": "https://github.com/advisories/GHSA-39q2-94rc-95cp",
          "severity": "moderate",
          "cwe": [
            "CWE-783"
          ],
          "cvss": {
            "score": 0,
            "vectorString": null
          },
          "range": "<=3.3.3"
        }
      ],
      "effects": [],
      "range": "<=3.3.3",
      "nodes": [
        "node_modules/dompurify"
      ],
      "fixAvailable": true
    },
    "nodemailer": {
      "name": "nodemailer",
      "severity": "moderate",
      "isDirect": true,
      "via": [
        {
          "source": 1116270,
          "name": "nodemailer",
          "dependency": "nodemailer",
          "title": "Nodemailer Vulnerable to SMTP Command Injection via CRLF in Transport name Option (EHLO/HELO) ",
          "url": "https://github.com/advisories/GHSA-vvjj-xcjg-gr5g",
          "severity": "moderate",
          "cwe": [
            "CWE-93"
          ],
          "cvss": {
            "score": 4.9,
            "vectorString": "CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:N/I:H/A:N"
          },
          "range": "<=8.0.4"
        }
      ],
      "effects": [],
      "range": "<=8.0.4",
      "nodes": [
        "node_modules/nodemailer"
      ],
      "fixAvailable": true
    },
    "pm2": {
      "name": "pm2",
      "severity": "low",
      "isDirect": true,
      "via": [
        {
          "source": 1112031,
          "name": "pm2",
          "dependency": "pm2",
          "title": "pm2 Regular Expression Denial of Service vulnerability",
          "url": "https://github.com/advisories/GHSA-x5gf-qvw8-r2rm",
          "severity": "low",
          "cwe": [
            "CWE-400",
            "CWE-1333"
          ],
          "cvss": {
            "score": 4.3,
            "vectorString": "CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:L"
          },
          "range": "<=6.0.14"
        }
      ],
      "effects": [],
      "range": "*",
      "nodes": [
        "node_modules/pm2"
      ],
      "fixAvailable": false
    },
    "protobufjs": {
      "name": "protobufjs",
      "severity": "critical",
      "isDirect": false,
      "via": [
        {
          "source": 1116832,
          "name": "protobufjs",
          "dependency": "protobufjs",
          "title": "Arbitrary code execution in protobufjs",
          "url": "https://github.com/advisories/GHSA-xq3m-2v4x-88gg",
          "severity": "critical",
          "cwe": [
            "CWE-94"
          ],
          "cvss": {
            "score": 0,
            "vectorString": null
          },
          "range": "<7.5.5"
        }
      ],
      "effects": [],
      "range": "<7.5.5",
      "nodes": [
        "node_modules/protobufjs"
      ],
      "fixAvailable": true
    }
  },
  "metadata": {
    "vulnerabilities": {
      "info": 0,
      "low": 1,
      "moderate": 2,
      "high": 1,
      "critical": 1,
      "total": 5
    },
    "dependencies": {
      "prod": 1057,
      "dev": 393,
      "optional": 127,
      "peer": 17,
      "peerOptional": 0,
      "total": 1532
    }

=== C.18 audit_log REVOKE check ===
     grantee     | privilege_type 
-----------------+----------------
 app_user        | DELETE
 app_user        | INSERT
 app_user        | SELECT
 app_user        | UPDATE
 signacare_owner | DELETE
 signacare_owner | INSERT
 signacare_owner | REFERENCES
 signacare_owner | SELECT
 signacare_owner | TRIGGER
 signacare_owner | TRUNCATE
 signacare_owner | UPDATE
(11 rows)


--- any trigger to prevent audit mutations? ---
 trigger_name | event_manipulation | action_timing 
--------------+--------------------+---------------
(0 rows)


=== C.19 soft-delete on not-soft-delete tables (WRONG usage) ===
contact_records: 3 co-occurrences of whereNull deleted_at within 10 lines
hotspots: 1 co-occurrences of whereNull deleted_at within 10 lines
messages: 2 co-occurrences of whereNull deleted_at within 10 lines
pathology_results: 1 co-occurrences of whereNull deleted_at within 10 lines
patient_alerts: 2 co-occurrences of whereNull deleted_at within 10 lines
patient_attachments: 0 co-occurrences of whereNull deleted_at within 10 lines
patient_legal_orders: 3 co-occurrences of whereNull deleted_at within 10 lines
patient_providers: 0 co-occurrences of whereNull deleted_at within 10 lines
structured_observations: 0 co-occurrences of whereNull deleted_at within 10 lines
treatment_pathways: 0 co-occurrences of whereNull deleted_at within 10 lines

=== C.20 JWT secret rotation mechanism? ===
apps/api/src/features/auth/authRepository.ts:26:   * refresh-token rotations — a reuse of any rotated token revokes
apps/api/src/features/auth/authRepository.ts:87:   * was rotated and is now being replayed" (stolen chain).
apps/api/src/features/auth/authService.ts:246:      // rotated), the token is being replayed. Revoke the entire
apps/api/src/features/auth/authService.ts:247:      // family so a stolen chain cannot keep rotating.
apps/api/src/features/auth/authService.ts:301:      // RFC 6819 §5.2.2.3: PROPAGATE the family_id from the rotated
apps/api/src/features/auth/breakGlassRoutes.ts:123:        text: `:rotating_light: BREAK-GLASS ${payload.event.toUpperCase()}`,
