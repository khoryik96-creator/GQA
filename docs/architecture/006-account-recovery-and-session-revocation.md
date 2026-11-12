# ADR 006 — Password lifecycle and session revocation

Status: implemented in v0.9 (local prototype only)

## Invariants

- User password updates require the caller's current password.
- Bcrypt hashes are used for password verification and rotation; the old
  password cannot be reused, and new password length must be 16–72 bytes.
- Administrative reset is limited to a global admin acting on a
  non-admin member. Self-reset and admin-to-admin resets are not permitted.
- Account suspension is limited to a global admin acting on a member,
  using one of four predetermined audit reason categories.
- Password change, admin reset, account suspension and reactivation revoke
  all active sessions for the affected account.
- User-row locking in a transaction keeps credential updates and revocation
  tied to a consistent account state.
- The existing authentication middleware checks active account status
  and session revocation on each request.
- An account security audit record identifies actor, subject, action,
  enumerated reason and timestamp — never passwords or raw tokens.

## Security boundaries

- Admin password bootstrap from .env occurs only on a fresh installation;
  rotating that environment variable is *not* a password recovery procedure.
- There is no end-user password reset without the current password. A global
  admin can reset the password of an ordinary member account.
- Global admin must update their own password using the authenticated
  self-service change-password endpoint.
- Already-running work is not interrupted on revocation.
- In-process login throttling is not a shared, distributed rate limiter.
- The application remains local-only, with no MFA, SSO, HTTPS termination,
  public account recovery, hardware-backed credential management, or
  disposable per-run containers/VMs.

## Planned worker infrastructure

Do not mount /var/run/docker.sock inside GQA's browser test worker.
A future dedicated job broker should create short-lived, restricted worker
containers or microVMs, apply project/environment-specific egress policy,
and collect artifacts through a narrow authenticated channel. This must be
deployed and tested as a separate trust boundary. The v0.9 implementation
retains the internal-network, read-only-filesystem single-process lifecycle
from v0.7 and v0.8, rather than claiming stronger isolation.

## Verification

Go policy tests reject invalid password lengths and write requests without
the approved Origin. Docker integration tests:
- create two sessions for a member;
- suspend the member and deny both sessions and login;
- reactivate the member;
- rotate the member password and deny all existing sessions and old password;
- reset their password as administrator and require new login;
- revoke all their sessions via self-service;
- verify audit records contain security events but not credentials.
