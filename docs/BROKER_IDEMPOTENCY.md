# Durable broker acceptance and idempotent retries (v0.19)

The optional, **fixture-only** host broker's `POST /jobs` endpoint accepts the `Idempotency-Key` HTTP header. Use a newly generated lowercase UUID for each *logical* asynchronous submission and **reuse the same UUID for every retry** after a connection loss, timeout or uncertain HTTP acknowledgement.

Example:

```http
POST /jobs HTTP/1.1
X-GQA-Runner-Token: <local secret>
Idempotency-Key: ab124567-890a-4bcd-8ef0-1234567890ab
Content-Type: application/json

{"kind":"smoke","target_url":"http://fixture:8081","run_api":true,"run_web":false}
```

The broker hashes the UUID before writing it into its atomic, fsynced local JSON journal. Requests with the same key and the same approved typed job return **HTTP 202 with the original job ID** without enqueueing or starting another job, even if the queue is at capacity or the previous job has completed. Reusing a key for a *different* job returns HTTP 409. Invalid keys return HTTP 400. The existing token authentication, hardcoded fixture allowlist and strict typed flow validation remain enforced.

When the journal reports an I/O failure after a write may have committed (for example during final directory fsync), acceptance now **fails closed with HTTP 503 and disables additional jobs** until the broker is restarted and reconciles persisted state. Retrying with the same key after recovery resolves an accepted entry, if present. Do not retry with a freshly generated key: that can create a duplicate.

## Important limits

- This is local, single-broker, on-disk **idempotent acceptance**, not a distributed transactional queue or exactly-once side effects. The current journal retains bounded terminal history (last 100 terminal records), so keys eventually expire when those jobs are pruned. Clients cannot depend on an unlimited deduplication window.
- The header is optional for legacy clients. Clients that omit it still risk duplicate acceptance when an HTTP response is lost.
- Broker state lives on a single host filesystem. No multi-host lease/fencing, database transaction or remote disaster recovery is implemented.
- The key is a request identity, **not** proof of the caller's account identity, and its SHA-256 digest is not an authorization token.
- The host broker has Docker privileges; production use against untrusted sites requires a separate execution host, sandbox isolation and threat-model validation.

Unit tests cover same-key retries, queue-capacity bypass for an already-accepted request, altered-spec conflicts, on-disk recovery, malformed journal hashes and ambiguous post-rename failures. The isolated ephemeral CI workflow additionally checks real HTTP retry behavior. No production targets or user files are accessed.
