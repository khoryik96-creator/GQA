# ADR 003 — Local authentication and browser worker boundary

Status: implemented as an incremental v0.6 security hardening milestone.

## Scope

- Single administrator: an explicit strong password in an untracked local
  environment file. Session tokens are random 32-byte values, with only
  digests in PostgreSQL and revocation on logout.
- All /api/ resources require an authenticated, unexpired session except the
  login entrypoint. The public /healthz endpoint is for local container checks.
- Mutating requests must carry the exact trusted frontend Origin. Session
  cookies are HttpOnly, SameSite Strict and path-bound to /api.
- The browser worker runs non-root with no added capabilities, no-new-privileges,
  a read-only root filesystem, temporary writable /tmp, resource and PID
  limits, and fresh browser contexts/processes per execution.
- Default browser test egress is restricted through an internal-only Docker
  network that contains only controlled test targets, the worker and the API.
- WebSockets are blocked by the Playwright context routing layer.
- An internal runner token is independent of the administrator credential.

## Threat model and residual risks

The local administrator has complete control of all configured projects.
This is not multi-user authentication, SSO, permission delegation or
tenant isolation. Failed login throttling is in process, not distributed.
Session expiry checks do not immediately terminate already-running jobs.

The current Playwright browser uses Chromium with its sandbox disabled.
Fresh browser instances are **not** equivalent to independent ephemeral
containers/VMs, and browser engine vulnerabilities could threaten the runner.
Therefore the application is not approved for untrusted sites, external
customers or internet-facing deployment.

Dedicated per-job ephemeral VM workers, kernel-level egress restrictions,
a secrets manager, HTTPS, organization-scoped RBAC and formal security
assessment remain required before commercial operation.

## Tests

- Invalid/missing Origin is rejected on writes.
- Anonymous /api requests are denied; health checks remain public.
- Cookie flags, password policy and per-IP login throttling are verified.
- Docker integration runs with fresh generated secrets, authenticates,
  performs existing browser/test/memory workflows, denies a forged origin,
  logs out and confirms the old session is no longer valid.
- The Docker integration also runs browser tests in the private worker
  network with read-only root filesystem and dropped capabilities.
