# Signacare EMR — Improvement Roadmap

> Based on comprehensive architecture review. Prioritised by clinical impact, risk reduction, and engineering ROI.

---

## Executive Summary

The system is a strong enterprise foundation (~219K LoC, 123 tables, 373 API routes, 103 RLS policies). The analysis correctly identifies that **the next phase of value comes from hardening, not feature expansion**. This roadmap addresses all identified gaps across 6 phases.

---

## Phase 1: Runtime Isolation & Real-Time (Weeks 1-4)

**Goal**: Reduce blast radius, deliver real-time clinical alerts.

### 1.1 Domain Boundary Isolation
| Item | Current | Target | Effort |
|------|---------|--------|--------|
| LLM/Whisper isolation | Same Express process | Separate worker process via BullMQ | 3 days |
| Report generation | Synchronous HTTP (180s timeout) | BullMQ job with SSE progress | 2 days |
| AI clinical actions | 12 actions in HTTP cycle | Queue-based with retry + progress | 3 days |

**Implementation**:
```
Express API (Port 4000)
  → Fast routes: auth, patients, appointments, notes (< 200ms)

AI Worker (separate process)
  → BullMQ queue: llm-jobs
  → Processes: formulation, report-insight, handover-summary, etc.
  → Returns via: Redis pub/sub → SSE to frontend

Whisper Worker (separate process)
  → BullMQ queue: transcription-jobs
  → Returns via: Redis pub/sub → SSE to frontend
```

### 1.2 WebSocket / SSE for Real-Time
| Item | Current | Target |
|------|---------|--------|
| Dashboard KPIs | Polling every 2 min | SSE push on data change |
| Patient arrival notification | HTTP POST to notifications table | WebSocket push to clinician |
| Task assignment | Polling on page load | Real-time push |
| Pathology results | Polling | Push notification + badge |
| Medication due alerts | None | Scheduled push at due time |

**Implementation**: Add `EventSource` (SSE) endpoint at `/api/v1/events/stream` per authenticated user. Redis pub/sub channels per clinic_id.

### 1.3 AI Job Layer with Validation
```
Frontend → POST /api/v1/ai/jobs → { jobId }
  → BullMQ picks up job
  → Ollama generates response
  → Validation layer checks:
     - No hallucinated drug names (cross-ref drug_products table)
     - No impossible doses (> 10x standard)
     - ICD-10 codes are valid
     - No PII leakage from other patients
  → Human review checkpoint (draft status, clinician must approve)
  → Frontend polls GET /api/v1/ai/jobs/:id or receives SSE update
```

---

## Phase 2: Data Layer Hardening (Weeks 5-8)

### 2.1 Type-Safe Persistence
| Item | Current | Target |
|------|---------|--------|
| Query builder | Knex with manual snake_case mapping | Drizzle ORM with auto-mapping |
| Type safety | Manual `as any` casting in repositories | Generated types from schema |
| Migration tool | Raw SQL files | Drizzle Kit with push/pull |

**Migration strategy**: New modules use Drizzle; existing modules migrate incrementally. Both can coexist on the same PostgreSQL database.

### 2.2 Search Infrastructure
| Item | Current | Target |
|------|---------|--------|
| Patient search | `ILIKE '%name%'` on PostgreSQL | Full-text search with tsvector + trigram |
| Clinical search | None | Meilisearch for notes, formulations, letters |
| Fuzzy matching | None | pg_trgm extension for misspelled names |

**Implementation**:
```sql
-- Add to patients table
ALTER TABLE patients ADD COLUMN search_vector tsvector;
CREATE INDEX idx_patients_search ON patients USING gin(search_vector);

-- Trigger to auto-update
CREATE TRIGGER trg_patients_search BEFORE INSERT OR UPDATE ON patients
FOR EACH ROW EXECUTE FUNCTION
  tsvector_update_trigger(search_vector, 'pg_catalog.english', given_name, family_name, emr_number);
```

### 2.3 Audit Log Partitioning
```sql
-- Partition by month for write performance
CREATE TABLE audit_log_partitioned (LIKE audit_log INCLUDING ALL)
  PARTITION BY RANGE (created_at);

-- Create monthly partitions
CREATE TABLE audit_log_2026_03 PARTITION OF audit_log_partitioned
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');

-- Automated partition creation via pg_partman
```

### 2.4 Index Hygiene
```sql
-- Run monthly to find unused indexes
SELECT schemaname, relname, indexrelname, idx_scan
FROM pg_stat_user_indexes
WHERE idx_scan = 0 AND schemaname = 'public'
ORDER BY pg_relation_size(indexrelid) DESC;
```

---

## Phase 3: UX Hardening (Weeks 9-12)

### 3.1 High-Frequency Workflow Fixes
| Workflow | Issue | Fix |
|----------|-------|-----|
| Task assignment | Staff ID UUID input | Staff picker with search + avatar |
| Medication search | Free text | Drug database autocomplete with PBS codes |
| Referral assignment | Raw dropdown | Clinician picker showing caseload + availability |
| Episode allocation | Flat team list | Hierarchical tree picker |
| Correspondence | Manual letter typing | Template-driven with merge fields |

### 3.2 Tab Organisation
Current: 19 flat tabs across the top (horizontal scroll)
Proposed: Grouped into collapsible sections:

```
Clinical:     Summary | Episodes | Medications | Pathology | Assessments
Planning:     Alerts & Plans | Physical Health | Tracking
Legal:        Legal | Referrals | Correspondence
Inpatient:    Inpatient Care | ECT
Admin:        Documents | Appointments | Lived Experience | 91-Day | Pathways
```

### 3.3 WCAG 2.1 AA Compliance
| Item | Status | Required For |
|------|--------|-------------|
| Colour contrast ratios | Partial | Australian govt procurement |
| Keyboard navigation | Partial (tour has it) | Accessibility |
| Screen reader labels | Missing | Accessibility |
| Focus management | Missing | Accessibility |
| Touch targets (48px min) | Partial | Mobile/tablet use |

---

## Phase 4: Australian Integration Completion (Weeks 13-20)

### 4.1 Integration Priority Matrix
| Integration | Current State | Priority | Effort |
|-------------|--------------|----------|--------|
| **Medicare ECLIPSE** (bulk billing) | Not started | HIGH | 3 weeks |
| **SafeScript** (real-time S8 monitoring) | Stub only | HIGH | 2 weeks |
| **My Health Record** (ADHA FHIR Gateway) | Not started | HIGH | 4 weeks |
| **eRx** (electronic prescribing) | Stub only | MEDIUM | 3 weeks |
| **FHIR R4 expansion** | 4 resources | MEDIUM | 2 weeks |
| **NDIS Myplace Portal** | Not started | MEDIUM | 2 weeks |
| **Pathology HL7** | BullMQ workers built | LOW (existing) | 1 week polish |

### 4.2 FHIR R4 Resource Expansion
Current: Patient, Condition, MedicationStatement, AllergyIntolerance
Add: Encounter, Observation, DiagnosticReport, Practitioner, PractitionerRole, Organization, Location, ServiceRequest

### 4.3 Medicare Web Services
```
Patient → Appointment → Generate MBS Item (auto-suggest from duration + type)
  → Create Invoice → Submit via Medicare ECLIPSE
  → Receive payment → Reconcile
```

---

## Phase 5: Security & Compliance Hardening (Weeks 21-24)

### 5.1 Superadmin Controls
| Item | Current | Target |
|------|---------|--------|
| Destructive actions | Single superadmin approval | 4-eyes principle (two superadmins) |
| Break-glass access | Not implemented | Time-limited emergency access with mandatory audit review |
| Permission changes | Immediate | Approval workflow with notification |

### 5.2 Encryption at Rest
| Layer | Current | Target |
|-------|---------|--------|
| PII fields | pgcrypto per-column | Maintain |
| Full database | Not encrypted | PostgreSQL TDE or disk-level encryption |
| Backups | Not encrypted | gpg-encrypted backup files |
| Redis | Not encrypted | Redis TLS + at-rest encryption |

### 5.3 Automated Security Testing
```yaml
# CI/CD pipeline addition
security-scan:
  - npm audit --production
  - OWASP ZAP baseline scan against staging
  - Snyk container scan
  - pg_audit log review for privilege escalation
```

### 5.4 Backup Verification
```bash
# Weekly automated restore test
pg_dump signacaredb | pg_restore -d signacaredb_verify
psql signacaredb_verify -c "SELECT count(*) FROM patients"  # Verify data
psql signacaredb_verify -c "DROP DATABASE signacaredb_verify"
```

---

## Phase 6: Scale & Performance (Weeks 25-30)

### 6.1 Auto-Scaling
| Component | Current | Target |
|-----------|---------|--------|
| API | Fixed PM2 cluster (4 workers) | K8s HPA or PM2 with memory-triggered scaling |
| Ollama | Single GPU server | Queue-based dispatcher across 2+ GPU nodes |
| Redis | Single instance | Redis Sentinel (3 nodes) for HA |
| PostgreSQL | Single primary | Primary + read replica + PgBouncer |

### 6.2 Lite Edition
```
Full Edition: llama3.2 (2GB) + qwen2.5:14b (9GB) + Whisper large-v3-turbo (1.6GB) = ~15GB
Lite Edition: llama3.2:Q4 (1.2GB) + Whisper small (500MB) = ~2GB
```

### 6.3 Reporting Semantic Layer
```
Raw Tables → Materialised Views (nightly refresh) → Report API → Dashboard/Builder

CREATE MATERIALIZED VIEW mv_daily_metrics AS
SELECT date_trunc('day', created_at) as metric_date,
       clinic_id,
       count(*) FILTER (WHERE table_name = 'appointments') as appointments,
       count(*) FILTER (WHERE table_name = 'clinical_notes' AND is_signed) as signed_notes,
       ...
FROM audit_log
GROUP BY 1, 2;
```

### 6.4 Request Batching (Frontend)
```typescript
// Current: 19 tabs = potentially 19 API calls per patient
// Target: Single batch endpoint
const patientData = await apiClient.get(`patients/${id}/batch`, {
  include: ['summary', 'episodes', 'medications', 'alerts']
});
```

---

## Priority Summary

| Phase | Timeframe | Key Deliverable | Risk Reduced |
|-------|-----------|----------------|-------------|
| 1 | Weeks 1-4 | AI isolation + real-time alerts | Process crashes, stale alerts |
| 2 | Weeks 5-8 | Type-safe DB + search + audit partitioning | Data bugs, search scale, write bottleneck |
| 3 | Weeks 9-12 | UX hardening + accessibility | Clinical errors, adoption friction |
| 4 | Weeks 13-20 | Medicare, SafeScript, MHR integration | Enterprise viability |
| 5 | Weeks 21-24 | Security hardening + backup verification | Compliance, data loss |
| 6 | Weeks 25-30 | Auto-scaling + lite edition | Scale ceiling, onboarding friction |

---

## What NOT to Do Next

1. **Don't add more patient tabs** — 19 is already at the cognitive overload boundary
2. **Don't add more API endpoints** — 373 routes need consolidation, not expansion
3. **Don't build mobile app yet** — the web app needs responsive hardening first
4. **Don't switch to microservices** — modular monolith with worker isolation is the right intermediate step
5. **Don't build custom charting** — adopt a library (Recharts, Nivo) when CSS charts hit limits

---

## Target Architecture (6-Month Vision)

```
                        ┌─────────────┐
                        │   Nginx     │
                        │   (SSL)     │
                        └──────┬──────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
      ┌───────▼──────┐ ┌──────▼──────┐ ┌───────▼──────┐
      │  Static SPA  │ │  API Server │ │  SSE/WS      │
      │  (React)     │ │  (Express)  │ │  (real-time) │
      └──────────────┘ └──────┬──────┘ └───────┬──────┘
                              │                │
                    ┌─────────┼─────────┐      │
                    │         │         │      │
              ┌─────▼───┐ ┌──▼──┐ ┌────▼──┐   │
              │ PgBounce│ │Redis│ │BullMQ │◄──┘
              │ r → PG  │ │     │ │Workers│
              └─────────┘ └─────┘ └───┬───┘
                                      │
                            ┌─────────┼─────────┐
                            │         │         │
                      ┌─────▼───┐ ┌───▼───┐ ┌───▼────┐
                      │ Ollama  │ │Whisper│ │ HL7    │
                      │ (GPU)   │ │       │ │ Worker │
                      └─────────┘ └───────┘ └────────┘
```
