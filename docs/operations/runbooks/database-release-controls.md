# Database Release Controls

Production database changes must be proven before artifact promotion. The
Azure deploy workflow enforces this with `deploy/azure/verify-database-release-controls.sh`.
Staging may run without these proof variables while the environment is still
being assembled; production fails closed by default.

## Required Production Proof

Set these GitHub environment variables before a production promotion:

- `DB_STAGING_CLONE_MIGRATION_PROOF`: link or run ID proving migrations were
  applied against a staging-clone database.
- `DB_EXPAND_CONTRACT_PROOF`: change-review evidence that the release follows
  expand/contract rules and remains compatible with the currently running app
  during slot/canary overlap.
- `DB_RESTORE_DRILL_PROOF`: restore-drill artifact proving backups can be
  restored and schema fingerprints match expected posture.
- `DB_ROLLBACK_REHEARSAL_PROOF`: `npm run migrate:rehearsal` artifact, or the
  approved forward-fix-only evidence for migrations that cannot safely roll
  back.

Use `DB_RELEASE_CONTROLS_REQUIRED=true` to make the same proof mandatory in
staging. Production does this automatically even if the variable is unset.

## Operator Sequence

1. Restore latest staging backup into an isolated clone.
2. Run the candidate migration set on the clone.
3. Run compatibility checks against the old and new application contract.
4. Run `npm run migrate:rehearsal` or attach the approved forward-fix-only
   record when rollback is intentionally prohibited.
5. Run the backup restore drill and capture the artifact.
6. Record the four proof references in GitHub environment variables.
7. Promote the immutable staging artifact to production.

## Expand/Contract Rule

Production releases must avoid same-step destructive schema cutovers. Use this
sequence:

1. Expand: add nullable columns/tables/indexes and compatibility views.
2. Deploy code that can read/write both old and new shapes.
3. Backfill data with bounded batches and observable progress.
4. Contract only in a later release after old code is no longer running.

Any exception must be captured as a forward-fix-only approval and must include
restore-drill evidence before production promotion.
