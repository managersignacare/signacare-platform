# Signacare EMR — Documentation Index

Organised for stable navigation. See `docs/adr/` for architectural decisions and `docs/plans/` for active work.

## Top-level folders

| Folder | What lives here |
|---|---|
| [`gold-standard/`](gold-standard/) | Canonical product documents — one per concern, each ending with a Cerner/Epic/best-practice comparison table. |
| [`guides/`](guides/) | User-facing guides — integration, deployment, user manual, developer guide, video script. |
| [`compliance/`](compliance/) | Regulatory artefacts — IEC 62304, privacy impact, TGA classification, threat manual, info-sec policy, accessibility. |
| [`operations/`](operations/) | Ops playbooks — disaster recovery, incident response, runbooks (key rotation, backup drill, on-call). |
| [`quality/`](quality/) | QA artefacts — governance control plane, fix registry, bugs remaining, fix/build rules, deep-audit scope, pre-deployment checklist. |
| [`product/`](product/) | Product governance SSoT — authoritative workflow/feature inventory and roadmap/new-feature register. |
| [`adr/`](adr/) | Architectural Decision Records. |
| [`plans/`](plans/) | Active engineering work plans. Shipped plans migrate to `archive/` when complete. |
| [`mobile/`](mobile/) | App-store submission artefacts for Sara (clinician) + Viva (patient) apps. |
| [`archive/`](archive/) | Historical audits, planning docs, and older reports. No active use — kept for traceability. |

## Top of each gold-standard doc

Every file under `docs/gold-standard/` MUST end with a comparison table against Cerner (Oracle Health), Epic, and the best-practice reference for that concern. The table is the enterprise-buyer deliverable.

## Fix registry

The machine-readable mirror of every verified fix lives at [`quality/fix-registry.md`](quality/fix-registry.md). Every PR that fixes a bug MUST add a row. See `quality/fix-build-rules.md` for the full rule.
