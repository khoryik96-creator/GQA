# GQA v0.15 — Synthetic history query benchmark

The workflow `.github/workflows/history-query-benchmark.yml` spins up a disposable PostgreSQL 16 container without exposing a network port, applies the current v0.13 schema baseline, inserts **25,000 records each** into memories, plans, test runs and browser flows, then executes `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` on first-page and deep keyset-page queries.

The SQL benchmark lives at `scripts/history_query_benchmark.sql`. It deliberately inserts batches with equal timestamps to stress UUID tie-breaking in the `ORDER BY timestamp DESC,id DESC` path.

The GitHub Actions artifact `gqa-history-query-plans` contains the SQL execution plans and timing from the particular hosted runner. Evidence is retained for 14 days.

**Interpreting results:** The recorded `Execution Time` measures database execution under a synthetic fixture on an ephemeral machine. It is not user-facing HTTP latency, multi-user p95/p99 performance, cold-cache reliability, or proof of readiness for 100,000+ entries per project. The workload has minimal JSON payloads and only one project; production cardinality, concurrent writes, actual indexes, realistic memory content and multi-project distribution may change planner behaviour. No fixed performance targets are asserted.

Migration `0002_history_keyset_indexes.sql` adds the exact compound keyset indexes for plans, flows, memories and test runs. The benchmark now records **before and after** SQL execution plans against the same synthetic 100k-row dataset (two artifacts in the workflow run). Both result sets include first and deep-page queries. Differences are *measurements on one disposable runner*, not fixed performance guarantees.

**Upgrade safety:** The numbered migration runner uses one PostgreSQL transaction and therefore cannot use `CREATE INDEX CONCURRENTLY`. Creating ordinary B-tree indexes can hold a lock that blocks writes until commit. Version 0002 sets a 15-second lock timeout and 5-minute statement timeout; any exceeded limit aborts that migration transaction and leaves its ledger unapplied. For a large/high-traffic existing installation, schedule a maintenance window, rehearse against a restored representative backup and measure index build time, write contention and disk headroom before deployment. CI on synthetic data does not replace this rehearsal.

The older, less-specific indexes remain in place for compatibility and other query paths; removing any redundant indexes is separate follow-up work requiring query-plan review.

**Safety:** Never execute the synthetic seed script on a user database. It inserts 100k records and is intended only for the CI-disposable Postgres container. This benchmark requires no production credentials or application services.
