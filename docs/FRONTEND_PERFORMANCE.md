# GQA v0.15 frontend performance and resilience

This milestone is an incremental refactor of the authenticated Next.js command center. It is not a complete rewrite or a measured scale certification.

## Implemented

- The main command center loads plans, memories and run history as three independently recoverable resources. If one endpoint fails, successful data remains visible and an error/retry action is shown.
- Each project-data fetch uses an AbortController. Switching projects or signing out invalidates old fetches so they cannot overwrite another project's content.
- Project selection clears project-specific records, search text and pending supersession forms synchronously, avoiding a transient display of another project's data.
- Browser Flow Studio uses the parent's already-fetched run history rather than making a duplicate GET to the same project /runs endpoint each time the command view mounts. A newly completed browser run is reported back to the parent to update both views without requesting the full history again.
- Browser flow, regression analytics, account security, team access and scenario review components use dynamic imports so users loading the sign-in page need not immediately parse those panel bundles.
- All mutations remain server-authorized. Project-scoped endpoint and fixed-fixture execution checks are unchanged.

## Verification expectations

- Run `cd apps/web && npm ci && npm run lint:types && npm run build`.
- Review the seven existing GitHub CI workflows on the exact final PR head before merging.
- Manual acceptance: switch between two projects repeatedly under slow network throttling; cancel and retry failed GETs; ensure unrelated project runs and pending correction IDs never appear on the new project.
- Confirm generating a browser test persists to the run history and shows in the smoke/flow views without an extra GET /runs.
- Compare JavaScript chunks and actual initial network requests before/after using Next.js build output and browser DevTools. **No quantified latency or bundle reduction is claimed without that measurement.**

## Remaining planned work

- Server-side cursor pagination for project memories, plans, runs, flows and search; current endpoint limits remain.
- A project-aware query/cache layer with explicit invalidation on memory corrections, repaired browser flows and role changes. Never share cached sensitive project data between authenticated accounts.
- A state-machine or feature-hook split of the monolithic command center, plus stronger deterministic UI E2E tests, accessibility audits, and large-project benchmarks.
- Stronger error/loading/skeleton conventions for every separately loaded panel, virtualisation of large lists and navigation persistence.
- Production isolation and multi-tenant auth/privacy controls remain entirely separate security work.
