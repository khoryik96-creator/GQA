# ADR 008 — Host-broker lifecycle, cancellation and crash recovery

Status: experimental, GQA v0.11.

## Design

The v0.10 host broker already used the Docker CLI to start a restricted,
short-lived test container and return result JSON. In v0.11, the host
broker owns an atomic, local job journal and one-worker FIFO scheduler.

Job records contain a generated UUID, a previously validated typed
fixture-job specification, state, timestamps and bounded diagnostic summary.
They **never** contain API tokens, session cookies, raw screenshots,
network data or model credentials. The journal is held in an ignored,
locally permissioned directory, with atomic write-and-rename. A corrupt
or symlinked journal causes startup failure.

## State and transitions

- Submission: queued (persisted before container creation).
- Launch: running (persisted before invoking Docker).
- Success: passed, or failed if any check failed.
- Pending queued cancellation: cancelled.
- Active cancellation: cancelling → cancelled after the container is
  stopped and evidence is collected or a failure result is returned.
- Broker restart with a running/cancelling job:
  recovery_pending → interrupted only after exact-name cleanup.
  Any cleanup failure blocks broker startup; the job is never
  automatically replayed.
- Queued jobs survive restarts and are resumed FIFO after reconciliation.
  Previously running work is *not* retried implicitly.

The history stores only a bounded number of terminal job summaries. The
ordinary Go project-level test run remains authoritative for step results,
screenshots and project permissions.

## Authorization

- Host broker queue/status/cancel endpoints require the internal token.
- The Go API exposes only a limited **global administrator** proxy for
  status and cancellation, and only when explicit feature opt-in is set.
- The proxy has a fixed trusted host-broker address. No user-supplied URL
  or Docker arguments are forwarded.
- The browser-facing Team Access UI invokes those admin-only API routes.
- The host broker must remain firewalled and limited to approved development
  machines; token-based access is not sufficient to make it public.

## Safety and limitations

- A host-side Docker-capable broker is a privileged local process.
  No Docker socket is mounted inside the web app, Go API or test workers.
- The worker can execute only fixed typed actions against bundled fixtures.
- The scheduler has eight pending slots and one active container. The
  synchronous API preserves prior immediate-execution/busy semantics.
- Cancellation uses process termination and forced best-effort cleanup;
  if Docker refuses cleanup the broker reports failure rather than
  claiming the test completed.
- The journal's test steps may contain example field values. Keep the
  directory private and free of real credentials/PII.
- This prototype does not guarantee exactly-once execution across all
  crashes or networks. It is **not** a multi-host distributed job queue.
- The local worker containers are not microVMs, and Chromium's own
  sandbox is still disabled.

## Tests

Unit tests cover journal persistence and redaction, FIFO scheduling,
queue limits, queued/running cancellation, restart reconciliation,
cleanup failure and corrupt state. GitHub Actions exercises real
disposable containers, authenticated asynchronous job status, admin
proxy responses, journal persistence and broker restart.
