# GQA v0.16 — Isolated API concurrency and database recovery

The new `.github/workflows/api-load-recovery.yml` exercises GQA's actual API and PostgreSQL instance in an **ephemeral GitHub-hosted Docker Compose stack**. It does not connect to any production deployment.

## Procedure

1. Generate four unique bootstrap secrets for an isolated Compose stack.
2. Authenticate an administrator using the existing login endpoint, then create one test project and 40 memory records.
3. Issue 360 read-only requests through 12 concurrent threads against six endpoints: project listings, paginated memories, paginated plans, paginated runs, paginated browser flows and authenticated session.
4. Require HTTP 200 and a valid pagination response where applicable; record observed p50/p95/p99/max request latency and error counts in a JSON Actions artifact. This is not a strict speed budget; timing numbers vary by shared CI host.
5. Stop only the disposable PostgreSQL container, verify authenticated reads do not return successful project data, restart it, and verify the original authenticated session and previously written project records recover.
6. Remove the disposable Docker volumes and secrets.

## Safety and constraints

The Python probe requires both `CI=true` and `GQA_ISOLATED_LOAD_TEST=YES`, an isolated `.env`, a local Compose file and a hardcoded loopback API target (`127.0.0.1:8080`). It never sends browser/worker jobs to external origins or performs concurrent writes. The CI runner is ephemeral. Do not run the probe on a real database or server.

This is a **bounded functional load baseline**, not a saturation benchmark or capacity estimate: a single API process and one isolated database, one administrator, read-heavy endpoints, 12 threads, 360 requests and 40 persisted memories. There is no evidence that its p95/p99 reflects 20 real active users, complex QA execution, cross-tenant workloads or external network variance.

The database interruption is intentionally brief and tests restart reconnection with the same session; it does not prove in-flight transaction recovery, broker crash durability, multi-node availability, automatic failover, real backup restore or graceful degradation under continuous load. The API's `/healthz` currently does not check database readiness, so this test uses authenticated project reads to verify restoration.

Next steps: realistic concurrent writers and job submission with quotas, backend DB transaction failures, unexpected API process termination, broker journal failure, independent host metrics and repeat-run comparisons.
