# v0.16 — Browser UI E2E and keyboard accessibility smoke

The `.github/workflows/browser-ui-e2e.yml` job uses the existing locked Playwright dependency (in `apps/runner`) to run an actual Chromium browser against the disposable, loopback-only GQA Compose application.

The suite covers anonymous access, administrator login, project creation and switching between two distinct project records, writing and isolating project memories, cursor pagination through 30 search results (25 first page, five second page), keyboard focus visibility, and logout. Browser page errors are captured and failure screenshots uploaded as short-lived workflow artifacts.

This is intentionally a narrow **user-journey and keyboard accessibility smoke test**, not a full accessibility compliance certification. Additional tests are needed for all permissions, visual contrast, screen-reader announcements, axe-core audits, browser keyboard ordering, mobile layouts, regression charts and flow repair/moderation workflows.

The implementation adds a skip-to-main link, keyboard focus indicators, explicit project-selection state, main landmark focus target, and assistive-technology alerts for errors.

## Safe operation

The test insists on `CI=true`, `GQA_UI_E2E_ISOLATED=YES` and an isolated generated administrator password. It uses `http://localhost:3000` and `http://localhost:8080` only. The GitHub Actions job creates and destroys temporary named volumes. **Never run it against existing GQA user data**, especially if you need to preserve evidence and project history.

As with other CI-only fixtures, success does not certify untrusted website browsing, commercial multi-tenant isolation, production authentication or real-world user capacity.

## v0.16 advanced regression additions

The same disposable CI job now invokes `apps/runner/tests/advanced_ui_e2e.mjs`. It provisions three non-admin accounts and two isolated projects through actual authenticated APIs, grants the first project `viewer`, `reviewer` and `qa` membership, then exercises Chromium sessions for each role.

The browser verifies that create-project and Team Access controls are absent for non-admins, QA plan and memory controls are disabled/hidden for non-QA roles, and the correct project is selected. API assertions independently verify read access, denied cross-project access (404), denied project management (403), denied global project creation (403), and allowed or denied memory writes by role (201/403).

A controlled browser network failure aborts the initial project-memory GET. The test confirms a visible error/retry action, then restores the route and confirms the user can recover without signing out. A narrow 390px mobile viewport test catches accidental horizontal page overflow. Keyboard focus on the skip-to-main link verifies that it becomes visible and jumps to the main landmark.

**Limitations:** This does not automatically test every reviewer repair approval, worker job action, disabled-account revocation during in-flight requests, all responsive breakpoints, screen-reader output, color-contrast ratios, WCAG 2.2 compliance, or Axe rule coverage. Such work remains tracked in issue #17. All actions run only against disposable CI resources.
