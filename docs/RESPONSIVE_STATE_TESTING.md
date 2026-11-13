# Responsive and accessible status regression matrix

The `advanced_ui_e2e.mjs` browser test checks **nine viewport widths** (320, 375, 390, 430, 600, 760, 768, 1024, 1280 pixels) on a separately authenticated QA user's project-memory dashboard. A measured document width exceeding the viewport fails the workflow; on failure the error lists element selectors extending past the viewport.

This protects against whole-document horizontal scrolling while still allowing intentionally scrollable navigation tabs. It is a layout guard, **not** a screenshot-diff or real-device compatibility guarantee.

In addition, the regression insight panel, project membership panel, and experimental admin worker monitor now expose errors through alert semantics, successful changes and loading/refresh notifications through status semantics. The experimental worker monitor stops automatic 15-second polling after a request fails; its explicit Refresh control remains available so repeated outages do not produce continuous retry traffic.

The automated WCAG screen introduced in PR #39 still covers six login, command, memory and team UI states. Manual assistive-technology reviews, 200–400% zoom tests, browser matrix checks and visual snapshots remain outstanding.

All operations use disposable CI application data and do not target production accounts.
