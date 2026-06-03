# Signacare EMR - Database Schema

## Overview

- **Engine**: PostgreSQL 16
- **Tables**: 123 base tables + 29 backward-compatibility views
- **Foreign Keys**: 406
- **RLS Policies**: 103 (tenant isolation on all clinic-scoped tables)
- **Audit Triggers**: 327 (INSERT/UPDATE/DELETE logging on 95+ tables)
- **Auto-Timestamp Triggers**: 189 (updated_at set automatically)
- **Indexes**: 472 (including 103 clinic_id + 38 soft-delete partial indexes)

## Core Tables

### Tenancy
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `clinics` | Multi-tenant root | id, name, abn, address |
| `subscriptions` | SaaS subscription | clinic_id, plan, status, expires_at |
| `subscriber_branding` | White-label branding | clinic_id, sidebar_title, logo_url |

### Staff & Authentication
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `staff` | All users | id, clinic_id, given_name, family_name, email, role, prescriber_number, is_active |
| `staff_sessions` | Active sessions | staff_id, token_hash, expires_at, ip_address |
| `mfa_secrets` | TOTP secrets | staff_id, secret, is_verified |
| `permissions` | Permission definitions | name, description |
| `staff_permissions` | Staff-permission mapping | staff_id, permission_id |
| `staff_team_assignments` | Staff to team mapping | staff_id, org_unit_id, start_date, end_date, is_active |
| `staff_role_assignments` | Staff clinical roles | staff_id, org_unit_id, clinical_role_id, role_type, start_date |
| `staff_settings` | Per-user preferences | staff_id, key, value |
| `staff_module_access` | Module access control | staff_id, module, granted_by_id |
| `staff_leave` | Leave calendar | staff_id, leave_type, start_date, end_date, status |

### Organisational Structure
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `org_units` | Hierarchical teams | id, clinic_id, parent_id, name, level, is_active |
| `org_level_labels` | Level naming | clinic_id, level, label |
| `org_unit_programs` | Programs per unit | org_unit_id, program_id |
| `programs` | Clinical programs | clinic_id, name, description |
| `professional_disciplines` | Discipline types | name, sort_order |
| `clinical_roles` | Role types | name, sort_order |

### Patients
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `patients` | Core patient record | id, clinic_id, given_name, family_name, date_of_birth, gender, emr_number, medicare_number, status, photo_url |
| `patient_contacts` | Next of kin, carers | patient_id, contact_type, name, phone, relationship |
| `patient_providers` | GP, specialists | patient_id, provider_type, name, phone |
| `patient_flags` | Clinical flags | patient_id, flag_type, description, severity |
| `patient_alerts` | Active alerts | patient_id, alert_type_id, description, severity |
| `patient_allergies` | Allergy record | patient_id, allergen, reaction, severity |
| `patient_team_assignments` | Team allocation | patient_id, org_unit_id, primary_clinician_id |
| `patient_attachments` | File uploads | patient_id, file_name, file_path, category |
| `carers` | Carer registry | patient_id, name, relationship, phone |

### Clinical
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `episodes` | Care episodes | patient_id, episode_type, status, start_date, end_date, team_id, primary_clinician_id |
| `episode_types` | Episode type definitions | name, is_active |
| `clinical_notes` | Progress notes | patient_id, episode_id, author_id, note_type, content, is_signed, signed_at |
| `clinical_templates` | Note templates | name, category_id, content (JSON fields) |
| `template_sections` | Template field definitions | template_id, field_type, label |
| `template_categories` | Template grouping | name, sort_order |
| `diagnoses` | ICD-10/11 diagnoses | patient_id, episode_id, code, description, type |
| `risk_assessments` | Risk assessment records | patient_id, risk_level, assessment_data |
| `safety_plans` | Safety plans | patient_id, plan_data |
| `clinical_formulations` | 5P formulations | patient_id, formulation_type, presenting_problem, predisposing/precipitating/perpetuating/protective_factors |
| `contact_records` | Contact form entries | patient_id, episode_id, contact_type, duration |

### Medications
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `patient_medications` | Active prescriptions | patient_id, drug_label, dose, frequency, route, status, prescribed_by_staff_id |
| `prescriptions` | Prescription history | patient_id, medication_id, prescribed_by_staff_id |
| `medication_administrations` | MAR records | patient_medication_id, scheduled_time, administered_time, status, dose_given, administration_context |
| `drug_products` | Drug database | name, generic_name, form, strength |
| `side_effect_schedules` | Monitoring schedules | patient_id, patient_medication_id, schedule_type, frequency_weeks, next_due_date |

### LAI & Clozapine
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `lai_schedules` | LAI schedule | patient_id, drug_name, dose_mg, frequency_days, next_due_date |
| `lai_given` | LAI administration | schedule_id, administered_by_staff_id, injection_site |
| `aims_assessments` | AIMS monitoring | patient_id, total_score, assessed_by_staff_id |
| `clozapine_registrations` | Clozapine registry | patient_id, status, monitoring_frequency, current_dose |
| `clozapine_blood_results` | Blood monitoring | patient_id, wcc, anc, result_date |

### Appointments
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `appointments` | Scheduling | patient_id, clinician_id, start_time, end_time, status, type, check_in_time |
| `appointment_modes` | Appointment type definitions | name |
| `waitlist_entries` | Waitlist | patient_id, priority, status, reason |

### Mental Health Act
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `legal_orders` | MHA orders | patient_id, order_type, status, start_date, expiry_date |
| `legal_order_types` | Order type definitions | name, jurisdiction |
| `legal_order_type_configs` | Type configuration | order_type_id, config_json |
| `patient_legal_orders` | Patient-order mapping | patient_id, order_type_id, entered_by_id |
| `mha_reviews` | Tribunal reviews | order_id, review_date, outcome, reviewed_by_id |

### Referrals
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `referrals` | Referral records | patient_id, source, status, urgency, assigned_to_id |
| `referral_sources` | Source definitions | name, category |
| `referral_attachments` | Referral documents | referral_id, file_name |
| `referral_workflow_events` | Status transitions | referral_id, from_status, to_status, staff_id |
| `ereferrals` | Electronic referrals | referral_id, hl7_message |

### Assessments & Outcomes
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `assessment_responses` | Template-based assessments | patient_id, template_id, responses_json |
| `outcome_measures` | Outcome scores | patient_id, measure_type, total_score, occasion |
| `nursing_assessments` | Nursing + ECT assessments | patient_id, assessment_type, assessment_data, total_score, score_band |
| `structured_observations` | Inpatient observations | patient_id, observation_level, observation_time, mood, behaviour |
| `engagement_scores` | Patient engagement | patient_id, score, period |

### Inpatient
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `beds` | Bed register | clinic_id, ward, bed_number, status |
| `bed_movements` | Bed allocation | patient_id, bed_id, admission_date, discharge_date |
| `shift_handovers` | Shift handover | shift_type, shift_date, outgoing/incoming_staff_id, patient_updates, status |
| `restrictive_interventions` | Seclusion/restraint | patient_id, intervention_type, start_time, end_time |

### Care Planning
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `treatment_plans` | Treatment plans | patient_id, episode_id, staff_id, status |
| `care_plan_goals` | Recovery goals | treatment_plan_id, goal_text, goal_type, status, target_date |
| `care_plan_interventions` | Goal interventions | care_plan_goal_id, intervention_text, frequency, responsible_staff_id |
| `review_plans` | Review scheduling | patient_id, next_review_date |
| `treatment_pathways` | Clinical pathways | patient_id, pathway_type |
| `planned_transitions` | Discharge planning | patient_id, transition_type, target_date |
| `advance_directives` | Advance care directives | patient_id, directive_type, content |

### Communication
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `message_threads` | Messaging threads | clinic_id, subject |
| `messages` | Individual messages | thread_id, sender_id, content |
| `message_thread_participants` | Thread members | thread_id, staff_id |
| `notifications` | Push notifications | recipient_staff_id, type, title, body, is_read |
| `correspondence_letters` | Generated letters | patient_id, template_id, content, status |

### Billing
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `invoices` | Patient invoices | patient_id, clinician_id, total_amount, status |
| `invoice_line_items` | Line items | invoice_id, description, amount, mbs_item |
| `payments` | Payment records | invoice_id, amount, payment_method |
| `billing_accounts` | Billing accounts | patient_id, account_type |

### Reception
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `phone_triage` | Phone call records | caller_name, patient_id, urgency, reason_for_call, assigned_to_id, status |
| `sms_campaigns` | SMS campaign records | campaign_type, target_date, message_template, status |
| `sms_campaign_recipients` | Campaign recipients | campaign_id, patient_id, appointment_id |

### Reporting
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `report_schedules` | Scheduled reports | report_type, schedule_cron, format, recipients, is_active |
| `report_runs` | Execution history | schedule_id, run_at, status |

### Community
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `community_resources` | Resource directory | name, category, phone, address, referral_process |

### AI & Integration
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `llm_interactions` | AI usage audit | patient_id, action, model, prompt_tokens, completion_tokens |
| `ai_training_feedback` | AI feedback | interaction_id, staff_id, rating, feedback |
| `voice_calls` | Voice integration | patient_id, call_type, duration |
| `voice_patient_preferences` | Patient voice prefs | patient_id, preferred_language |
| `voice_scripts` | Call scripts | name, content |
| `erx_tokens` | e-Prescribing tokens | patient_id, token, status |

### Security & Compliance
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `audit_log` | Full audit trail | user_id, action, table_name, record_id, old_data, new_data |
| `consent_records` | Patient consent | patient_id, consent_type, status, date |
| `data_breach_log` | Breach register | description, severity, reported_by_id |
| `data_retention_policies` | Retention rules | table_name, retention_days |
| `role_access_policies` | Custom access rules | role, resource, action |

## Entity Relationships

```
clinics ──< staff ──< staff_team_assignments >── org_units
   |          |                                      |
   |          └──< staff_role_assignments >── clinical_roles
   |
   └──< patients ──< episodes ──< clinical_notes
          |    |         |              |
          |    |         └──< treatment_plans ──< care_plan_goals
          |    |
          |    └──< patient_medications ──< medication_administrations
          |    |
          |    └──< appointments
          |    |
          |    └──< referrals
          |    |
          |    └──< nursing_assessments (NEWS2, ECT, outcomes, etc.)
          |    |
          |    └──< structured_observations
          |
          └──< patient_team_assignments >── org_units
```

## Naming Conventions
- All tables: `snake_case`
- All columns: `snake_case`
- Primary keys: `id` (UUID v4)
- Foreign keys: `{table_name}_id` or `{role}_id` (e.g. `author_id`, `clinician_id`)
- Timestamps: `created_at`, `updated_at`, `deleted_at` (soft delete)
- Booleans: `is_active`, `is_signed`, `is_read`
- Status enums: stored as `varchar` with CHECK constraints
