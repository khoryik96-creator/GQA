# GQA — AI Principal QA Command Center

**Current main:** v0.13 (Regression Intelligence + Reliability Hardening) · **Production readiness:** local prototype only, not approved

GQA is a project-aware quality assurance command center built with a Go REST
API, PostgreSQL, a Next.js/TypeScript dashboard and isolated Node/Playwright
test runners. It can plan QA coverage against explicit project context,
inspect public GitHub repositories, run restricted demo-fixture checks,
review browser flows, and retain test results and verified corrections.

> **Do not expose GQA publicly or test untrusted websites.** The default
> Docker stack is intended for trusted local use. The experimental Docker
> execution broker can control your host's Docker engine and must stay
> firewall-protected. It is not a safe external customer-testing service.

## Current capabilities

| Area | Available in v0.11, or in the linked draft branches |
| --- | --- |
| Projects and memory | Multiple projects, confirmed/corrected requirements and project-level QA lessons |
| Planning | Deterministic principal-QA agent routing and structured test specifications; optional configured LLM provider |
| Repository inspection | Read-only inspection of **public** GitHub repositories |
| Test execution | Approved API GET and browser smoke tests against bundled local fixtures |
| Browser flows | Reviewable, typed Playwright actions with exact-digest acknowledgement and stored screenshots |
| Repair suggestions | Human-reviewed accessible-name locator corrections, verified by replay without relaxing assertions |
| Access control | Individual password-hashed accounts, per-project owner / QA / reviewer / viewer roles, administrator controls |
| Default worker | One-shot test processes inside a resource-limited, private-network Docker worker |
| Optional broker | Fresh disposable Docker containers for bundled fixtures, with FIFO queue, cancellation and restart recovery |

Not implemented: autonomous end-to-end testing of arbitrary websites, native
mobile testing, distributed workers, real external staging egress controls,
enterprise organizations/SSO/MFA, production security review or hardened VM
isolation. The initial planner **does not require an LLM**; without a configured
provider it uses explicit deterministic rules.

## Get started locally

Requirements: **Docker Desktop / Docker Engine with Compose**, Git and
sufficient memory to start PostgreSQL, Next.js, Go and Chromium containers.
Windows PowerShell commands:

```powershell
git clone https://github.com/khoryik96-creator/GQA.git
cd GQA
Copy-Item .env.example .env
notepad .env
```

Fill in **four** independent secrets: `GQA_ADMIN_PASSWORD`,
`GQA_RUNNER_TOKEN`, `GQA_DB_APP_PASSWORD` and `GQA_DB_ADMIN_PASSWORD`.
Use a fresh random 32+ character URL-safe value for each database password
on a **new** installation. On an **existing database volume**, set
`GQA_DB_ADMIN_PASSWORD` to the original PostgreSQL bootstrap password
used when the volume was first initialized. Docker Compose cannot change
an existing PostgreSQL role password by changing this environment variable. On existing installations, add the new database application
password to your existing `.env`; do not replace or remove the PostgreSQL
volume. A one-shot migration container creates the limited application
database role while preserving existing records. The initial administrator password must be **16–72
bytes**, and the runner token must be at least 24 characters. **On existing
installations, preserve your original PostgreSQL bootstrap password**.
The migration task uses the original database owner and creates a new
limited `gqa_app` runtime account. Do not attempt to change the existing
PostgreSQL role simply by updating `GQA_DB_ADMIN_PASSWORD` in `.env`. Never commit
`.env`, share the runner token or place credentials inside project memory.

Then start the default, **non-experimental** stack:

```powershell
docker compose up --build -d
docker compose ps
```

Open **http://localhost:3000**. Log in with:

- Email: `admin@gqa.local`
- Password: the value you configured for `GQA_ADMIN_PASSWORD` on the
  **first** startup of this database.

The admin account is bootstrapped only when the database has no accounts.
Changing `GQA_ADMIN_PASSWORD` in `.env` after account creation does **not**
reset the existing account. Use **Account security** in the dashboard to
change an existing account password. Existing v0.6 login sessions must sign
in again after the v0.8 user migration.

The Go API is at **http://localhost:8080** (loopback only).

## First verified QA run

1. Sign in as administrator and create a project. Supply a **public**
   GitHub repository URL and select its application type.
2. Optionally inspect the repository and record confirmed requirements or
   project conventions under **Project Memory**.
3. Generate a QA plan for a homepage or API health check; review the
   selected agents, environment and approval warnings.
4. Execute approved smoke checks against the bundled test fixture
   `http://fixture:8081`. Review the saved checks and screenshot.
5. Under **Browser Flow Studio**, draft a test that clicks **Show details**,
   review its steps and acknowledge its exact digest before running it.
6. To try controlled locator repair, use the second fixture origin
   `http://fixture-renamed:8081` and review the failed action, proposed
   correction, successful replay and optional recorded QA lesson.

Production and high-impact plans cannot execute active tests in this build.
A real application failure is never automatically marked as passing.

## v0.12 — Regression Intelligence (merged)

The **Regression Insights** tab groups completed runs of the **same smoke
plan or immutable browser flow against the same target origin**. It compares
the latest two recorded results and distinguishes newly observed failures,
pass-to-fail regressions, repeated failures, recovered checks and stable runs.

A 200-run window is used. When older results were excluded, a truncation
warning is displayed. Recent alternating outcomes are marked as *outcome
switching*, not diagnosed as confirmed test flakiness. A changed/repaired
flow has its own baseline; it is not automatically counted as recovery of
a different flow. GQA never changes expected assertions from analytics
and never executes additional tests to produce the report.

The endpoint `GET /api/projects/{id}/quality` is read-only and uses the
same server-side project role restrictions as other project history.
In v0.13, worker timeouts, invalid runner evidence and Docker
failures are reported separately as **infrastructure interruptions**, never
automatically classified as product regressions.

## v0.13 — Reliability hardening (merged)

[Merged hardening PR #14](https://github.com/khoryik96-creator/GQA/pull/14)
builds on [merged Regression Intelligence PR #13](https://github.com/khoryik96-creator/GQA/pull/13).
It strengthens post-action assertions, complete worker-evidence validation,
runner concurrency, broker journal ownership, async result retention,
abandoned-run reconciliation, audit attribution, per-account login throttling,
opt-in evidence retention, safer database privileges and a separated
database network. The status of **each audited finding**, along with
residual limitations, is in [Hardening Audit](docs/HARDENING_AUDIT.md).

Test execution and model planning are rate-limited per project and account
in the single-node API. Default local runtime retains a fixed fixture
allowlist. The administrator can optionally view durable broker checks
and screenshots from the job monitor. The broker remains privileged and
**must not** be exposed publicly.

For screenshot retention, `GQA_EVIDENCE_RETENTION_DAYS=0` (default)
disables automatic deletion. A positive value enables deletion of old
screenshots, not project run records; use only after agreeing retention
requirements and verifying backups.

**This release is not a production security certification.** High-assurance
execution isolation, multi-instance coordination, account recovery,
application-build attestation and enterprise tenancy still require separate
work.

## Team roles and account security

A global administrator can provision user accounts and create projects.
Within a project, an **owner** can administer members and run tests, a
**QA engineer** can write and execute tests, a **reviewer** can approve
verified corrections, and a **viewer** has read-only access.

Account creation is **administrator-only**: no self-registration.
The **Team Access** panel allows member role changes and audit history.
The **Account security** panel supports password changes and revocation
of sessions across browsers. Administrators may suspend or recover ordinary
member accounts. Requests are protected with server-enforced project
permissions and origin-checked cookie sessions.

## AI planning is optional

The default QA planner is deterministic and labelled as such in the UI.
An OpenAI-compatible chat completions provider can be configured through
`GQA_LLM_CHAT_COMPLETIONS_URL`, `GQA_LLM_MODEL` and `GQA_LLM_API_KEY`.
`GQA_LLM_SEND_PROJECT_CONTEXT` controls whether project context may be sent
to the provider and defaults to `false`. Do not send sensitive company
information to an external provider without authorization.

The specialist execution engine and LLM planner are separate. Connecting
a model does not grant it autonomous shell commands or permission to run
tests against external targets.

## Experimental disposable-container mode (opt-in)

The default runner uses fresh Node processes in a dedicated Compose
container. The v0.10–v0.11 alternative launches a **new restricted Docker
container per test** using a **host-side** broker with access to the host's
Docker CLI. The broker is privileged, can reach the host Docker engine and
requires a firewall-protected host interface; it does **not** run inside a
GQA app container with a mounted Docker socket.

This optional mode currently permits only the two built-in demo fixtures
on the isolated `gqa_qa_execution` network. It does **not** support
external websites, production applications or untrusted content.

For full PowerShell startup, reversal and job-management endpoints, see
[the v0.10–v0.11 operating instructions](docs/version-history.md). The
administrative job monitor additionally requires
`GQA_JOB_MANAGEMENT_ENABLED=true` and the fixed host-broker address.

## Development and verification

| Component | Command |
| --- | --- |
| Go unit tests and static analysis | `cd apps/api && go test ./... && go vet ./...` |
| Web typecheck/build | `cd apps/web && npm install && npm run lint:types && npm run build` |
| Browser runner tests | `cd apps/runner && npm test` |
| Host broker tests | `cd apps/host-broker && npm test` |
| Full stack | `docker compose up --build -d` |

GitHub Actions workflows cover the foundation, Docker integration,
experimental disposable-container integration, release safety rules and
additional dependency/static security checks. A passing CI run is
not a security certification or approval to deploy customer-facing GQA.

GQA v0.11 was consolidated into `main` through
[merged PR #12](https://github.com/khoryik96-creator/GQA/pull/12).
v0.12 Regression Intelligence was merged through [PR #13](https://github.com/khoryik96-creator/GQA/pull/13),
and v0.13 reliability/security hardening through [PR #14](https://github.com/khoryik96-creator/GQA/pull/14).
[PR #15](https://github.com/khoryik96-creator/GQA/pull/15) is an alternative,
divergent hardening implementation, not an additional release to merge blindly.

## Documentation

- [Historical milestone instructions, v0.1–v0.11](docs/version-history.md)
- [Release acceptance checklist](docs/RELEASE_CHECKLIST.md)
- [Architecture and threat boundaries](docs/architecture/)
- [Security policy and reporting](SECURITY.md)
- [Audit finding remediation and residual risks](docs/HARDENING_AUDIT.md)

**Data retention:** local PostgreSQL and screenshots persist across ordinary
`docker compose down` / `up`. Running `docker compose down -v` **deletes
named volumes** and can destroy local projects, accounts and evidence.
Back up your volumes before resetting the stack.
