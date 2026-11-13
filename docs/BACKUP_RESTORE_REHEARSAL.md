# Disposable PostgreSQL backup and recovery rehearsal

The database migration CI workflow now runs a **custom-format `pg_dump` plus transactional `pg_restore`** against a disposable, already-upgraded PostgreSQL instance. It adds synthetic, referentially linked QA request, plan, test run, browser flow and project-memory rows to a pre-versioned sentinel project, then restores the database to a separate `gqa_recovered` database on the same ephemeral container.

The workflow requires:

- A nontrivial backup file, records its SHA256, and restores it using `pg_restore --single-transaction --exit-on-error --no-owner`.
- Exact source/restore row-count parity across `projects`, `qa_requests`, `plans`, `test_runs`, `browser_flows`, `memories` and `gqa_schema_migrations`.
- Preservation of the legacy project and confirmed memory sentinel, migration v2 checksum, all four composite keyset indexes, and the runtime application's read grant.
- Explicit removal of the temporary restored database and dump, followed by the existing tampered-history and forward-version checks.

**This does not restore any user backup.** CI creates disposable credentials and data and deletes Docker volumes at the end. This tests format/DDL consistency in one PostgreSQL version and local container; it is not a full disaster recovery exercise, offsite encrypted backup policy, recovery-point guarantee, production data migration, downtime measurement, point-in-time replay, foreign object storage credentials, multi-host restoration, or a compliance claim.

For a real release: provision a controlled destination with matching extensions and roles, obtain consent and a signed recovery plan, encrypt and access-control the backup, dry-run with a representative sanitized backup, compare application and evidence consistency, measure RPO/RTO under write load, and require human sign-off before production restore. No automated task in this repository is authorized to restore or delete production databases.
