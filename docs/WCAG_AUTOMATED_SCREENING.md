# Automated WCAG 2.2 A/AA screening

The isolated GitHub Actions browser workflow runs `apps/runner/tests/wcag_axe_audit.mjs` against a disposable GQA stack after the existing Chromium regression tests.

The test uses **axe-core 4.14.0** with the pinned `@axe-core/playwright` integration and records violations for six responsive and authenticated UI states: anonymous login, command dashboard, project memory, Team Access, 390px mobile Team Access, and 390px mobile memory.

* Tagged axe rules: `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`.
* CI fails for any serious/critical finding. Moderate/minor findings remain in the report and are not silently dismissed.
* Each run uploads `gqa-wcag-axe-screen` (JSON, 14-day retention) with rule identifiers, impact, affected node selectors, and failure summaries.
* The test requires `CI=true`, `GQA_UI_E2E_ISOLATED=YES`, generated test credentials and loopback endpoints; its fixture data is destroyed after the job.

**Limits:** Automated axe rules detect only a subset of WCAG issues. This is not a WCAG conformance declaration or an accessibility certification. It does not replace keyboard journey reviews, screen-reader testing (NVDA/VoiceOver), checks for understandable error messaging, contrast reviews in unusual states, higher zoom, dynamic moderation and error paths, or cross-browser/mobile-device work. Capturing more than one page state does not make this a full compliance audit.

A real deployment still requires independent accessibility and security review, backed-up database upgrade testing and a controlled launch plan.
