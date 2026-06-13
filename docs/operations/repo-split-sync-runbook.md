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

5. Verify the target repos still track the expected remotes and are clean:

```bash
npm run repo-split:verify-targets
```

6. Push each split repo `main` branch to GitHub.

## Supported remote forms

The verifier accepts these `origin` URL forms for split repos:

- preferred on this machine:
  - `git@github-managersignacare:managersignacare/signacare-platform.git`
  - `git@github-managersignacare:managersignacare/signacare-sara.git`
  - `git@github-managersignacare:managersignacare/signacare-viva.git`
- also accepted:
  - `git@github.com:managersignacare/<repo>.git`
  - `https://github.com/managersignacare/<repo>.git`

The dedicated `github-managersignacare` SSH alias keeps split-repo auth separate from the monorepo's GitHub credentials.

## SSH setup on this machine

The hardened split-repo setup uses a dedicated SSH key and host alias:

- key file:
  - `~/.ssh/id_ed25519_managersignacare_split`
- SSH config host:
  - `github-managersignacare`
- each split repo `origin` points at that host alias
- previous destinations can be retained as `legacy-origin` for rollback/reference

Quick checks:

```bash
ssh-add -l
git -C /Users/drprakashkamath/Projects/signacare-platform remote -v
git -C /Users/drprakashkamath/Projects/signacare-sara remote -v
git -C /Users/drprakashkamath/Projects/signacare-viva remote -v
```

Expected push commands:

```bash
git -C /Users/drprakashkamath/Projects/signacare-platform push -u origin main
git -C /Users/drprakashkamath/Projects/signacare-sara push -u origin main
git -C /Users/drprakashkamath/Projects/signacare-viva push -u origin main
```

## Safety rules enforced by tooling

- source repo must be clean by default
- each target repo must be:
  - a git repo
  - on `main`
  - tracking `origin/main`
  - clean
  - aligned with upstream after `git fetch origin --prune`
  - using one of the accepted canonical GitHub remote forms
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
- or the machine is using the wrong GitHub auth lane for the split repos

If `repo-split:sync-targets` refuses to run:

- commit or stash local source changes
- clean the target repo
- restore the target repo to `main`
- fix any ahead/behind divergence against `origin/main`
- confirm the repo `origin` is using the approved SSH alias or canonical GitHub URL

## Split push troubleshooting

If HTTPS push fails with `Permission denied ... 403`:

- `gh auth status` is probably pointing at a GitHub account without write access to `managersignacare/*`
- use the dedicated SSH lane instead of changing monorepo auth

If SSH push fails with `Permission denied (publickey)`:

- confirm `~/.ssh/id_ed25519_managersignacare_split` exists
- confirm the public key is registered in GitHub
- reload the key:

```bash
ssh-add --apple-use-keychain ~/.ssh/id_ed25519_managersignacare_split || \
ssh-add ~/.ssh/id_ed25519_managersignacare_split
```

- re-test access:

```bash
GIT_SSH_COMMAND='ssh -o StrictHostKeyChecking=accept-new' \
git ls-remote git@github-managersignacare:managersignacare/signacare-platform.git HEAD
```

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
