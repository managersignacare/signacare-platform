# Findings 6c — Dependency audit (CVEs + outdated)

**Agent:** G-deps
**Scope:** `package.json` + `package-lock.json` at root + workspaces (`apps/api`, `apps/web`, `apps/emr-gateway`, `packages/shared`, `packages/ui-components`).
**Live probe artefact:** `docs/archive/audit-2026-04-24/probes/npm-audit-root.json` (427 lines, full JSON).

## Summary

| Severity | Count |
|---|---:|
| **Critical** | 1 |
| **High** | 1 |
| Moderate | 10 |
| Low | 1 |
| **TOTAL** | **13** |

Inventory: 1,110 prod, 469 dev, 126 optional, 17 peer — 1,661 deps total.

## Top-5 most severe

| # | Package @ version | Severity | GHSA / CVSS | Parent chain | Dev/Prod | Fix path |
|---|---|---|---|---|---|---|
| 1 | **protobufjs @ 7.5.4** | **CRITICAL** | GHSA-xq3m-2v4x-88gg (proto-pollution RCE, <7.5.5) | apps/api → @opentelemetry/exporter-trace-otlp-http → otlp-transformer → protobufjs; AND → @opentelemetry/sdk-node → exporter-trace-otlp-grpc → @grpc/grpc-js → @grpc/proto-loader | **prod** | `npm audit fix` — SAFE |
| 2 | **basic-ftp @ 5.2.0** | **HIGH** | GHSA-chqc-8p9q-pq6q (8.6 CRLF cmd-inject), GHSA-6v7q-wjvx-w8wg (8.2 MKD inject), GHSA-rp42-5vxx-qpwr (7.5 DoS) | root → pm2 6.0.14 → @pm2/agent → proxy-agent → pac-proxy-agent → get-uri → basic-ftp | dev/deploy-tooling | `npm audit fix` — SAFE |
| 3 | **dompurify @ 3.3.3** | moderate × 4 | GHSA-crv5-9vww-q3g8 (6.8 SAFE_FOR_TEMPLATES bypass), GHSA-v9jr-rg53-9pgp (6.9 prototype-pollution XSS), GHSA-39q2-94rc-95cp, GHSA-h7mw-gpvr-xq4m | direct, root | **prod** (server sanitisation + client) | bump `^3.3.3 → ^3.4.0` — SAFE minor |
| 4 | **fast-xml-parser @ 5.5.8** | moderate | GHSA-gh4j-gqv2-49f6 (6.1 XML comment/CDATA injection, <5.7.0) | apps/api → @aws-sdk/client-s3 → @aws-sdk/core → @aws-sdk/xml-builder → fast-xml-parser | prod | `npm audit fix` — SAFE |
| 5 | **nodemailer @ 8.0.4** | moderate | GHSA-vvjj-xcjg-gr5g (4.9 SMTP CRLF via transport `name`) | direct, root | prod | bump `^8.0.4 → ^8.0.5+` — SAFE patch |

## Remaining moderate / low (condensed)

- **uuid cluster** — moderate, GHSA-w5hq-g745-h8pq — bounds check in v3/v5/v6 with `buf` arg. Direct in `apps/api uuid ^9.0.0` + transitive via `@azure/msal-node` (8.3.2), `bullmq` (9.0.1), `gaxios` (9.0.1), `node-cron` (8.3.2). npm's `fixAvailable: "1.1.0"` is a **DOWNGRADE** — do NOT accept. Real-world impact negligible (code does not use v3/v5/v6 with `buf` arg).
- **@azure/identity 4.13.1** — moderate via @azure/msal-node → uuid. npm's `fixAvailable: "1.1.0"` is a DOWNGRADE.
- **@azure/msal-node 5.1.4, bullmq 4.18.3, node-cron 3.0.3, gaxios 6.x** — all gated on uuid chain.
- **@aws-sdk/xml-builder 3.972.17** — moderate (via fast-xml-parser), resolves with #4.
- **pm2 6.0.14** — low, GHSA-x5gf-qvw8-r2rm ReDoS (4.3, local auth). `fixAvailable: false`. Accept, re-audit in 30 days.

## Go / No-Go for pre-staging

**NO-GO until the 5 safe auto-fixes are applied.** CRITICAL protobufjs RCE + HIGH basic-ftp FTP-command-injection cannot ship to staging unpatched regardless of low theoretical exposure — CLAUDE.md §6.2 forbids shipping known CVEs of this severity.

After `npm audit fix` (resolves protobufjs, basic-ftp, fast-xml-parser transitively, auto-updates portion of dompurify) + manual root bumps (`dompurify` + `nodemailer`): posture becomes **GO**. The remaining uuid-chain moderate cluster does NOT block staging — document as known-accepted with 30-day re-audit.

## Breaking upgrades — require code review

| Package | Suggested → | Breaking |
|---|---|---|
| **uuid** | `^9.0.0 → 14.0.0` (apps/api direct) | Named-exports-only API; every `import uuid from 'uuid'` / `uuid.v4()` call site must migrate to `import { v4 as uuidv4 } from 'uuid'`. Full repo grep required. |
| **node-cron** | `^3.0.3 → 4.2.1` | v4 changed schedule return type, dropped `validate()` compat, TZ handling tightened |
| **bullmq** | `^4.17.0 → 0.0.1` | npm suggestion is a **YANKED placeholder**. Real path: wait for bullmq 5.x bump, OR override uuid via npm `overrides` |
| **@azure/identity** | `4.13.1 → 1.1.0` | npm suggestion is a **DOWNGRADE**. Real path: wait for @azure/msal-node uuid-bump |

## `npm audit fix` safety

- Without `--force`: auto-fixes 5 of 13 (protobufjs, basic-ftp, fast-xml-parser, dompurify transitive, nodemailer). **SAFE.**
- With `--force`: would downgrade @azure/identity to 1.1.0 and pin bullmq to 0.0.1. **DO NOT run `--force`.**
- Always re-run full L1–L5 gate after any `npm audit fix`.

## Related BUGs

- **BUG-373** (first audit) — `npm audit fix` — covers the 5 safe auto-fixes. Upgrade to S0 pre-staging BLOCKER (from S1) because protobufjs is CRITICAL RCE.
- **BUG-474 (S1)** (new) — uuid-chain upgrade plan: via npm `overrides` (short term) + await @azure/msal-node + bullmq upstream bumps (long term)
- **BUG-475 (S2)** (new) — migrate `apps/api` `uuid` imports to named-export API so a future major-version bump is one-step
- **BUG-476 (S3)** (new) — 30-day dependency re-audit cadence
