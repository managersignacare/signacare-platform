# Signacare EMR — Disaster Recovery Runbook

**Last refreshed:** 2026-05-29 (refresh — adds PHI keyring rotation cross-link, FORCE RLS recovery posture, env-contract catalog reference, worker tenant-context recovery, and Layer 0a discipline integration).

## 1. Backup Strategy

### Automated Daily Backups
- **Schedule**: Daily at 2:00 AM AEDT
- **Location**: `~/signacare/data/backups/`
- **Format**: Compressed SQL (`signacaredb_YYYYMMDD_HHMMSS.sql.gz`)
- **Retention**: 30 days rolling
- **Agent**: macOS LaunchAgent `com.signacare.backup`

### Manual Backup
```bash
pg_dump -U signacare_owner signacaredb | gzip > backup_$(date +%Y%m%d_%H%M%S).sql.gz
```

### Verify Backup Integrity
```bash
gunzip -c backup_file.sql.gz | head -5  # Should show SQL header
gunzip -c backup_file.sql.gz | tail -5  # Should show completion notice
```

---

## 2. Recovery Procedures

### Scenario A: Database Corruption
```bash
# 1. Stop services
~/signacare/stop.sh

# 2. Drop and recreate database
dropdb signacaredb
createdb signacaredb -O signacare_owner

# 3. Restore from latest backup
gunzip -c ~/signacare/data/backups/signacaredb_LATEST.sql.gz | psql -U signacare_owner signacaredb

# 4. Restart services
~/signacare/start.sh
```

### Scenario B: Application Failure
```bash
# 1. Check logs
tail -100 ~/signacare/logs/launchd.log

# 2. Restart services
~/signacare/stop.sh
~/signacare/start.sh

# 3. If app code is corrupted, reinstall from DMG
# Keep database — only replace app files
rm -rf ~/signacare/app
# Drag Signacare EMR.app to Applications again
# Open app — it will copy fresh files but keep DB
```

### Scenario C: Complete Machine Loss
```bash
# 1. Install on new machine
# - Install the .dmg
# - Open Signacare EMR from Applications
# - Wait for first-run setup to complete

# 2. Restore database from offsite backup
scp user@backup-server:/backups/signacaredb_latest.sql.gz .
gunzip -c signacaredb_latest.sql.gz | psql -U signacare_owner signacaredb

# 3. Restore uploads
scp -r user@backup-server:/backups/uploads/ ~/signacare/app/apps/api/uploads/

# 4. Activate license
# Upload the license .json file via Settings > License
```

### Scenario D: Ransomware/Security Breach
```bash
# 1. IMMEDIATELY disconnect from network
# 2. Do NOT pay ransom
# 3. Document the incident:
#    - Time of detection
#    - What systems are affected
#    - What data may be compromised

# 4. Log the breach via API (if accessible):
curl -X POST http://localhost:4000/api/v1/privacy/breaches \
  -H 'Content-Type: application/json' \
  -d '{"breachType":"ransomware","severity":"critical","description":"..."}'

# 5. Notify OAIC within 30 days (Notifiable Data Breaches scheme)
#    https://www.oaic.gov.au/privacy/notifiable-data-breaches

# 6. Restore from clean backup (pre-breach)
# 7. Change all passwords
# 8. Rotate JWT secrets in .env
# 9. Revoke all sessions

# 10. PHI keyring rotation (BUG-ARCH-PHI-KEY-ROTATION) — versioned PHI keyring
#     supports zero-downtime rotation. See docs/operations/runbooks/key-rotation.md
#     - Update PHI_ENCRYPTION_KEYRING_JSON with new key version + retire old
#     - Verify active key version via /health endpoint
#     - Background job re-encrypts at-rest PHI using new active key

# 11. Verify FORCE RLS posture (BUG-ARCH-FORCE-RLS-BASELINE) on restored DB:
#     ALTER ROLE signacare_owner NOBYPASSRLS;
#     SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname IN ('signacare_owner', 'app_user');

# 12. Verify env-contract catalog (docs/operations/env-contract-catalog.md):
#     npm run guard:env-template-contract  # must PASS post-restore

# 13. Verify clinical-note signature hash integrity:
#     SELECT id FROM clinical_notes WHERE signed_at IS NOT NULL AND
#       compute_note_hash(content) != signed_content_hash;
#     -- Any row returned indicates a tamper event during the breach window
```

---

## 3. RPO and RTO

| Metric | Target | Current |
|--------|--------|---------|
| **RPO** (Recovery Point Objective) | 24 hours | 24 hours (daily backups) |
| **RTO** (Recovery Time Objective) | 4 hours | ~30 minutes (local restore) |

To improve RPO to near-zero:
- Enable PostgreSQL WAL archiving for point-in-time recovery
- Stream WAL files to S3/offsite storage

---

## 4. Contact Information

| Role | Contact |
|------|---------|
| System Admin | admin@signacare.net |
| Database Admin | Same |
| Security Officer | Same |
| OAIC (breach notification) | https://www.oaic.gov.au |
| Signacare Support | support@signacare.net |

---

## 5. Testing Schedule

| Test | Frequency | Last Tested |
|------|-----------|-------------|
| Backup restore | Monthly | — |
| Failover to new machine | Quarterly | — |
| Security incident response | Annually | — |
| Full DR simulation | Annually | — |

---

## 6. Checklist After Recovery

- [ ] All services running (`~/signacare/start.sh`)
- [ ] Login works for all staff accounts
- [ ] Patient data visible and correct
- [ ] AI Scribe functional (Whisper + Ollama)
- [ ] Appointments calendar correct
- [ ] License activated
- [ ] Automated backups re-enabled
- [ ] Audit log recording new entries
- [ ] TLS certificates valid
- [ ] **PHI keyring active version verified** (BUG-ARCH-PHI-KEY-ROTATION)
- [ ] **FORCE RLS posture verified** — `ALTER ROLE` NOBYPASSRLS applied on owner role (BUG-ARCH-FORCE-RLS-BASELINE)
- [ ] **Env-contract catalog guard passes** — `npm run guard:env-template-contract` PASS (BUG-INFRA-ENV-CONTRACT-GAP)
- [ ] **Clinical-note signature hash integrity** — no rows where `compute_note_hash(content) != signed_content_hash` (BUG-ARCH-CLINICAL-NOTE-SIGNATURE-HASH)
- [ ] **Worker tenant-context drain** — re-process previously-failed patient-outreach jobs with `withTenantContext` (BUG-WF42-OUTREACH-WORKER-RLS-CONTEXT)
- [ ] **Email worker non-stub verified** — `bull:email:delayed` not silently accumulating (BUG-WF42-EMAIL-WORKER-STUB)
- [ ] **Worker failure observability** — DLQ retention enabled, failure handlers registered (BUG-SA-008)
- [ ] **Scribe consent state** — verify any in-flight ambient-note sessions re-check consent (BUG-WF51-CONSENT-REVOKE-RACE)

## 7. Related runbooks

- [`docs/operations/runbooks/backup-restore-drill.md`](runbooks/backup-restore-drill.md) — monthly restore drill procedure
- [`docs/operations/runbooks/key-rotation.md`](runbooks/key-rotation.md) — PHI keyring rotation procedure
- [`docs/operations/runbooks/on-call.md`](runbooks/on-call.md) — on-call rotation + escalation
- [`docs/operations/runbooks/retention-production-enablement.md`](runbooks/retention-production-enablement.md) — triple-lock production retention gates
- [`docs/operations/env-contract-catalog.md`](env-contract-catalog.md) — env-contract SSoT (197 keys, 5 templates)
- [`docs/operations/incident-response.md`](incident-response.md) — security incident response plan
