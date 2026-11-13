# GQA v0.13 — hardening status and residual risk

**Status: draft / local-only, not production-certified.** This document is
an implementation record, not a security certification. All protections
must be evaluated in the environment actually used to deploy GQA.

## Findings addressed in this branch

| Original finding | Implementation |
| --- | --- |
| H-01 orphan cleanup can be masked | Removed early return from launcher and made cleanup failures fail closed |
| H-02 false pass without postcondition | Require final assertion in both Go and Node browser-flow validators |
| H-03 stranded running test | Detached bounded worker request context; periodic fail-closed stale-run recovery |
| H-04 privileged runtime DB | Separate migration container and `gqa_app` CRUD-only database role; independent admin/app passwords |
| H-05 unsupported Go toolchain | Upgrade Go toolchain to 1.27 and runtime Alpine to 3.24 |
| H-06 broker startup race | Bind local broker listener before replaying persisted work, fail if endpoint is occupied |
| H-07 infrastructure false regression | Exclude recognized worker/runner failures from app regression classifications |
| H-08 runner concurrency race | Recheck and atomically claim busy status after receiving validated request body |
| H-09 concurrent login attempts | Reserve attempts under mutex before bcrypt; separate account and higher-level IP buckets |
| H-10 incomplete green worker results | Verify check names/order/count; missing completed checks can never be a pass |
| H-11 revision provenance | Explicitly label app revision as user-declared until independently attested |
| H-12 dropped async job evidence | Persist bounded check summaries and local PNG evidence; admin-only retrieval; bounded broker screenshot retention |
| H-13 missing QA authorship | Store authenticated actor IDs on new plans, memories, executions and repair approvals |
| H-14 project switch data mixing | Guard async frontend updates against changed active project |
| M-03 timeout mismatch | Align API, broker and worker time budgets; refuse redirects |
| M-04 / M-09 expired rows | Periodically purge old sessions and expired locator cache records |
| M-07 failed journal writes | Roll back in-memory changes; refuse work after uncertain durable state |
| U-06 stale regression refresh | Clear old report while fetching fresh results |

## Operational changes and migration warning

The `migrate` service uses a PostgreSQL administrator only while applying
schema/grant changes. The long-running API connects as `gqa_app`, which has
runtime DML but no schema creation or superuser rights. Fresh installations
need four independent secrets in `.env`:
`GQA_ADMIN_PASSWORD`, `GQA_RUNNER_TOKEN`,
`GQA_DB_APP_PASSWORD` and `GQA_DB_ADMIN_PASSWORD`.

**Existing database volumes must rotate the old fixed PostgreSQL password
before the hardened stack is started.** Follow the README's non-destructive
upgrade instructions and back up the data first. Do not wipe volumes.

## Residual work: not claimed complete

These items are deliberately **not** marked fixed:

- **Production isolation:** the host Docker broker still has privileged
  Docker-engine access and Chromium is launched without its sandbox.
  A dedicated execution host, additional OS policy or microVM boundary
  and controlled authorized external-target networking require separate
  threat modeling and deployment work.
- **Full broker singleton lease:** binding the expected endpoint prevents
  common same-port startup duplication, but a second instance configured
  with another port/bind and the same journal directory is not protected
  by an OS-level file lock. Do not share broker state across processes.
- **Database migration framework:** migrations now run separately and with
  least-privileged runtime credentials, but the schema remains a cumulative
  idempotent SQL script rather than numbered migration files with rollback.
- **Complete provenance:** user-declared application revisions cannot be
  independently verified until GQA captures trusted build/deployment IDs.
  New records store actor IDs, but historical records may lack actors and
  a comprehensive immutable audit stream is still pending.
- **Distributed job semantics:** async fixture jobs retain check summaries
  and PNGs, but are not a distributed queue or a multi-tenant execution
  system. Full per-project asynchronous job ownership needs integration.
- **Production privacy:** the API's screenshot evidence volume still needs
  an organization-defined retention, deletion and encryption policy.
  Broker screenshots are pruned with bounded local job history.
- **Dependency hygiene:** Node lockfiles, Go module checksums, software bill
  of materials and scheduled vulnerability/container scanning still need
  to be incorporated into release CI.
- **User management:** MFA/SSO, isolated administrative recovery, per-user
  model spend quotas, and immediate mid-flight cancellation on account
  revocation are not implemented.
- **Performance:** production workload benchmarks, HTTP lifecycle stress,
  large-scale pagination, caching, and an asynchronous transactional job
  store remain separate scaling work.
- **UI and product scope:** the main React command center remains large;
  full project-scoped query caching, accessible tabular chart alternatives,
  direct typed-action editing and approved external staging flows are not
  complete.

## CI expected before review

All four existing workflows must pass on the final hardening commit:
Foundation CI (Go/Next.js/runner/broker); real Docker integration; real
experimental disposable-container integration, including broker screenshot
persistence; and static release safety gates. The Docker integration also
checks the restricted PostgreSQL role does not have superuser or schema
creation privileges.

The successful CI suite verifies known supported fixture paths; it cannot
certify hostile website isolation, network-level penetration resistance or
production multi-tenancy.
