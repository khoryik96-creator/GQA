# Browser repair and reviewer approval E2E

GQA's disposable Chromium CI suite now includes `apps/runner/tests/repair_review_ui_e2e.mjs`, an actual browser regression of the controlled locator repair pipeline. The test is hardcoded to local fixtures, requires both `CI=true` and `GQA_UI_E2E_ISOLATED=YES`, and does not access user or production projects.

## Scope

1. The administrator creates an isolated project and local-only Web QA plan. A deterministic browser flow targets a fixture with a **Show details** button.
2. Executing the original flow against the renamed fixture produces a failure and suggests the visible **Reveal details** accessible name.
3. The administrator creates the repair from the *UI*. The proposed flow remains bound to the renamed origin and cannot execute until its steps and assertions are acknowledged.
4. The administrator replays the proposal from the browser UI. The test checks that it passed and that the proposal retained every original assertion.
5. A separately authenticated *reviewer* cannot draft or execute flows, but may approve the successful replay from the UI with a declared application revision.
6. The recorded lesson is confirmed through the API, and attempting to approve it twice must return 409.

The UI also gives browser flow errors the `role="alert"` semantics and exposes execution status in a polite live region.

## Limits

This validates one controlled fixture scenario, not arbitrary application changes or autonomous safety of AI-generated scripts. Existing backend CI independently covers origin restrictions and repair lineage. The new test does not independently verify the declared app revision or a real Git deployment. Full axe-core WCAG auditing, screen-reader checks, color contrast, browser/device matrix, and additional failed-worker/partial-evidence cases remain outstanding.

**No deployment or existing database modification occurs.** Disposable Docker volumes and CI secrets are removed after every run.
