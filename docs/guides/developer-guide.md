# Signacare EMR — Developer & Maintenance Guide (v2)

> Last updated: 2026-03-28

## 1. Development Setup

### Prerequisites
```bash
brew install node@20 postgresql@16 redis python@3.11 ollama
pip3 install faster-whisper flask
npm install -g tsx
```

### Quick Start
```bash
cd ~/Projects/Signacare
npm install --legacy-peer-deps

# Start services
brew services start postgresql@16 && brew services start redis
ollama serve &

# Terminal 1: API
cd apps/api && npx tsx -r dotenv/config src/server.ts

# Terminal 2: Frontend
cd apps/web && npx vite --host
```

### Startup Logs to Verify
```
Redis ping OK
Database connection OK
Dev rate limits flushed on startup
AI job worker started (concurrency: 2)
Signacare API started
```

### Environment Variables (apps/api/.env)
```env
NODE_ENV=development
PORT=4000
DB_HOST=localhost
DB_PORT=5432
DB_USER=signacare_owner
DB_PASSWORD=<password>
DB_NAME=signacaredb
DB_APP_USER=app_user
DB_APP_PASSWORD=<password>
JWT_ACCESS_SECRET=<32+ chars>
JWT_REFRESH_SECRET=<32+ chars>
REDIS_URL=redis://localhost:6379
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2
```

### Frontend Proxy
Vite proxies `/api` → `localhost:4000`. Frontend `.env` uses `VITE_API_URL=/api/v1` (relative).

## 2. Project Structure

```
Signacare/
  apps/
    api/src/
      config/           config.ts (Zod), redis.ts (4 DBs)
      db/               db.ts (Knex + pool monitoring), migrations/
      features/         20+ domain modules
      jobs/workers/     aiWorker, hl7Worker, mhExpiryWorker
      middleware/       auth, rbac, superadminGuard, rateLimit, error
      integrations/     fhir/, escript/, pathology/, nhsd/
      mcp/              localLlmAgent, scribeStreaming
      server.ts         Main entry
    web/src/
      features/         20+ feature modules
      shared/           Components, hooks, stores, services
      router.tsx        All routes
  packages/shared/      Shared Zod schemas + types
  deploy/               Nginx, PM2, PgBouncer, backup configs
  installer/            macOS .app builder, first-run setup
  docs/                 All documentation
```

## 3. Adding Features

### New Database Table
```sql
CREATE TABLE my_feature (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id),
  patient_id UUID REFERENCES patients(id),
  -- columns
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- Always add these 4 things:
ALTER TABLE my_feature ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_my_feature ON my_feature FOR ALL
  USING (clinic_id = current_setting('app.clinic_id', true)::uuid);

CREATE TRIGGER trg_my_feature_audit AFTER INSERT OR UPDATE OR DELETE ON my_feature
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER trg_my_feature_updated_at BEFORE UPDATE ON my_feature
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_my_feature_clinic_id ON my_feature(clinic_id);
CREATE INDEX idx_my_feature_deleted_at ON my_feature(deleted_at) WHERE deleted_at IS NULL;
```

### New API Route
```typescript
// apps/api/src/features/my-feature/myFeatureRoutes.ts
import { Router } from 'express';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { db } from '../../db/db';

const router = Router();
router.use(authMiddleware);

router.get('/', requireRoles(['clinician', 'admin', 'superadmin']), async (req, res, next) => {
  try {
    const rows = await db('my_feature').where({ clinic_id: req.clinicId }).whereNull('deleted_at');
    res.json({ data: rows });
  } catch (err) { next(err); }
});

export default router;
```

Register in `server.ts`:
```typescript
import myFeatureRoutes from './features/my-feature/myFeatureRoutes';
app.use(`${API}/my-feature`, myFeatureRoutes);
```

### New Patient Tab
1. Add to `PatientTabId` union type in `patientTypes.ts`
2. Add to `PATIENT_TABS` array
3. Add to appropriate group in `PATIENT_TAB_GROUPS`
4. Create component in `features/patients/components/detail/tabs/`
5. Register in `PatientDetailLayout.tsx` TAB_COMPONENTS map
6. Import in PatientDetailLayout

### New AI Action
1. Add case to `switch(action)` in `jobs/workers/aiWorker.ts`
2. The action automatically works with async queue + SSE + provenance
3. Frontend can submit via `POST /api/v1/ai/jobs`

### Reusable Components
```typescript
// Staff selector (replaces UUID inputs)
import { StaffPicker } from '../../../shared/components/ui/StaffPicker';
<StaffPicker value={staffId} onChange={setStaffId} label="Assign to" />

// Patient selector
import { PatientPicker } from '../../../shared/components/ui/StaffPicker';
<PatientPicker value={patientId} onChange={setPatientId} />
```

## 4. Key Patterns

### API Client (Frontend)
```typescript
// Simple
const data = await apiClient.get<MyType>('endpoint', { param: 'value' });
const result = await apiClient.post<MyType>('endpoint', body);

// With React Query
const { data, isLoading } = useQuery({
  queryKey: ['my-data', id],
  queryFn: () => apiClient.get<MyType>(`endpoint/${id}`),
  enabled: !!id,
});

// AI job (async)
const { jobId } = await apiClient.post('ai/jobs', { action: 'formulation', data: '...' });
// Result arrives via SSE or poll: GET /ai/jobs/{jobId}
```

### Real-Time Events
```typescript
// Publish from API
import { publishClinicEvent, publishUserEvent } from '../features/events/sseRoutes';
await publishClinicEvent(clinicId, { type: 'patient-arrived', patientName: '...' });
await publishUserEvent(staffId, { type: 'task-assigned', taskId: '...' });

// Listen in frontend
const { connected, on } = useEventStream();
useEffect(() => on('task-assigned', (data) => toast(data.title)), [on]);
```

### Prescriber Check
```typescript
function usePrescriberStatus() {
  const userId = useAuthStore(s => s.user?.id);
  const { data } = useQuery({
    queryKey: ['staff-prescriber', userId],
    queryFn: async () => {
      const staff = await apiClient.get<any>(`staff/${userId}`);
      return { isPrescriber: !!(staff?.prescriber_number) };
    },
  });
  return data ?? { isPrescriber: false };
}
```

### Check Constraints
When adding new enum values to existing tables:
```sql
-- Find the constraint
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint WHERE conrelid = 'table_name'::regclass AND contype='c';

-- Drop and recreate
ALTER TABLE t DROP CONSTRAINT constraint_name;
ALTER TABLE t ADD CONSTRAINT constraint_name CHECK (col IN ('val1', 'val2', 'new_val'));
```

## 5. Database Maintenance

### Backup
```bash
pg_dump -h localhost -U signacare_owner signacaredb | gzip > backup_$(date +%Y%m%d).sql.gz
```

### Backup Verification (weekly)
```bash
bash deploy/backup-verify.sh
# Creates backup → restores to test DB → verifies counts → cleans up
```

### Materialised View Refresh
```sql
SELECT refresh_report_views();  -- Concurrent refresh of mv_daily_metrics + mv_staff_caseload
```

### Audit Log Cleanup
```sql
SELECT archive_old_audit_logs(12);  -- Delete entries older than 12 months
```

### Index Health
```sql
-- Find unused indexes (run monthly)
SELECT schemaname, relname, indexrelname, idx_scan
FROM pg_stat_user_indexes
WHERE idx_scan = 0 AND schemaname = 'public'
ORDER BY pg_relation_size(indexrelid) DESC;
```

### Trigger Inventory
```sql
-- List all triggers by category
SELECT tgname, obj_description(p.oid) as category
FROM pg_trigger t
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE tgname NOT LIKE 'pg_%'
ORDER BY obj_description(p.oid), tgname;
```

## 6. Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| Network error on login | Rate limited | `redis-cli FLUSHALL` or restart API (auto-flushes in dev) |
| Cookie not sent | Cross-origin | Ensure `VITE_API_URL=/api/v1` (relative, not http://localhost:4000) |
| Check constraint violation | New enum value | Drop + recreate constraint (see Section 4) |
| AI job stuck | Ollama down | Check `curl http://localhost:11434/api/tags` |
| SSE not connecting | Auth expired | Hard refresh + re-login |
| Prescribe button locked | No prescriber number | Set `prescriber_number` in staff table |
| Recovery Star crash | Non-object data | Fixed with defensive try/catch (v2) |
| Reports page blank | Column doesn't exist | Check API logs, fix query column names |

## 7. Production Deployment Checklist

```
[ ] NODE_ENV=production
[ ] TRUST_PROXY=1
[ ] DB_SSL=true
[ ] COOKIE_DOMAIN=.yourdomain.com.au
[ ] JWT secrets: 64+ chars (openssl rand -hex 64)
[ ] CORS_ORIGIN=https://emr.yourdomain.com.au
[ ] Nginx configured (deploy/nginx.conf)
[ ] PM2 configured (deploy/ecosystem.config.js)
[ ] SENTRY_DSN set
[ ] Automated backups configured
[ ] Backup verification cron (weekly)
[ ] Materialised view refresh cron (nightly)
[ ] Audit log archival cron (monthly)
[ ] Redis Sentinel for HA (3 nodes)
[ ] SSL certificates installed
[ ] IP allowlist considered
[ ] Monitoring dashboard configured
```

## 8. Future Development Roadmap

### High Priority
1. **Complete SafeScript integration** — real-time S8 monitoring
2. **Medicare ECLIPSE** — bulk billing automation
3. **My Health Record** — ADHA FHIR Gateway integration
4. **e-Prescribing** — PBS script generation
5. **WCAG 2.1 AA** — accessibility compliance

### Medium Priority
6. **Process isolation** — split API into CoreClinical + Analytics + AI services
7. **Drizzle ORM** — type-safe persistence for new modules
8. **Clinical notes partitioning** — time-based table partitioning
9. **GraphQL batch endpoint** — reduce per-tab API calls
10. **Mobile-responsive** — tablet-first optimisation

### Architectural Evolution
11. **Plugin/extension framework** — metadata-driven custom forms
12. **Workforce intelligence** — burnout prediction, staffing optimisation
13. **Event replay** — medico-legal timeline reconstruction
14. **Advanced search** — Meilisearch for clinical notes
15. **Kubernetes HPA** — auto-scaling for large deployments
