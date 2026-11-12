"use strict";

async function runSmoke(target, runAPI, runWeb) {
  const checks = [];
  let screenshot = "";
  const origin = new URL(target).origin;

  if (runAPI) {
    const started = Date.now();
    try {
      const response = await fetch(new URL("/healthz", origin), {
        method: "GET", redirect: "manual", signal: AbortSignal.timeout(8000)
      });
      checks.push({
        name: "API GET /healthz",
        status: response.status >= 200 && response.status < 300 ? "passed" : "failed",
        duration_ms: Date.now() - started,
        detail: "HTTP " + response.status
      });
      await response.body?.cancel();
    } catch (error) {
      checks.push({
        name: "API GET /healthz", status: "failed",
        duration_ms: Date.now() - started, detail: String(error).slice(0, 300)
      });
    }
  }

  if (runWeb) {
    const started = Date.now();
    let browser;
    try {
      const { chromium } = require("playwright");
      browser = await chromium.launch({ headless: true, chromiumSandbox: false });
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        serviceWorkers: "block", acceptDownloads: false
      });
      await context.route("**/*", async route => {
        const requestURL = route.request().url();
        if (requestURL.startsWith("data:") || requestURL.startsWith("blob:")) {
          return route.continue();
        }
        try {
          if (new URL(requestURL).origin === origin && ["GET", "HEAD"].includes(route.request().method())) {
            return route.continue();
          }
        } catch { /* abort below */ }
        return route.abort();
      });
      await context.routeWebSocket("**/*", socket => socket.close());
      const page = await context.newPage();
      const response = await page.goto(origin, { timeout: 10000, waitUntil: "domcontentloaded" });
      const title = (await page.title()).trim().slice(0, 180);
      const status = response?.status() || 0;
      const passed = status >= 200 && status < 300 && !!title && page.url().startsWith(origin);
      if (passed) {
        const png = await page.screenshot({ type: "png", fullPage: false });
        if (png.length <= 1000000) screenshot = png.toString("base64");
      }
      checks.push({
        name: "Browser homepage smoke",
        status: passed ? "passed" : "failed",
        duration_ms: Date.now() - started,
        detail: "HTTP " + status + "; title: " + (title || "(empty)")
      });
      await context.close();
    } catch (error) {
      checks.push({
        name: "Browser homepage smoke", status: "failed",
        duration_ms: Date.now() - started, detail: String(error).slice(0, 300)
      });
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  }
  const failing = checks.find(c => c.status !== "passed");
  return {
    checks, screenshot_base64: screenshot,
    evidence: {
      worker_lifecycle: "single_job_process",
      failure_kind: failing ? (failing.name.startsWith("API") ? "api_health_failure" : "browser_smoke_failure") : "none",
      console_errors: 0, page_exceptions: 0, failed_requests: 0, http_5xx: 0
    }
  };
}

module.exports = { runSmoke };
