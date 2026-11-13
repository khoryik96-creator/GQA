# Project QA activity audit (v0.19)

GQA records project-scoped QA activity through **database triggers**, not optional application-side logging calls. Migration `0004_qa_activity_audit.sql` creates an append-only table and records each source write in the *same PostgreSQL transaction*. A failed event insert fails the source transaction rather than silently losing audit evidence.

## Events and attribution

- `flow_drafted`, `flow_revised` and `repair_proposed`: browser-flow inserts, attributed to `created_by`.
- `run_started` and `run_status_changed`: creation and status changes of test runs, attributed to `initiated_by`.
- `repair_approved`: accepted, independently identified reviewer approval, attributed to `approved_by`.
- `memory_recorded`: newly recorded project knowledge, attributed to `created_by`.

Events contain only the event/action code, project and object UUIDs, optional actor UUID, optional known user email at read time, an execution state (for runs) and the database timestamp. **Never** copy prompts, passwords, tokens, browser actions, test input, raw console events, screenshot bytes, or arbitrary details into the audit table. Existing rows are not backfilled: older user attribution cannot be inferred reliably.

The `gqa_app` database role has SELECT access only on the audit table; migration role grants explicitly revoke INSERT, UPDATE, DELETE and TRUNCATE. A BEFORE UPDATE/DELETE trigger rejects modifications even when attempted by a more privileged SQL role. This is application-level append-only history, **not cryptographic tamper evidence**: database superusers and infrastructure operators can still alter the database or disable triggers. Export and externally protect audit records for regulated deployment.

## Read API

`GET /api/projects/{id}/qa-activity?limit=25[&cursor=...]` requires project `review` privilege (administrator, owner or reviewer). QA and viewer roles cannot read the audit. The API returns `{"items":[...],"next_cursor":"..."}`, uses bounded keyset ordering by timestamp and UUID, and returns at most 50 entries when no pagination arguments are supplied. It never performs an unscoped audit query.

Because actor fields were added after some historical data, the actor ID can be blank for legacy imports or internal recovery operations. This is deliberate; an unknown historical actor must not be fabricated.

## Verification and limitations

Docker integration checks that approval, repair proposal, flow draft, and successful execution transitions appear in the audit with the correct object/actor identities. Real Chromium reviewer tests verify that successful independent approval is visible to its reviewer; viewer and QA accounts are denied. Migration upgrade and synthetic backup/restore checks retain the audit table, its checksum and all recorded rows.

The audit does **not** yet enforce four-eyes approval (the project owner or admin may still hold QA and review privileges), independently attest deployment revisions, or cover host-broker internal journal transitions. Existing broker storage and independent external security review remain separate production-readiness tasks. Audit retention, offsite backup, detection of privileged tampering, compliance/privacy requirements and incident procedures must be assessed before external use. No production database or customer records are changed by CI.
