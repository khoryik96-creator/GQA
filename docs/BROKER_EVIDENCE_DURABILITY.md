# Broker result durability and crash reconciliation (v0.17)

The experimental host broker remains **local-only and fixture-only**, not safe for untrusted public sites.

## Guarantees added

- The result store fsyncs the **directory entry** after atomically renaming a newly written result. The JSON file was already fsynced before rename. This reduces the window in which sudden host power loss can lose a reported result.
- Stored result files are checked for exact expected shape, evidence identity, status and size before they can be served. Truncated JSON, unexpected job IDs or symlink files are rejected, never interpreted as passed QA work. The HTTP evidence endpoint returns a generic retryable **503** on corrupted/unreadable evidence rather than crashing the host broker or leaking raw stored data.
- The scheduler persists result evidence **before** transitioning a job to a terminal state. If the broker restarts between those two writes, it now removes any stale result, records explicit `broker_restart` failure evidence and transitions the job to `interrupted` only after reconciling the exact job container. A prior saved *pass* cannot survive as evidence for an interrupted job.
- If result or journal persistence fails at worker completion, the current synchronous waiter receives an infrastructure failure, broker readiness becomes false, and no next queued execution launches until recovery.
- Unit tests simulate journal and result disk failure, corrupt/tampered evidence, symlinked evidence, queued work withheld during failed storage, and safe restart reconciliation.

## Remaining risk and scope

The broker still uses bounded synchronous JSON-journal writes, not a transactional multi-instance durable queue. A crash before the API acknowledges a newly enqueued job can create an *ambiguous acceptance* case; idempotency keys and a transactional acknowledgement protocol are still needed. Disk failures may also require manual host repair; do not silently retry jobs on an untrusted host.

These changes provide **fault-injection coverage for one local broker**, not multi-node failover, distributed leases, production disaster recovery, or commercial security certification. No production deployment or persistent user data changes were performed.
