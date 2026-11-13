# Memory list pagination (v0.15)

The project memory API preserves the legacy response for clients that omit pagination arguments:
`GET /api/projects/{id}/memories` returns an array of up to 100 items.

New clients can request keyset pages:
`GET /api/projects/{id}/memories?limit=25&q=term&cursor=...`

The response is `{"items":[...],"next_cursor":"..."}`. An empty cursor means there is no further page. Limits range from 1 to 100. The cursor is an opaque, unsigned, base64url-encoded pair of the final record's `created_at` and UUID. It contains **no auth token**. It is a navigation pointer, not a grant of access. Every request independently requires a live session and project authorization, and the SQL query always filters by project ID.

Records are sorted by `created_at DESC,id DESC`; the compound tie-break prevents losing records created at identical timestamps. Cursor pagination can include newly inserted records only on a refreshed first page, which is expected for descending keyset pagination. Search uses the existing PostgreSQL full-text search document. Changing the search term starts a fresh query; clients must not combine old cursors with a new filter.

The dashboard initially fetches 25 memory rows rather than 100, offers a Load More action, retains successful pages on a failed new search, and suppresses stale project-switch responses. Legacy consumers are unaffected. A separate, future project-scoped caching layer and cursor pagination for plans/runs/flows remain on the backlog.

## Verification

Go unit tests cover malformed cursors, bounds, cursor round trips, and nullable query arguments. Docker integration seeds more than one page, validates exhaustive unique search results, rejects malformed cursors, checks legacy array compatibility and verifies other projects do not see the seeded records.

This is not a large-data performance benchmark and does not yet add a composite migration index for the mixed full-text/order-by workload. Profile with real dataset sizes before declaring scale readiness.
