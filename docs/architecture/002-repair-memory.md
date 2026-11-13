# ADR 002 — Evidence-first healing, separate review and versioned memory

Status: accepted for GQA v0.5

## Context

Browser selectors can become outdated while the business workflow stays
unchanged. Automatically rewriting selectors can also hide real regressions.
A principal QA platform must preserve original failures, avoid inventing
success, and ensure the corrected test still validates the original behavior.

## Decision

1. Failure results are immutable historical evidence.
2. Only a failed \`click_role\` step may obtain an advisory locator name
   suggestion; do not propose changing assertions.
3. Candidate names come from visible controls with the original role.
   Candidates are filtered to avoid control-character and secret-like values.
   Ambiguous candidates produce no proposal.
4. GQA never directly executes suggested changes. A new browser flow is
   generated with a digest that must be explicitly acknowledged.
5. The re-test uses the **same approved target** that originally failed.
6. A human acceptance is permitted only after a separate passing run of the
   repaired flow. Original expectations and all other steps must be unchanged.
7. Accepted lessons record source and revision in project memory. A 14-day
   cache hint is indexed by project, original-flow digest, target and revision,
   but **never automatically applied**.
8. No accepted repair overrides business requirements or changes repository
   code. A repair is a tooling lesson, not proof that an application defect
   was fixed.

## Out of scope

- Automatic self-healing without review.
- Autonomous selector changes to critical workflows.
- Repairs to failed assertions.
- Automatic UI diagnosis from screenshots.
- Cross-project knowledge transfer.
- Public or multi-tenant operation without authentication and stronger runner
  process/network isolation.

## Validation

Unit tests cover valid and adversarial locator hints, unmodified assertions,
reviewed replay requirements, safe revision keys and candidate ambiguity.
Docker integration tests intentionally rename a fixture button, verify failure
evidence, propose the repair, reject wrong-target replay, verify the repaired
test passed, reject duplicate acceptance and check the persisted memory lesson.
