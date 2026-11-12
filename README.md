# GQA — AI Principal QA Command Center

GQA is a project-aware QA command center built with **Go + TypeScript**.

## Foundation milestone (v0.1)

Implemented in the initial branch:
- Create and switch between GitHub-backed projects.
- Save confirmed project memory (architecture, business rules, corrections, lessons, preferences).
- Supersede incorrect or outdated memories with an audit trail.
- Search project memories using PostgreSQL full-text search.
- Submit natural-language QA requests.
- Generate auditable, deterministic specialist-agent selection plans.
- Flag production and high-impact performance/security plans for approval.
- Display projects, plans and memory in a Next.js dashboard.

**Important:** v0.1 is a planning and memory prototype, not an autonomous test runner. No tests are executed and no AI model is called yet. Agent selection is rule-based and is designed to be replaced or augmented with a model-driven planner subject to the same policy gate.

## Local development

Requires Docker Desktop or Docker Engine with Compose.

```bash
docker compose up --build
```

Open http://localhost:3000 for the dashboard. The Go API runs at http://localhost:8080.

To run the backend tests without Docker:

```bash
cd apps/api
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

The next milestone is authenticated repository inspection and a sandboxed execution worker for real Playwright/API test runs with verifiable evidence.

## Repository layout

- `apps/api` — Go REST API, PostgreSQL persistence and routing policies
- `apps/web` — Next.js command center
- `compose.yaml` — local container stack
- `.github/workflows/ci.yml` — Go tests and frontend build checks
