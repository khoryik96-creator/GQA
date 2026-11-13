# GQA v0.15 — Synthetic history query benchmark

The workflow `.github/workflows/history-query-benchmark.yml` spins up a disposable PostgreSQL 16 container without exposing a network port, applies the current v0.13 schema baseline, inserts **25,000 records each** into memories, plans, test runs and browser flows, then executes `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` on first-page and deep keyset-page queries.

The SQL benchmark lives at `scripts/history_query_benchmark.sql`. It deliberately inserts batches with equal timestamps to stress UUID tie-breaking in the `ORDER BY timestamp DESC,id DESC` path.

The GitHub Actions artifact `gqa-history-query-plans` contains the SQL execution plans and timing from the particular hosted runner. Evidence is retained for 14 days.

**Interpreting results:** The recorded `Execution Time` measures database execution under a synthetic fixture on an ephemeral machine. It is not user-facing HTTP latency, multi-user p95/p99 performance, cold-cache reliability, or proof of readiness for 100,000+ entries per project. The workload has minimal JSON payloads and only one project; production cardinality, concurrent writes, actual indexes, realistic memory content and multi-project distribution may change planner behaviour. No fixed performance targets are asserted.

A future tuning PR should compare query plans before and after an index migration such as `(project_id, created_at DESC, id DESC)` for plans/flows/memories and `(project_id, started_at DESC, id DESC)` for runs, and verify upgrade-time index lock/write impact on backed-up data. The current numbered migration runner executes SQL in transactions and cannot use `CREATE INDEX CONCURRENTLY` without a separately designed migration protocol.

**Safety:** Never execute the synthetic seed script on a user database. It inserts 100k records and is intended only for the CI-disposable Postgres container. This benchmark requires no production credentials or application services.
