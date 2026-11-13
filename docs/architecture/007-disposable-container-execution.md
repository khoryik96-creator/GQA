# ADR 007 — Local, opt-in disposable container execution

Status: experimental in v0.10

## Architecture

The default application path remains Go API → private Docker runner
→ one-shot child process. For opt-in development validation, a trusted,
host-installed Node.js broker replaces the runner endpoint:

Go API → token-protected host broker → fixed Docker CLI command
→ newly created disposable QA container → bounded JSON evidence
→ authenticated Go run history.

The host broker uses the installed Docker CLI on the developer's host,
not a socket bind mount inside any GQA application container. It receives
jobs only from the existing Go API on a token-authenticated endpoint and
still enforces an exact, fixture-only origin allowlist and typed Playwright
action validation. The broker is not reachable from the public internet by
design requirement; the host firewall must enforce this.

## Isolation controls

- Worker image is fixed to locally built gqa-job:local; pull prohibited.
- Each job has a generated ID and unique Docker container name.
- Every container is bound to the internal qa_execution network, with
  only two controlled demo fixtures present, not the API or DB.
- No bind mounts, volumes, Docker socket, open ports or ambient credentials.
- Runs as pwuser with read-only filesystem and temporary /tmp.
- Dropped Linux capabilities, no-new-privileges, bounded PID count, RAM,
  swap, CPU and shared memory.
- Single job at a time and a host-side timeout for the Docker CLI.
- The launcher performs forced best-effort cleanup after each job.
- Separate execution IDs are retained as sanitized run evidence.

## Why the broker is not containerized

Mounting the host's Docker control socket into a long-lived application or
browser worker can grant that service extensive host control. A compromised
container with Docker API access is not a bounded QA sandbox.

This design leaves Docker access in an explicitly started *host process*.
That is still a privileged trust boundary: compromise of the host broker
may control the local Docker daemon. The broker is not safe for production.

## Known limitations

- Host broker binds a TCP interface. External access must be firewalled;
  token authentication alone is insufficient for a public deployment.
- Docker's default runtime shares the host kernel.
- Browser sandbox is currently disabled.
- A killed Docker CLI process may leave a container if the follow-up cleanup
  attempt fails; periodic orphan-job reconciliation is future work.
- No Kubernetes scheduling, worker pool, per-tenant quotas or auto-scaling.
- No hardware or hypervisor VM isolation, resource billing or customer data
  retention policy.
- No durable queue or cancellation of active jobs on RBAC revocation.
- Only two controlled fixtures are allowed in this experimental mode.
- Not a commercial-grade hostile-code execution environment.

## Validation

- Node policy tests verify command argument construction and reject
  unapproved networks, images, target origins and script actions.
- Real CI uses Docker Compose to build the runner image, creates the isolated
  execution network, runs API and Playwright flows through the opt-in host
  broker, asserts fresh container identities and stored screenshot evidence,
  and verifies container cleanup.
