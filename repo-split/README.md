# Repo Split Execution Foundation

This directory is the machine-readable execution layer for the planned
repository split described in
[docs/plans/platform-separation-appservice-dotnet/02-repo-topology-and-ownership.md](/Users/drprakashkamath/Projects/Signacare/docs/plans/platform-separation-appservice-dotnet/02-repo-topology-and-ownership.md).

The original Signacare monorepo remains authoritative until parity and
cutover gates are proven. These files exist to make the split repeatable
and auditable instead of relying on manual copying.

## Contents

- `manifests/`
  ownership manifests for each target repo
- `scaffolds/`
  bootstrap README files for each target repo

## Source-of-truth model

- the original `Signacare` monorepo is the authoritative editing lane
- split repos are synchronized targets, not parallel authoring surfaces
- sync is intentionally one-way until a formal cutover decision is made

This means the safe operator flow is:

1. change code in the original monorepo
2. commit the monorepo change
3. run the repo-split checks and target verification
4. run target sync from the original monorepo
5. review and push the split repos

## Supported commands

- `npm run repo-split:check`
  validates manifest shape, overlap, and owned-file counts
- `npm run repo-split:scaffold`
  dry-runs the split and prints materialization counts
- `npm run repo-split:scaffold -- --out <dir>`
  materializes bootstrap repo trees into a target directory
- `npm run repo-split:sync-targets:dry`
  materializes expected target trees and reports whether current split repos drift
- `npm run repo-split:verify-targets`
  compares the current split repos against a fresh materialization from the original monorepo and fails on any drift
- `npm run repo-split:sync-targets`
  performs the authoritative one-way sync into the split repos after strict preflight checks
- `npm run repo-split:verify-targets:local`
  runs target verification without `git fetch`, useful on machines without GitHub access to the private remotes
- `npm run repo-split:sync-targets:local`
  runs sync without upstream fetch validation; use only when remote access is unavailable and local branch state has already been reviewed

## Supported remote URLs

The repo-split verifier accepts these `origin` forms for each target:

- preferred machine-local SSH alias:
  - `git@github-managersignacare:managersignacare/signacare-platform.git`
  - `git@github-managersignacare:managersignacare/signacare-sara.git`
  - `git@github-managersignacare:managersignacare/signacare-viva.git`
- canonical alternatives:
  - `git@github.com:managersignacare/<repo>.git`
  - `https://github.com/managersignacare/<repo>.git`

This allows the split repos to use a dedicated SSH identity without breaking the verifier.

## Sync guarantees

`repo-split:sync-targets` now enforces:

- original monorepo must be clean by default
- target repos must be clean
- target repos must be on `main`
- target repos must track `origin/main`
- target repo `origin` URLs must match one of the approved GitHub remote forms
- target repos are fetched before sync and must not be ahead/behind upstream
- each target working tree is backed up before overwrite
- post-sync directory verification must pass
- each target receives `split-sync-status.json` with the authoritative source branch + commit used for the sync

If you truly need to sync from a dirty monorepo worktree for local experimentation, the sync script supports `--allow-dirty-source`, but that is intentionally outside the gold-standard flow. Likewise, `--skip-fetch` exists for local/offline environments but should not replace the normal upstream validation path in routine operations.

## Current target repos

- `signacare-platform`
- `signacare-sara`
- `signacare-viva`

## Safety posture

- no source-of-truth moves happen automatically
- no current deployment paths are re-pointed by these files
- no files are deleted from the original repo
- mobile build caches and local IDE metadata are excluded from extraction
