# GQA v0.14 database migration contract

The one-shot `migrate` Compose service uses the existing PostgreSQL administrator.
The API remains `gqa_app` (no DDL or superuser privileges).

## Version and integrity rules

- `db-migrate/versions/0001_baseline.sql` represents the full v0.13 schema, including the prior idempotent upgrades. It is a **baseline**, not a destructive reset.
- New changes must be separate sequential files (`0002_*.sql`, `0003_*.sql`, etc.). Never edit an applied file.
- `public.gqa_schema_migrations` records integer version, SHA-256 checksum and apply time.
- A checksum mismatch, missing migration number, SQL error, or database schema newer than the checkout prevents the migrator from succeeding; the API is gated on successful migration.
- Each migration SQL file and its ledger insert execute inside the same PostgreSQL transaction. Transactional SQL only: do not add commands that PostgreSQL prohibits inside a transaction, or migrations that need a separate autocommit.
- Run only one migration service against a database at a time. This is **not** a distributed advisory-lock migration manager.
- The baseline is checked by checksum for future runs; it is not executed again once recorded.

## Fresh install

1. Copy `.env.example` to `.env` and set all four required independent secrets.
2. Run `docker compose up --build -d`. The new migration ledger and baseline will be initialized before the API starts.
3. Check `docker compose logs --tail 100 migrate api`. Verify version 1 is recorded.

## Existing v0.13 database volume

**Do not run `docker compose down -v`.** Back up both PostgreSQL and screenshot volumes before upgrading. Test restore into an isolated environment first.

1. Stop writers, preserve your original database administrator password in `GQA_DB_ADMIN_PASSWORD`, and create a consistent `pg_dump -Fc` backup using your existing PostgreSQL administrator credentials. Back up the evidence volume separately.
2. Take a known-good backup of the entire existing volume or VM snapshot for full rollback. A `pg_dump` alone does not preserve screenshot evidence.
3. Deploy the new code with unchanged named volumes and run `docker compose up --build -d`.
4. Migration 0001 idempotently reconciles the v0.13 schema, then writes the version-one checksum only after success. Existing project rows, memberships, test runs and evidence remain intact.
5. Verify `SELECT version,checksum,applied_at FROM public.gqa_schema_migrations ORDER BY version;`, existing project counts and login/test history before accepting the upgrade.

## Recovery / rollback

- A failed migration rolls back the SQL statements and the ledger insert from that migration. Earlier committed versions are not automatically rolled back.
- **There is no automatic down migration.** For a destructive/irreversible migration, take a backup, test it, and prepare a tested forward-fix or restore plan before applying it.
- To revert to an older application that expects an older schema, restore the corresponding database **and evidence** backups in an isolated environment, then redeploy the matching source revision. Do not delete schema migration ledger rows to bypass checks.
- If the migrator reports a checksum mismatch, restore the original numbered migration file; do not overwrite a stored hash.
- For existing volumes, changing `POSTGRES_PASSWORD` in Compose does not rotate an initialized PostgreSQL role.

## Verification boundaries

The Docker integration workflow verifies a fresh baseline, matching SHA-256, idempotent second migration run and least-privileged application role. A representative **old-volume restore-and-upgrade rehearsal** and recovery test are still required before a high-value installation. The migration framework alone does not certify production readiness.
