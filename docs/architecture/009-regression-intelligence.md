# ADR 009 — Evidence-based regression intelligence

Status: implemented in draft GQA v0.12 (local-only).

## Test identity

Comparisons are deliberately scoped to the same project, execution kind,
test target origin, and smoke plan ID or immutable reviewed browser flow ID.
Newly repaired flows have independent baselines. One cannot claim a passing
repaired flow means the original failing flow passed.

## State classifications

| Previous | Latest | Outcome |
| --- | --- | --- |
| None | failed | New observed failure |
| None | passed | First observed pass |
| passed | failed | Regression |
| failed | failed | Persistent failure |
| failed | passed | Recovery |
| passed | passed | Stable pass |

Check-name deltas show which named checks failed or recovered. Last-six
chronological observations are rendered per scenario. Two or more outcome
switches in at least four recent samples trigger an "unstable outcome
pattern" label. **This is not a confirmed flaky-test diagnosis.**

## Bounded and safe analysis

At most the 200 most recent completed runs are analyzed per project.
The response explicitly states when records were truncated. A report
exposes no screenshot bytes, secrets or arbitrary worker response bodies.
The endpoint is read-only and applies existing per-project read rights.
It does not call the LLM, change historical expectations, update repair
memory, schedule tests or execute browser actions. No new schema migration
is required.

## Tests

Go unit tests cover comparable run identity, regression/recovery, stable
pass, repeated outcome switching, target/flow isolation and truncation.
Docker integration verifies repeat smoke results and authorization for
members versus unassigned accounts.
