# In-flight execution RBAC and session revocation (v0.18)

Previously the API checked a user's authenticated session and project QA membership when the request began, but a long-running runner execution used an independent background context. A revoked account or project membership could therefore retain an already-running job until normal completion.

The API now checks the original session token and current account/project authorization **every two seconds** while the HTTP runner request is in flight, using a 1.5-second bounded database permission query. A rejected, expired or suspended session, revoked QA/owner project membership, or temporary permission-query failure cancels the worker request. It also performs a separate final authorization check before storing any success or screenshot evidence.

The result is written as a failed run, with no success screenshot, and the initiating request receives 403 for revoked authorization, or 503 if final authorization is temporarily unavailable. The Node one-shot runner supervisor also receives the HTTP abort signal and force-terminates its spawned process group; the job no longer continues merely because its client disconnected. The caller's HTTP request context now also cancels pending remote work on client disconnect; recording the result uses a separate bounded finalization context.

## Disposable integration rehearsal

`scripts/inflight_revocation_test.py` creates a new isolated project, QA account and reviewed browser flow, pauses only the disposable local Docker Compose runner, starts an execution in another thread, waits for the durable running row, revokes that user's project membership, and verifies cancellation and failed evidence. It always unpauses the fixture in a `finally` block. Then it restores the QA role and verifies a new authorized run succeeds.

This is *not* proof that any already-performed browser interaction is undone. A hostile or noncooperative target can receive an action before revocation. The test only verifies cancellation of pending worker calls and fail-closed storage/reporting. Real brokered jobs, cross-node revocation propagation, mid-flight account changes under high throughput, and external target isolation require separate certification. Do not run the fixture against any user-owned Docker stack.

No production data or live services are modified. All work is restricted to disposable CI resources.
