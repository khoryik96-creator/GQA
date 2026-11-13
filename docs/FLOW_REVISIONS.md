# Immutable typed browser-flow revisions (v0.18)

## Workflow
A QA-capable user opens Browser Flow Studio and selects **Edit typed steps as a new version**. The editor supports only existing, allowlisted action types: `navigate`, `click_role`, `fill_label`, `assert_text`, `assert_visible_role`, and `assert_url_path`. Action fields change with operation, and the first step stays a navigation. The normal Go executor validation checks step count (2–8), relative paths, permitted roles, nonsecret form inputs, and final assertions.

Clicking **Save new version for review** POSTs `{source_digest,steps}` to `/api/projects/{id}/flows/{flowId}/revisions`. The API authenticates project QA permission, checks the base digest and stored data integrity, computes the new SHA-256 review digest, and inserts a **new immutable browser_flows row** with `revised_from_flow_id` rather than modifying the old flow. One-successor uniqueness prevents branching or concurrent conflicting successors. A 409 means another editor already created a successor and users must reload. Repair proposals cannot be manually edited; their evidence-based ancestry remains separate.

A GET to the same endpoint returns up to 100 lineage entries, in version order, for users with project read permission. Selecting an old version displays its exact original steps and digest. Every version requires fresh explicit acknowledgement before execution; previous screenshots, runs, failure evidence and accepted repair lessons remain linked to their original flow IDs.

## Security and operational limits
The endpoint does not accept JavaScript, arbitrary selectors, external navigation paths, secret-labelled inputs or bypassed executor approval. The existing execution allowlist and prohibition on production-plan execution remain unchanged. Edits can modify assertions: **an edited flow is not automatically a verified repair or validated test outcome**. Human review and replay are required.

Migration `0003_immutable_flow_revisions.sql` adds a nullable self-reference and a unique index using transactional DDL with short lock timeout. Existing rows are unaffected. Legacy upgrade, checksum enforcement and backup/restore tests must remain green before rollout. No changes are made to production databases by CI.

## Coverage
Docker integration tests assert new digest, old record preservation, full lineage, conflict on competing successors, rejection of stale digest for replay and rejection of untyped script operations. Chromium UI E2E tests verify editing a typed assertion creates a saved version and clears the prior execution acknowledgement.

Potential future work: deletion restrictions and retention lifecycle for extremely long histories, graphical step insertion/order tooling, multi-user edit concurrency notifications, real application DOM selector inspection, and accessibility feedback for each step. Passing fixture CI is not production readiness.
