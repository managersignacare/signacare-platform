# Noah Bennett Longitudinal Demo Data

> Generated demo-only longitudinal history for clinical walkthroughs.
>
> Canonical reseed command:
> `npm -w apps/api run seed:soham-mental-health-demo-suite`
>
> The suite includes `seed:noah-bennett-longitudinal-demo` on top of the
> Soham staff + patient-registration seeds so Noah Bennett exists before the
> longitudinal history is applied.

Generated at: 2026-05-18T11:08:59.781Z
Clinic: Soham Health
Patient: Noah Bennett (P000003)

Dataset includes:
- 3 episodes spanning 2021–2026 (community, acute manic ACIS phase, depressive relapse phase)
- Bipolar diagnosis record (manic + depressive course)
- Weekly review notes across acute phases by key clinician, junior medical staff, and consultant psychiatrist
- 91-day clinical review cadence (clinical notes + clinical review records)
- Medication timeline with active + ceased records and linked prescription history
- Appointments including did-not-attend events
- Physical health monitoring observations
- CTO legal-order episode during manic escalation
- ACIS escalation record with lifecycle events
- Message notes, internal MDT thread messages, and GP/carer/allied-health correspondence letters

Marker:
- All seeded records are tagged with `[Noah Demo]` and/or source type `demo_noah_seed` for safe cleanup/reseed.
