# Phase 0.5 — Postgres rename runbook

**Purpose.** One-shot operator procedure for renaming the Signacare Postgres role and database from the legacy `noususer` / `nousdev` names to the canonical `signacare_owner` / `signacaredb` names prescribed by `docs/gold-standard-reports/08-deployment-guide.md §2 "Postgres role model"`. The rename is metadata-only: zero rows are moved, touched, or rewritten.

This file is intentionally short. It documents exactly what to run, in what order, with what environment variables. If you find yourself improvising, stop and re-read the plan at `/Users/drprakashkamath/.claude/plans/sleepy-roaming-meteor.md` Phase 0.5.

---

## Who this is for

The operator running the Phase 0.5 PR 2 deploy (the one that flips every `.env*`, `docker-compose*.yml`, `.claude/settings.json`, CI workflow, and the `20260329_rls_app_user.sql` migration to use `current_database()` and `current_setting('app.owner_role')` instead of literal names). The `20260505000000_rename_db_and_role.ts` migration file was merged in PR 1 as a gated no-op — it only runs when you set `ALLOW_DB_RENAME=1` explicitly.

---

## Pre-flight (run these before you touch production)

1. **Take a backup of the current database** — `pg_dump -Fc -U noususer nousdev > ~/backups/phase-0.5-pre-rename-$(date +%Y%m%d%H%M).dump`. Store offsite. This is your rollback-of-last-resort.
2. **Pick the new `app_user` password** — 16+ characters, store in your secrets vault now. You will need to inject it into the migration environment via `APP_USER_PASSWORD=…`.
3. **Confirm you have a libpq URL for a superuser connection to the `postgres` maintenance database**, for example `postgres://postgres@localhost:5432/postgres` for local dev, or your cloud provider's equivalent. Store as `SUPERUSER_DATABASE_URL`.
4. **Check no other connections to `nousdev` exist** — `SELECT count(*) FROM pg_stat_activity WHERE datname = 'nousdev' AND pid <> pg_backend_pid();` should return 0 during the rename window. If it doesn't, identify and stop the holders.
5. **Record the current row count for `staff`** so you can confirm the rename preserved data — `psql -U noususer -d nousdev -c "SELECT count(*) FROM staff"`. Write it down as `N`.
6. **Grep your infrastructure-as-code and secret vaults for `nousdev` / `noususer`** — the CI guard only sees files inside this repo. Grafana, Terraform, backup crons, monitoring agents, read replicas, `pg_hba.conf`, and any Ansible playbook that connects to Postgres need to be updated in lockstep with the rename window. List every hit here before you start so you don't miss one.

---

## The rename window (≈30 seconds of API downtime)

```bash
# 1. Stop the API so no connections are held against nousdev
pm2 stop api                    # or your process manager's equivalent
# Double-check nothing else is connected
psql -U postgres -d postgres -c "SELECT count(*) FROM pg_stat_activity WHERE datname = 'nousdev'"

# 2. Run the rename migration with the one-shot gate
cd /path/to/Signacare/apps/api
export ALLOW_DB_RENAME=1
export SUPERUSER_DATABASE_URL='postgres://postgres@localhost:5432/postgres'
export APP_USER_PASSWORD='<the password from your vault>'
npm run migrate:latest

# The migration:
#   - ALTER ROLE noususer RENAME TO signacare_owner
#   - ALTER DATABASE nousdev RENAME TO signacaredb
#   - CREATE ROLE app_user WITH LOGIN PASSWORD '<APP_USER_PASSWORD>'
#   - GRANT CONNECT / USAGE / DML / default privileges → app_user
# Each step is idempotent; re-running is a no-op.

# 3. Update .env files on this host to the canonical names
#    (in PR 2 .env.example is already updated, so flipping to it is
#    just a matter of copying):
#      DB_USER=signacare_owner
#      DB_NAME=signacaredb
#      DB_APP_USER=app_user
#      DB_APP_PASSWORD=<APP_USER_PASSWORD>
#    Unset ALLOW_DB_RENAME and SUPERUSER_DATABASE_URL in the runtime env
#    so a later accidental migrate:latest doesn't re-run anything.
unset ALLOW_DB_RENAME SUPERUSER_DATABASE_URL APP_USER_PASSWORD

# 4. Start the API back up
pm2 start api
```

---

## Post-rename verification (must pass in order)

1. `psql -U signacare_owner -d signacaredb -c "SELECT count(*) FROM staff"` → returns exactly `N` from pre-flight step 5. **This is the data-preservation proof.**
2. `psql -U signacare_owner -d signacaredb -c "SELECT count(*), max(migration_time) FROM knex_migrations"` → count unchanged from before, `20260505000000_rename_db_and_role` appears in the list.
3. `curl localhost:4000/health` → `{"status":"ok"}`.
4. Log in as a seeded test user via the web app. JWT returned in < 500 ms.
5. Open a patient chart. Rows visible → proves the RLS `GRANT` statements (now reading `current_setting('app.owner_role')` instead of a literal) still work.
6. Log in as a *second* clinic. Confirm isolation — only that clinic's patients visible.
7. `bash .github/scripts/check-no-stray-db-names.sh` → zero hits. (PR 2 flips this guard to FAIL mode, so a remaining stray name would surface here.)
8. Tail the API log for 60 seconds. No `role "nous"` errors, no `KnexTimeoutError`, no `role "signacareemr"` errors.

---

## Rollback (if any of the verification steps fail)

```bash
# Run as a superuser from the postgres maintenance database:
psql -U postgres -d postgres <<'SQL'
ALTER DATABASE signacaredb RENAME TO nousdev;
ALTER ROLE signacare_owner RENAME TO noususer;
REASSIGN OWNED BY app_user TO noususer;
DROP OWNED BY app_user;
DROP ROLE app_user;
SQL

# Then flip the .env files back to the legacy names:
#   DB_USER=noususer
#   DB_NAME=nousdev
#   (remove DB_APP_USER / DB_APP_PASSWORD lines)

pm2 restart api
```

Total rollback time: under 60 seconds. Data is preserved because every rename is metadata-only. The `knex_migrations` table still lists the rename migration as applied, so you should also manually `DELETE FROM knex_migrations WHERE name = '20260505000000_rename_db_and_role.ts'` before attempting to re-run it, otherwise Knex will treat it as already done.

---

## Restoring a pre-rename backup into a post-rename environment

If you ever need to restore the `~/backups/phase-0.5-pre-rename-*.dump` archive (which still contains `CREATE DATABASE nousdev` and `OWNER TO noususer` lines) into the post-rename cluster:

```bash
pg_restore \
  --dbname=signacaredb \
  --no-owner \
  --role=signacare_owner \
  ~/backups/phase-0.5-pre-rename-XXXXXX.dump
```

`--no-owner` discards the embedded `OWNER TO` statements and `--role=signacare_owner` re-applies the current canonical owner.

---

## FAQ

**Q: The migration refuses to run with "ALLOW_DB_RENAME is not 1". Good?**
Yes — that's the gate. It's supposed to refuse. Set the env var and retry.

**Q: The migration says "SUPERUSER_DATABASE_URL is not set". Why can't it use the normal app pool?**
Because `ALTER DATABASE nousdev RENAME TO signacaredb` cannot be executed inside `nousdev` — Postgres rejects it with "cannot rename the currently open database". The migration must connect to a different database (the `postgres` maintenance DB) as a role with the `SUPERUSER` or `CREATEDB` attribute, which the application role does not and should not have.

**Q: What happens if I run the migration twice?**
Second run is a no-op. Every DDL statement is wrapped in a probe that checks whether the rename has already happened; if yes, it skips. Safe to re-run.

**Q: Does this migration touch any application tables?**
No. It only issues `ALTER ROLE ... RENAME TO`, `ALTER DATABASE ... RENAME TO`, `CREATE ROLE`, and `GRANT`/`ALTER DEFAULT PRIVILEGES`. The rows, indexes, triggers, sequences, foreign keys, RLS policies, and `knex_migrations` bookkeeping table are all untouched.

**Q: I have `nousdev` references in my Grafana dashboards / Terraform / backup cron / `pg_hba.conf`. Does this migration help?**
No. The CI guard only scans files inside the repo. Infrastructure-as-code and operator config outside the repo must be updated by hand in the same window. Use pre-flight step 6 to enumerate them.
