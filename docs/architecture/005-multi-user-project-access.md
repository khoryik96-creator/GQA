# ADR 005 — User identities and per-project role checks

Status: implemented in GQA v0.8 as a local prototype

## Decision

- An initial global administrator is provisioned once from the local
  administrator credential; bootstrap never silently rewrites a user password.
- Additional users are created by a global administrator without public signup.
- Passwords are stored using bcrypt and are never returned in API responses.
- Random session tokens remain stored only as hashes; sessions now map to
  one concrete active user account and user identity is read on every request.
- Four project roles have explicit capability checks: owner, QA, reviewer
  and viewer. Global admin may manage all projects and user accounts.
- Project authorization is enforced on the server for **every route**,
  including direct screenshot IDs, repair histories and related resources.
- Project listing is filtered by membership for non-admin accounts.
- Membership updates and removals are audited with an actor, subject,
  previous role and new role; existing permissions are checked per request.
- Reviewing an already executed repair does not give the reviewer permission
  to create or execute new tests.
- A user's old session is still valid after project access revocation, but
  requests to the revoked project must immediately return a denial.

## Deliberate limitations

- Single local bootstrap admin (no delegated global admin creation).
- Accounts are created with an initial password directly, without email
  invitations, password resets, MFA, SSO, tenant/org boundaries or SCIM.
- No dedicated account suspension UI or user-facing security configuration.
- No authorization cancellation of already-running jobs.
- Per-project access checks are application-level: RLS is not yet enabled.
- This is not an authorization model for untrusted external customers.
- Browser worker process isolation remains weaker than disposable VM execution.

## Test expectations

- Anonymous API requests cannot read projects.
- A QA engineer's project list excludes other projects.
- A project member cannot read another project's memory or screenshot.
- Reviewers and viewers cannot modify memory or execute tests.
- A QA engineer may create plans and run tests but cannot manage members.
- Role changes take effect on the next request without re-login.
- Revoking membership blocks project access on the next request.
- Only a global admin can create accounts or projects.
- Access changes retain a project-scoped audit trail.
