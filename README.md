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
