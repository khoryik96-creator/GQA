# GQA — AI Principal QA Command Center

GQA is a project-aware QA command center built with **Go + TypeScript**.

## Foundation milestone (v0.1) and context-aware smoke milestone (v0.2)

Implemented in the initial branch:
- Create and switch between GitHub-backed projects.
- Save confirmed project memory (architecture, business rules, corrections, lessons, preferences).
- Supersede incorrect or outdated memories with an audit trail.
- Search project memories using PostgreSQL full-text search.
- Submit natural-language QA requests.
- Generate auditable, deterministic specialist-agent selection plans.
- Flag production and high-impact performance/security plans for approval.
- Display projects, plans and memory in a Next.js dashboard.

**v0.2 additions:**
- Inspect a public GitHub repository's default branch and file tree, detecting technology and testing conventions.
- Consult **confirmed, non-superseded project memory** while selecting specialist agents, and record which memories were used.
- Execute bounded, read-only API health and Chromium homepage smoke checks in a separate Docker runner container.
- Preserve test execution outcomes and (when available) browser screenshot evidence.
- Enforce an exact test-target allowlist and deny execution of plans involving production or high-impact approvals.
- Run runner policy unit tests in CI.

**Scope:** GQA is still an early local prototype. The planner is deterministic, **not yet LLM-driven**, and the browser runner is a long-lived Docker service (not yet per-job ephemeral/enterprise isolated). This does **not** yet test an application's full workflows, native mobile apps, security or performance. Do not use this build on untrusted websites or expose it publicly.

## Local development

Requires Docker Desktop or Docker Engine with Compose.

```bash
docker compose up --build
```

Open http://localhost:3000 for the dashboard. The Go API runs at http://localhost:8080.

### First real smoke run
1. Create a project with a **public** GitHub repository URL.
2. Use **Inspect public GitHub repository** to collect stack and test-file evidence.
3. Save a business requirement or correction under **Project Memory**.
4. Generate a QA plan using a prompt that selects Web QA or API QA (a full-stack project selects both).
5. Use **Execute safe smoke checks** with the default target `http://fixture:8081`.

The worker runs an actual HTTP GET against the built-in fixture and, for plans with Web QA, launches Chromium to check the fixture homepage. Results are persisted; a browser screenshot is saved when available.

**Your own staging target:** the API and runner must both receive an exact approved origin in `GQA_SMOKE_TARGETS` (comma-separated list). Only the built-in fixture is allowed by default. External staging smoke checks are not a substitute for complete QA and should only be run on systems you own or are authorized to test.

To run the backend tests without Docker:

```bash
cd apps/api
go mod tidy
go test ./...
```

To run the frontend independently:

```bash
cd apps/web
npm install
npm run dev
```

Set `NEXT_PUBLIC_API_URL=http://localhost:8080` for local development.

## Security boundary

The prototype API is **unauthenticated and strictly local-only**; ports are bound to 127.0.0.1. Never expose this build on a public server. The Docker database password is for local development only. Do not commit secrets or use production credentials in project memory.

The next milestone is authenticated access for private repositories, authenticated platform users, real application-specific test specifications, and ephemeral, network-restricted test workers.

## Repository layout

- `apps/api` — Go REST API, PostgreSQL persistence and routing policies
- `apps/web` — Next.js command center
- `compose.yaml` — local container stack
- `.github/workflows/ci.yml` — Go tests and frontend build checks

## v0.3 — Structured principal QA planning

GQA generates a **reviewable test specification** with a strategy, ranked scenarios (P0-P2), preconditions, execution steps, expected results, missing inputs and confirmed project-memory references. Planning output is **not executable code** and does not count as test execution.

The default planner is deterministic and displays **rules** as the generation mode. Optionally enable an OpenAI-compatible chat completions provider to generate more contextual scenarios. The API validates every model scenario against the selected agents and existing memory IDs, overwrites untrusted status/ID fields and falls back to a rules-based plan if the provider fails.

Create a root `.env` file for Docker Compose (never commit it):

```dotenv
GQA_LLM_CHAT_COMPLETIONS_URL=https://your-approved-provider.example/v1/chat/completions
GQA_LLM_MODEL=your-approved-model
GQA_LLM_API_KEY=your-private-provider-key
GQA_LLM_SEND_PROJECT_CONTEXT=true
```

**Privacy:** The opt-in is required because the model receives the request, selected agent descriptions, repository metadata and confirmed project-memory excerpts. Keep sensitive customer information out of project memory unless your provider, consent and data handling policies permit transmitting it. The application remains local-only and unauthenticated.

The model is used only to **draft scenarios**. It cannot approve production testing, execute scripts, change agent permissions or claim that anything has passed. The action runner remains policy-controlled and restricted to its fixed smoke operations.

## v0.4 — Reviewed natural-language browser flows

1. Choose or create a QA plan with a **Web QA** agent.
2. Open **Browser flows** and type a natural-language request.
3. GQA drafts a **typed action sequence** (deterministic demo flow by default, optional model-assisted drafting when the v0.3 provider is configured).
4. Review each path, locator, input and assertion. The UI requires explicit acknowledgement of the exact saved flow digest.
5. Execute against the allowlisted fixture `http://fixture:8081` or an explicitly approved test origin.
6. Inspect individual Playwright step results and the browser screenshot.

Supported actions: navigate to a relative path, click a button/link by accessible name,
fill a labeled non-secret test field, assert visible text, assert an accessible element,
and assert the URL path. **No model-generated JavaScript is evaluated.**

The local fixture supports prompts such as "Open the homepage, click Show details and verify
the detail panel is visible" or "Fill email and preview it." Without a model provider,
these **demonstration flows are fixture-specific**, not inferred journeys in
arbitrary external apps. A configured model can draft typed actions but cannot
verify DOM locators it has not observed.

To target an authorized staging site, add its **exact origin** to `GQA_SMOKE_TARGETS`
in **both** the API and runner environments. The runner blocks cross-origin requests
and non-GET browser traffic. This local-only demo is not an enterprise sandbox; do not
expose it publicly or run it against untrusted targets. Production and high-impact
plans remain disabled.

### Roadmap after v0.4

- v0.5: isolated ephemeral runners, versioned cache, evidence-first self-healing,
  flaky-test classification and authenticated project permissions.
- v0.6: optional semantic/visual assertions, multiple-model arbitration and budgets.

## v0.5 — Evidence-driven locator repair and historical lessons

GQA records failures before making any repair suggestion. A renamed accessible
button/link can produce a **possible locator repair** only when the original
locator no longer resolves and exactly one sufficiently similar visible label
exists. The runner does not edit actions, bypass assertions or retry silently.

### Demonstrate the repair workflow

1. Create a full-stack project and a Web QA plan.
2. In Browser Flow Studio, draft a flow mentioning **Show details**.
3. Run it against `http://fixture-renamed:8081` (a second included fixture where
   the button was deliberately renamed to **Reveal details**). Review the
   original actions and digest before executing.
4. Inspect the failed browser step and its tentative locator suggestion.
5. Click **Create reviewable repair proposal**. This produces a **new immutable
   flow**, changing only the clicked button's accessible name. All original
   assertions are retained. It is not automatically executed.
6. Review the new flow digest, authorize the same target, and replay it.
7. After a passing run, enter an application revision and explicitly
   choose **Confirm and save verified repair**.

GQA stores the original failed run, revised flow, passing replay, reviewer
confirmation, application revision, an audit trail, a project lesson, and
a **14-day version-scoped cache hint**. The cache hint is informational: GQA
does **not** automatically reuse corrected locators across versions or silently
modify other tests.

### Current limits

- Repair suggestions are restricted to accessible names of **buttons and links**.
- Suggestions are similarity-based, not proof that a changed UI remains correct.
- No automated regression classification, flaky-test detection, full visual
  comparison, or autonomous multi-step fixing yet.
- Production and active testing restrictions are unchanged.
- The application remains a local-only unauthenticated prototype. Never
  expose it publicly or test systems without authorization.

v0.6 should add robust auth and per-run isolation before expanding autonomy,
alongside optional semantic/visual assertions and trace-based failure analysis.

## v0.6 — Local administrator access

**Breaking local startup change:** the API now rejects startup without an
administrator password and a separate internal runner token. Configure once:

```powershell
Copy-Item .env.example .env
```

Edit `.env` and replace **both** example placeholders with unique, random,
secret strings. The administrator password must be 16–256 characters and the
runner token at least 24 characters. The `.env` file is ignored by Git.
Then run `docker compose up --build` and open http://localhost:3000.

The web dashboard displays an administrator login screen. API operations
(including screenshots, memory, plans and test execution) require a
session cookie issued after successful login.

Sessions are valid for up to 12 hours, are invalidated on logout and are
stored as hashed random tokens. Cookies are HttpOnly, SameSite Strict,
and scoped to `/api`. All state-changing API calls require an exact
approved frontend Origin header. Authentication is rate-limited per
direct source IP for repeated failures.

For a TLS-reverse-proxied deployment, set `GQA_COOKIE_SECURE=true` and
provide an HTTPS `ALLOWED_ORIGIN`, but **do not publicly deploy this build**.
It is a **single-administrator local prototype**, not multi-user SSO,
multi-tenant RBAC or a production security review.

Only the API and web ports are bound to local loopback in Docker Compose.
The internal runner remains on the Compose private network.

### Restricted browser worker (v0.6)

The Playwright runner and both controlled demo fixtures now reside on a
dedicated Docker `internal: true` network. This prevents the browser worker
from reaching arbitrary external services even if a page tries to bypass
Playwright request routing. The Go API connects to both the application and
test networks, allowing GitHub/approved model connectivity while communicating
with the protected runner.

The runner also uses a read-only root filesystem, a temporary writable
`/tmp` mount, non-root user, dropped Linux capabilities, no-new-privileges,
process/memory/CPU limits, per-run fresh browser processes and blocked WebSockets.
The API-to-runner token is configured separately in `.env`.

**External staging targets cannot be executed on the default private worker.**
External target execution requires a future dedicated, egress-controlled runner
pool and authorization policy. Do not bypass this restriction by attaching
the worker to the host network or mounting the Docker socket.

These are **defense-in-depth controls, not a complete browser sandbox**:
Chromium's own sandbox is disabled in this early worker and a compromised
browser process could still reach other containers on the private test network.
Untrusted websites, customer data, public hosting, multi-admin RBAC and
commercial deployment remain unsupported.


## v0.7 — One-shot test processes and redacted failure intelligence

GQA now starts a **fresh Node.js child process for each approved API smoke
or browser-flow execution**. The authenticated Go API sends the authorized
request to the long-lived supervisor; the supervisor launches one job process,
waits for the result, terminates timed-out jobs and records a distinct job ID.

The worker child receives an explicitly restricted environment. API keys,
database URLs, administrator credentials and the supervisor's runner
authentication token are not passed into the subprocess. The parent runner
still has the per-container CPU, memory, PID and network limits introduced
in v0.6.

**Important:** short-lived processes are **not** disposable containers or VMs.
They share the worker container's filesystem, kernel, UID and network
namespace. Chromium itself still uses the no-sandbox option. This release
does not authorize testing untrusted websites, external customers, or
public deployments.

### Diagnosing failures

The test-run history includes a sanitized diagnostic summary:

- Execution mode and unique run-job identifier
- Failure category (for example, assertion mismatch or possible locator rename)
- Which typed browser step failed
- The last safe URL path, without query parameters
- Counts of browser console errors, uncaught page exceptions,
  failed same-origin requests and HTTP 5xx responses
- Existing step-by-step results, screenshots and repair provenance

Raw console messages, network bodies, headers, cookies, credentials,
request query strings, and arbitrary JavaScript traces are **not**
persisted in diagnostic fields. These aggregate signals support
investigation, but are not independently verified root-cause conclusions.

The supplied Docker integration suite verifies fresh job identifiers
across separate tests, the failure category for a deliberately renamed
button, and the success of a reviewed replay.

**Not implemented yet:** disposable per-test VM/container orchestration,
multi-user project permissions, semantic visual analysis, durable job queues,
browser sandboxing and production-grade evidence retention policies.


## v0.8 — Multiple users and project-scoped access

GQA now supports separately authenticated accounts and explicit project roles.
The platform administrator is bootstrapped on first startup using the existing
`GQA_ADMIN_PASSWORD` in the local `.env` file with email
`admin@gqa.local`. **This is a one-time bootstrap:** password changes to
`.env` after the account is created do not overwrite the stored password.
The initial password must be 16–72 **bytes** for bcrypt.

All previously issued v0.6 single-admin sessions are invalidated by the
v0.8 migration. Sign in again with `admin@gqa.local` and the original
administrator password. Existing projects, plans, tests and memories remain
in the same PostgreSQL database. Global admins retain access to existing projects.

### Provisioning a teammate

1. Sign in as `admin@gqa.local`.
2. Open a project and select **Team Access**.
3. Under **Create teammate account**, enter an email address and a unique
   16–72-character password; communicate the credential securely.
4. Assign their existing account to that project with one of the four roles.
5. Ask the teammate to sign in using their own account email and password.

Accounts are **created only by the global administrator**. Project owners
can assign existing accounts, change their project roles and revoke access.
Role changes are audited, checked on every request and take effect without
requiring the affected person to sign out.

### Permission matrix

| Action | Global admin | Project owner | QA engineer | Reviewer | Viewer |
| --- | --- | --- | --- | --- | --- |
| View allowed project, history, tests and screenshots | Yes | Yes | Yes | Yes | Yes |
| Create and modify QA plans, memory and test flows | Yes | Yes | Yes | No | No |
| Execute approved smoke/browser tests | Yes | Yes | Yes | No | No |
| Confirm previously passed repair proposals | Yes | Yes | No | Yes | No |
| Assign or revoke project membership | Yes | Yes | No | No | No |
| Create project and account | Yes | No | No | No | No |

A member can see only projects to which they have been assigned. An
unassigned account has **no project access**, even if that account can
authenticate. Screenshot routes check the actual run's project before
delivering any image.

All project-member changes are recorded in `project_access_audit` with
actor, target account, previous role, new role and timestamp. Owners cannot
downgrade or remove their own membership through the team-management API.

### Remaining security work

This is an **early local multi-user RBAC implementation**, not commercial
multi-tenant security. It does not have organizations, self-service password
resets, password invitations, email confirmation, MFA, SSO, distributed
rate limits, external staging worker pools, formal security assessment,
disposable VM execution or strong browser isolation. Tests already started
may finish even after a member is revoked. Do not publicly deploy GQA.
