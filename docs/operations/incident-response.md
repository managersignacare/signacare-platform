# Incident Response Plan
## Signacare EMR — Information Security Incident Management

**Organisation:** Signacare Health Technologies Pty Ltd
**Version:** 1.1
**Date:** 30 March 2026 (initial) · **Refreshed:** 2026-05-29 (May-2026 closure-wave deltas: PHI keyring rotation, FORCE RLS verification, worker observability, scribe consent re-check, env-contract guard)
**Review Frequency:** Annually or after any incident

---

## 1. Scope

This plan covers all security incidents affecting Signacare EMR, including:
- Unauthorised access to patient records
- Data breaches (confirmed or suspected)
- System compromise (malware, ransomware, account takeover)
- Service disruption affecting clinical operations
- Insider threat / misuse of access privileges

---

## 2. Incident Severity Classification

| Level | Description | Examples | Response Time |
|---|---|---|---|
| **P1 — Critical** | Active data breach, system compromise, patient safety impact | DB exfiltration, ransomware, PHI exposed publicly | Immediate (< 1 hour) |
| **P2 — High** | Suspected breach, significant vulnerability, clinical workflow blocked | Unauthorised access detected in audit log, login from unusual location | < 4 hours |
| **P3 — Medium** | Contained issue, no data exposure, degraded service | Rate limit triggered excessively, failed login spike, single component down | < 24 hours |
| **P4 — Low** | Minor issue, no patient data impact | UI bug, slow performance, non-critical service error | Next business day |

---

## 3. Incident Response Team

| Role | Responsibility | Escalation |
|---|---|---|
| **Incident Commander** | Leads response, makes containment decisions | CTO → CEO |
| **Technical Lead** | Investigates root cause, implements containment | Senior Developer |
| **Clinical Lead** | Assesses patient safety impact, clinical workaround | Chief Medical Officer |
| **Privacy Officer** | OAIC notification, patient notification, legal | Legal Counsel |
| **Communications** | Staff/patient/media communication | CEO / Marketing |

---

## 4. Response Phases

### Phase 1: Detection & Triage (0-30 minutes)
1. Incident reported via: Sentry alert, staff report, audit log anomaly, external report
2. Incident Commander activates response team
3. Classify severity (P1-P4)
4. Create incident ticket with timestamp
5. Preserve evidence: screenshots, log exports, DB snapshots

### Phase 2: Containment (30 minutes - 4 hours)
**Immediate containment options:**
- Revoke compromised user sessions: `UPDATE staff_sessions SET revoked_at = NOW() WHERE staff_id = ?`
- Lock compromised account: `UPDATE staff SET locked_until = NOW() + interval '24 hours' WHERE id = ?`
- Block IP address: Add to `IP_ALLOWLIST` deny list in environment
- Disable affected API routes: Feature flag or route comment-out + restart
- Isolate affected database: Revoke `app_user` permissions on affected tables
- Full system lockdown: Set `MAINTENANCE_MODE=true` → returns 503 to all non-health endpoints
- **PHI keyring emergency rotation** (BUG-ARCH-PHI-KEY-ROTATION): rotate active version of `PHI_ENCRYPTION_KEYRING_JSON`; old key retained read-only for in-flight decryption; see `docs/operations/runbooks/key-rotation.md`
- **Scribe consent emergency revoke**: `UPDATE scribe_consent SET state='revoked', revoked_at=NOW() WHERE clinic_id=?` — BUG-WF51-CONSENT-REVOKE-RACE re-check at post-upload + post-processing will fail-closed
- **Worker queue pause**: BullMQ `queue.pause()` for affected queues; DLQ retention enabled per BUG-SA-008 worker failure observability baseline
- **FORCE RLS verification**: `SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname IN ('signacare_owner', 'app_user');` — verify `rolbypassrls=false` per BUG-ARCH-FORCE-RLS-BASELINE

**Data preservation:**
- Export audit_log for affected timeframe
- Take database snapshot (pg_dump)
- Preserve application logs (copy from PM2 log directory)
- Export Redis keys related to affected sessions
- **Export llm_interactions for forensic replay** (immutable per `llm_interactions` schema; includes prompt template + redacted input + model version + response-guard verdict)
- **Snapshot clinical_notes signed_content_hash column** for tamper-detection comparison (BUG-ARCH-CLINICAL-NOTE-SIGNATURE-HASH)
- **Capture worker DLQ contents**: `redis-cli zcard bull:<queue>:failed` + DLQ contents for forensic timeline

### Phase 3: Eradication (4-24 hours)
1. Identify root cause (code vulnerability, credential compromise, misconfiguration)
2. Develop and test fix in staging environment
3. Deploy fix via standard CI/CD pipeline
4. Verify fix with targeted testing
5. Re-enable containment measures one at a time

### Phase 4: Recovery (24-72 hours)
1. Restore normal operations
2. Monitor for recurrence (enhanced logging for 7 days)
3. Verify data integrity (backup comparison)
4. Reset affected credentials (passwords, API keys, JWT secrets)
5. Clear and re-establish sessions

### Phase 5: Notification (within 30 days per NDB scheme)
**If eligible data breach confirmed (Australian Notifiable Data Breaches scheme):**

1. **OAIC notification** (within 30 days of awareness):
   - Nature of breach
   - Type of PI affected
   - Number of individuals affected
   - Recommendations for individuals
   - Contact information

2. **Affected individuals notification:**
   - What happened (plain language)
   - What information was involved
   - What we are doing about it
   - What they should do (change passwords, monitor Medicare)
   - How to contact us

3. **Record in system:**
   - Log via `POST /api/v1/privacy/breach-log`
   - Severity, affected_records, containment_actions, notifications_sent

### Phase 6: Post-Incident Review (within 7 days)
1. Conduct blameless post-mortem
2. Document timeline, root cause, impact, response effectiveness
3. Identify improvements to prevent recurrence
4. Update this plan if gaps identified
5. Report findings to board/governance committee
6. Schedule follow-up review at 30 days

---

## 5. Technical Runbooks

### 5.1 Compromised Staff Account
```bash
# 1. Lock the account immediately
PGPASSWORD=<pw> psql -h <host> -U signacare_owner -d signacaredb -c \
  "UPDATE staff SET locked_until = NOW() + interval '30 days', is_active = false WHERE id = '<staff_id>';"

# 2. Revoke all sessions
PGPASSWORD=<pw> psql -h <host> -U signacare_owner -d signacaredb -c \
  "UPDATE staff_sessions SET revoked_at = NOW() WHERE staff_id = '<staff_id>' AND revoked_at IS NULL;"

# 3. Export access audit for this user
PGPASSWORD=<pw> psql -h <host> -U signacare_owner -d signacaredb -c \
  "COPY (SELECT * FROM audit_log WHERE user_id = '<staff_id>' ORDER BY created_at DESC LIMIT 1000) TO '/tmp/audit_export.csv' CSV HEADER;"
```

### 5.2 Suspected Data Exfiltration
```bash
# 1. Check for unusual query patterns
PGPASSWORD=<pw> psql -h <host> -U signacare_owner -d signacaredb -c \
  "SELECT user_id, COUNT(*), MAX(created_at) FROM audit_log WHERE created_at > NOW() - interval '24 hours' GROUP BY user_id ORDER BY count DESC;"

# 2. Check for bulk data access
PGPASSWORD=<pw> psql -h <host> -U signacare_owner -d signacaredb -c \
  "SELECT * FROM audit_log WHERE action = 'READ' AND created_at > NOW() - interval '1 hour' ORDER BY created_at DESC LIMIT 100;"

# 3. Snapshot database for forensics
pg_dump -Fc -h <host> -U signacare_owner signacaredb > /secure/forensics/db_snapshot_$(date +%Y%m%d_%H%M%S).dump
```

### 5.3 System-Wide Lockdown
```bash
# Set maintenance mode (API returns 503 to all non-health endpoints)
# Add to .env: MAINTENANCE_MODE=true
# Restart API: pm2 restart signacare-api
```

---

## 6. Contact Information

| Contact | Phone | Email |
|---|---|---|
| Incident Commander (CTO) | [TBD] | [TBD] |
| Privacy Officer | [TBD] | privacy@[domain] |
| OAIC | 1300 363 992 | enquiries@oaic.gov.au |
| Australian Cyber Security Centre | 1300 CYBER1 | asd.assist@defence.gov.au |
| Cyber insurance provider | [TBD] | [TBD] |

## 6.1 Related runbooks + governance docs

- [`docs/operations/disaster-recovery.md`](disaster-recovery.md) — Backup + restore scenarios A/B/C/D
- [`docs/operations/runbooks/key-rotation.md`](runbooks/key-rotation.md) — PHI keyring rotation
- [`docs/operations/runbooks/on-call.md`](runbooks/on-call.md) — On-call rotation + escalation
- [`docs/operations/env-contract-catalog.md`](env-contract-catalog.md) — Env-contract SSoT
- [`docs/gold-standard/security-features.md`](../gold-standard/security-features.md) — Full control inventory
- [`docs/compliance/threat-manual.md`](../compliance/threat-manual.md) — STRIDE threat model
- [`docs/quality/bugs-remaining.md`](../quality/bugs-remaining.md) — Live BUG ledger (S0 closure status)

---

## 7. Document Control

| Version | Date | Author | Changes |
|---|---|---|---|
| 1.0 | 30 Mar 2026 | CTO | Initial version |
| 1.1 | 29 May 2026 | Claude refresh | May-2026 closure-wave deltas: PHI keyring rotation in Phase 2, scribe consent emergency revoke, worker queue pause + DLQ retention, FORCE RLS verification, env-contract guard verification post-restore. New §6.1 related runbooks + governance cross-links. Forensic preservation extended with `llm_interactions` + signature hash + DLQ contents. |

**Next Review:** 30 September 2026
