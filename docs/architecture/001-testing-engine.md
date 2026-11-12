# Architecture Decision 001 — Universal QA execution engines

Status: accepted for GQA v0.3

## Context

GQA's mission is project-aware, persistent software quality engineering across web, mobile,
API, backend, performance and security. It must preserve lessons and corrections while providing
auditable evidence from actual testing tools.

The Bug0 AI repository (https://github.com/bug0inc/qa-agent) is useful prior art
for natural-language Playwright automation, cache-first actions, healing attempts,
assertion arbitration and test video analysis. Its source uses the Functional Source
License (FSL-1.1-Apache-2.0) with restrictions on competing commercial uses before the
version-specific future-license conversion date. This document does not confer
permission to incorporate that code into GQA.

## Decision

1. Keep the platform control plane in Go, Next.js/TypeScript and PostgreSQL.
2. Use separately deployed TypeScript Playwright workers for browser automation.
3. Independently implement browser-specific methods; do not copy Bug0 source,
   prompts, model logic or FSL-covered code into GQA.
4. Treat AI-generated testing steps as untrusted, reviewable proposals.
5. Permit execution only through validated, typed browser actions, a scoped
   execution adapter, an approved test target and isolated workers.
6. Prefer hard assertions (HTTP status, DOM locator expectations, API schema,
   database invariants) over model-only verdicts.
7. Only try self-healing after capturing the original failure. Revalidate
   the unchanged expectation before proposing a reusable locator update.
8. Scope any action cache by project, environment, app/commit version,
   test identity and step identity. Add expiration and explicit invalidation.
9. Keep model disagreement visible. Do not convert consensus alone into a
   verified test pass.
10. Persist prompt, review decisions, cases and evidence with provenance.

## Implementation sequence

- **v0.3:** Structured test scenario plan, model provider boundary,
  memory provenance, human review and deterministic fallback.
- **v0.4:** Typed natural-language browser actions, domain allowlists,
  validated execution plan and real Playwright evidence.
- **v0.5:** Audit-first healing, versioned step cache, flaky failure triage.
- **v0.6:** Optional visual/video assertions and multi-model verification,
  with budgets and explicit cost limits.

## Security constraints

The present proof of concept is local-only, unauthenticated and not suitable for
untrusted users or public internet exposure. Before expanding browser automation
beyond fixed smoke checks, add authentication, finer-grained authorization,
process isolation, network egress policy, strict action schemas, secrets handling
and per-run quotas.
