# ADR 004 — One-shot job processes and bounded diagnostic evidence

Status: v0.7 implementation

## Problem

The existing Playwright supervisor executed every test inside one long-lived
Node.js process. An unexpected crash, runaway job or pollution of process
state might affect subsequent tests. Failure records contained only step
statuses, repair hints and a screenshot.

## Decision

- One HTTP supervisor authenticates requests and checks origin allowlists.
- For every accepted smoke or browser-flow job, it creates a new
  **short-lived child process** via Node's built-in child-process API.
- Job children only receive a small allowlist of environment variables;
  secrets from the parent supervisor are not forwarded.
- Each job has a 55-second supervisor timeout. The supervisor forcibly
  terminates the job's process group when it exceeds the budget.
- The complete verified checks return over an IPC channel; the Go API
  persists a sanitized JSON diagnosis and optional PNG screenshot.
- The maximum number of active jobs in this local worker remains one.
  Requests arriving while busy are rejected; there is no durable queue.
- Individual failure categories are **hints**, not proof of root cause.
  A successfully repaired locator still requires explicit review and
  revalidation of original business assertions.
- Only aggregate event counts are saved, not raw browser console errors,
  network payloads, URLs with query parameters, or page content.

## Limits and safety

Process separation improves lifecycle predictability but does not provide
hostile-code isolation. All jobs still share one Docker container and
kernel context, and Chromium's own sandbox is disabled. The worker is kept
on a private Docker network with no outside egress by default.

Before external or commercial use, implement short-lived containers/VMs
per execution, constrained egress for explicitly authorized staging
targets, multi-tenant authentication/authorization, secure secret
injection, quota management, access-controlled artifact storage,
audit logging and retention controls.

## Verification

- Node tests prove a new process is spawned per job, job IDs differ,
  secrets are excluded from the child environment, and hanging jobs time out.
- Go tests verify defensive sanitization of worker-supplied diagnostics.
- Docker tests check that smoke, browser and repaired runs have different
  job identities, failure classification is persisted, and the original
  approval restrictions and repair history still work.
