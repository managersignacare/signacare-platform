# Repo Split Sync Runbook

## Purpose

Keep the split repositories synchronized from the original `Signacare` monorepo using a one-way, auditable flow.

## Authoritative model

- Source of truth: `/Users/drprakashkamath/Projects/Signacare`
- Synced targets:
  - `/Users/drprakashkamath/Projects/signacare-platform`
  - `/Users/drprakashkamath/Projects/signacare-sara`
  - `/Users/drprakashkamath/Projects/signacare-viva`

Do not treat target repos as parallel authoring lanes. Make code changes in the original monorepo, then synchronize outward.

## Gold-standard flow

1. Commit your monorepo change.
2. Run:

```bash
npm run repo-split:check
npm run repo-split:verify-targets
```

3. If drift exists, inspect it with:

```bash
npm run repo-split:sync-targets:dry
```

4. Synchronize targets:

```bash
npm run repo-split:sync-targets
```

5. Review each target repo and push it separately if desired.

## Safety rules enforced by tooling

- source repo must be clean by default
- each target repo must be:
  - a git repo
  - on `main`
  - tracking `origin/main`
  - clean
  - aligned with upstream after `git fetch origin --prune`
- each target repo is backed up before overwrite
- post-sync verification must succeed

## Audit trail

Each target receives a `split-sync-status.json` file containing:

- source branch
- source commit
- authoritative remote
- manifest path and version
- sync timestamp

This file is the first place to check when someone asks, "Which monorepo commit was this split repo last synced from?"

## Failure modes

If `repo-split:verify-targets` fails:

- the split repo has drifted from the monorepo materialization
- or the target repo is on the wrong branch / remote / upstream

If `repo-split:sync-targets` refuses to run:

- commit or stash local source changes
- clean the target repo
- restore the target repo to `main`
- fix any ahead/behind divergence against `origin/main`

## Local experimentation only

There is one escape hatch:

```bash
node scripts/repo-split/sync-target-repos.mjs --allow-dirty-source
```

Use it only for temporary local rehearsal. It is intentionally outside the standard operational path.

If the machine cannot fetch private GitHub remotes, use the local verification variants:

```bash
npm run repo-split:verify-targets:local
npm run repo-split:sync-targets:local
```

These skip upstream fetch validation, so only use them when branch state has already been checked manually.
