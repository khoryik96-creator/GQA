# v0.16 — Browser UI E2E and keyboard accessibility smoke

The `.github/workflows/browser-ui-e2e.yml` job uses the existing locked Playwright dependency (in `apps/runner`) to run an actual Chromium browser against the disposable, loopback-only GQA Compose application.

The suite covers anonymous access, administrator login, project creation and switching between two distinct project records, writing and isolating project memories, cursor pagination through 30 search results (25 first page, five second page), keyboard focus visibility, and logout. Browser page errors are captured and failure screenshots uploaded as short-lived workflow artifacts.

This is intentionally a narrow **user-journey and keyboard accessibility smoke test**, not a full accessibility compliance certification. Additional tests are needed for all permissions, visual contrast, screen-reader announcements, axe-core audits, browser keyboard ordering, mobile layouts, regression charts and flow repair/moderation workflows.

The implementation adds a skip-to-main link, keyboard focus indicators, explicit project-selection state, main landmark focus target, and assistive-technology alerts for errors.

## Safe operation

The test insists on `CI=true`, `GQA_UI_E2E_ISOLATED=YES` and an isolated generated administrator password. It uses `http://localhost:3000` and `http://localhost:8080` only. The GitHub Actions job creates and destroys temporary named volumes. **Never run it against existing GQA user data**, especially if you need to preserve evidence and project history.

As with other CI-only fixtures, success does not certify untrusted website browsing, commercial multi-tenant isolation, production authentication or real-world user capacity.
