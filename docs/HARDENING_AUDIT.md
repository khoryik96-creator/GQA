# GQA v0.13 — Source audit remediation register

**Status:** draft, developer-only, not approved for production or untrusted websites.
**Scope:** changes in [PR #14](https://github.com/khoryik96-creator/GQA/pull/14), stacked on v0.12 [PR #13](https://github.com/khoryik96-creator/GQA/pull/13).
**Principle:** preserve existing restricted execution targets. Never declare a
passing test unless its approved assertions were executed and validated.

This is an engineering register, not a penetration test, certification or
promise of enterprise production readiness. A CI passing result is a test
result, not a proof that every runtime condition is safe.

## High-priority audit findings

| Finding | Implementation | Remaining qualification |
| --- | --- | --- |
| H01: cleanup error masked by early return | Corrected launcher return/cleanup ordering and test | Host Docker failures remain possible; broker fails closed |
| H02: final browser action without assertion | Go and Node require final postcondition assertions; tests added | A valid assertion still needs human review against real requirements |
| H03: client disconnect strands running result | Independent bounded finalization context, graceful HTTP shutdown, restart reconciler | Unexpected host shutdown can still terminate work; records are classified as interrupted |
| H04: API database superuser | One-shot privileged migration container, limited gqa_app runtime, private storage network | The migration task still needs bootstrap credentials; protect .env and DB volumes |
| H05: outdated build/runtime | Updated Go build/CI and Playwright browser image | Dependency updates need ongoing scanning and versioned lockfiles |
| H06: two host brokers racing | Exclusive local journal lease, bind-before-schedule and restart tests | Local filesystem only; not an HA/distributed lease |
| H07: worker failure called application regression | Distinct infrastructure_error in comparisons and UI, checks and trend data | Root-cause determination still needs independent application evidence |
| H08: default runner race | Reserve capacity before reading streamed body; bounded bytes; concurrency test | Single-run local implementation; no distributed queue |
| H09: login rate-limit race/IP lockout | Atomic account-key reservations and separate shared-IP ceiling | Single-process memory, no distributed policy or MFA |
| H10: partial worker checks can pass | Complete exact smoke/flow evidence contract with negative tests | A successful full sequence is not sufficient proof of a business invariant |
| H11: claimed application version | Explicit user_declared provenance label and migration/UI wording | Build attestation is **not implemented** and must precede customer staging adoption |
| H12: async broker drops evidence | Private atomic result store, authenticated /jobs/{id}/result, admin proxy and UI, restart integration | Async broker jobs are not yet first-class project-owned Postgres runs; broker is global admin-only |
| H13: QA actor attribution incomplete | Created_by / initiated_by / approved_by columns added to new QA rows | Historical rows are nullable; broader append-only QA audit, access reviews remain |
| H14: project switch mixing UI data | Latest-project ref blocks stale async updates from mutating current project | Main dashboard still monolithic; project-scoped data caching remains future work |

## Other improvements included

- Added explicit terminal states for interrupted/incomplete/cancelled/timed-out
  runs and classified worker interruptions separately from assertions.
- Added single-instance per-user/project request budgets for expensive
  planning, repository inspection and test execution.
- Added hourly pruning for expired sessions and locator cache rows.
- Added an **opt-in** screenshot retention policy. By default, evidence is
  retained; a positive GQA_EVIDENCE_RETENTION_DAYS prunes screenshots of
  sufficiently old completed runs in bounded batches. Test history remains.
- Added bounded Go HTTP server limits and graceful signal-driven shutdown.
- Added an index covering project quality history and a dedicated private
  PostgreSQL network.
- Added a periodic admin job monitor and accessible quality history table.
- Removed obsolete UI version identifiers from long-lived capability panels.
- Added Go vet, Go vulnerability analysis and high-severity production
  Node advisory checks as separate CI workflow.

## Installation and migration precautions

**Mandatory for v0.13 branch:** add a random, URL-safe
GQA_DB_APP_PASSWORD (32+ characters) to the existing .env. The new
\`migrate\` Compose service applies existing idempotent schema DDL with the
database bootstrap owner and configures an unprivileged gqa_app account.
The Go API connects using only that new account.

Existing DB volumes preserve their *original* bootstrap account password.
Changing GQA_DB_ADMIN_PASSWORD in Compose does not rotate an already-created
PostgreSQL role. Don't overwrite/reset the volume; back up first. For new
installations, set GQA_DB_ADMIN_PASSWORD to a separate random secret
**before the initial database creation**. Existing installations that
use the earlier local-only bootstrap password can retain that secret
only on a trusted, non-public developer machine.

Example local PowerShell migration:

1. \`git fetch origin\`, \`git switch feat/reliability-audit-hardening-v013\`.
2. Back up any important PostgreSQL and evidence volumes.
3. Update existing \`.env\` with a new \`GQA_DB_APP_PASSWORD\`. Do not change
   prior passwords blindly and do not commit the .env.
4. \`docker compose up --build -d\`, then \`docker compose ps\` and
   \`docker compose logs --tail 100 migrate api\`.
5. Confirm administrator login, existing projects, test-run history and
   the Regression Insights tab before running new tests.

The optional host broker is still restricted to built-in fixtures.
GQA_JOB_MANAGEMENT_ENABLED=false remains the default.

## Risks that are *not* fixed by v0.13

These require a separate infrastructure, policy or product program.
They must not be marked completed merely because this patch's CI passes.

### Host and browser isolation
- Host-side broker owns privileged Docker CLI access. Keep its listener
  firewall-blocked to untrusted systems. A token is insufficient to safely
  expose it to the internet.
- Containers share a host kernel and Chromium's sandbox is disabled.
  Untrusted websites need a dedicated trusted execution host, safer
  Chromium sandbox setup and potentially microVM/VM isolation.
- Fixed-fixture allowlist should remain in effect until target-specific
  authorization and egress controls can be independently validated.

### Multi-user, SaaS, production readiness
- No organization-level tenancy with isolation of customer secrets,
  execution environments, billing, evidence encryption policies or quotas.
- Login/session rate limits and action budgets are in-process and will
  not coordinate across an HA cluster. MFA/SSO and mature recovery flows
  are not implemented.
- Project-level model-data sharing consent, external-provider redaction
  and audit-level data governance are not complete.
- No independent security assessment, threat simulation, operational
  incident-response workflow or SOC/PDPA compliance certification.

### Execution provenance and evidence
- Build revisions in accepted locator repairs are user-declared, not
  attested from running applications. Do not claim verified deployment
  revision without new verifiable build identifiers.
- The broker's durable async result store is a local private directory
  (checks and base64 screenshots); it is not project-scoped long-term
  evidence storage or an HA audit journal.
- Execution cancellation upon account revocation is not yet coordinated
  with long-running jobs; authorization is checked at submission time.
- Artifact retention, backups and secure deletion need organization policy.

### Scalability and developer productivity
- Main Next.js page contains too many states and still fetches some
  data redundantly. A project-aware query cache, feature modules and
  skeleton/loading/error conventions are needed.
- Run, plan, memory and flow lists use fixed result limits rather than
  cursor pagination. Large-project performance has not been load-tested.
- Typed-flow editing, verified build metadata, versioned migrations
  with reversible rollback, and deterministic production-grade lockfiles
  are incomplete.
- The default docker compose setup runs browser fixtures and the runner
  even for planning-only workflows; profiles can reduce idle resource use.

## Review gates for PR #14

- [ ] All Foundation CI jobs pass for the FINAL PR head.
- [ ] Full Docker integration passes, including existing projects, roles,
      account administration, browser tests and screenshot retrieval.
- [ ] Experimental container integration passes, including broker restart,
      durable evidence and no leftover containers.
- [ ] Release safety checks and new static/dependency-security workflow
      pass for the FINAL PR head.
- [ ] Verify a fresh install and an existing-volume upgrade with backups.
- [ ] Confirm the API cannot connect as a database superuser.
- [ ] Test browser disconnects, simultaneous runner requests and worker
      timeouts under load, not only in individual unit tests.
- [ ] Human review the cumulative PR #13 → #14 diff and explicitly accept
      the remaining local-development-only limitations.
- [ ] Keep PR #14 draft until checks are complete and owner approves merge.

**Release policy:** Do not enable arbitrary external targets, expose the
host broker publicly, or sell GQA as an enterprise testing service based
on this patch alone.
