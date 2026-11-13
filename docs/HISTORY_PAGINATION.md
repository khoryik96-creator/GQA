# v0.15 — Paginated QA history

GQA supports opt-in bounded keyset pagination on all four project-owned list endpoints: `/memories`, `/plans`, `/runs`, and `/flows`.

## API contract

The original `GET /api/projects/{projectId}/{collection}` response remains a JSON array for clients not specifying pagination controls. Historical legacy caps are retained: memories 100, plans 50, runs 30, flows 30.

`?limit=25` returns `{"items":[...],"next_cursor":"..."}`, where an empty `next_cursor` denotes the end. Passing `?cursor=...` also opts in, defaulting to 25 records. Limits are 1–100. Malformed/oversized cursors and invalid limits return 400.

Pages are ordered by `created_at DESC,id DESC` (plans, flows, memories) or `started_at DESC,id DESC` (runs). UUID tie-breaking ensures stable traversal when timestamps coincide. The cursor encodes timestamp and UUID; it is **not** a permission token, and each page is authenticated and project-scoped independently.

New records inserted ahead of the cursor will not appear in subsequent older-page results until a fresh first-page request. Mutations may change status of a currently displayed record; clients should refresh to see canonical server state.

## Frontend

- The command center initially fetches 25 plans, 25 runs and 25 memories, each with an independent load-more cursor.
- Previous requests and execution history can show older pages without pulling the whole project history.
- Browser Flow Studio initially fetches 25 browser flows and can load older flows from the same project.
- New plan, browser flow and run writes still appear immediately in the current view. Project switches invalidate pending command-center history paging requests.
- The existing GET without pagination and all write contracts remain backward compatible.

## Tests and limits

The Go and Docker CI suites verify cursor bounds, page traversal, legacy response compatibility, correct item order and no duplicate IDs for plans/runs/flows and memories. No database schema migration is required.

This is a bounded retrieval improvement, **not a performance benchmark**. The old history composite indexes do not yet explicitly contain descending UUID tie-breakers. For sustained large datasets, measure actual `EXPLAIN (ANALYZE, BUFFERS)`, pagination latency (p50/p95/p99), 100k+ project records, and query index usage before claiming scalability.

Remaining engineering work: cursor filtering by plan for browser flows, keyboard-accessible data grids/virtualisation, browser UI E2E tests, typed cached project resource hooks and account-aware invalidation.
