// apps/api/src/jobs/workers/patientOutreachWorker.ts
//
// Phase 12B — shim that re-exports the feature-owned worker so the
// existing bootstrap.ts `./workers/${name}` import loop finds it
// without restructuring the feature directory. The actual
// BullMQ Worker instance lives at
// apps/api/src/features/patient-outreach/patientOutreachWorker.ts
// next to the service it dispatches to.
export { default } from '../../features/patient-outreach/patientOutreachWorker';
