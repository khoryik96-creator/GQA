"use strict";

const http = require("node:http");
const crypto = require("node:crypto");
const { chromium } = require("playwright");
const { allowedTarget } = require("./policy.cjs");
const { validateFlow, runBrowserFlow } = require("./browser-flow.cjs");

const PORT = Number(process.env.PORT || 8090);
const ALLOWLIST = process.env.GQA_SMOKE_TARGETS || "http://fixture:8081";
const TOKEN = process.env.GQA_RUNNER_TOKEN || "";
let running = false;

function tokenMatches(actual, expected) {
  if (!actual || !expected) return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function send(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(payload));
}

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
  return { checks, screenshot_base64: screenshot };
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/healthz") return send(res, 200, { status: "ok", busy: running });
  if (req.method !== "POST" || !["/run", "/flow"].includes(req.url)) return send(res, 404, { error: "Not found" });
  if (!tokenMatches(req.headers["x-gqa-runner-token"], TOKEN)) return send(res, 401, { error: "Unauthorized" });
  if (running) return send(res, 429, { error: "Runner busy" });
  let raw = "";
  req.on("data", chunk => {
    raw += chunk;
    if (raw.length > 16384) req.destroy();
  });
  req.on("end", async () => {
    let input;
    try { input = JSON.parse(raw); } catch { return send(res, 400, { error: "Invalid JSON" }); }
    if (!input || typeof input !== "object" || !allowedTarget(input.target_url, ALLOWLIST)) {
      return send(res, 403, { error: "Target is not approved" });
    }
    if (req.url === "/flow") {
      if (!validateFlow(input.steps)) return send(res, 400, { error: "Browser flow is not valid" });
      running = true;
      try { send(res, 200, await runBrowserFlow(input.target_url, input.steps, ALLOWLIST)); }
      catch { send(res, 500, { error: "Browser flow worker failed" }); }
      finally { running = false; }
      return;
    }
    if (typeof input.run_api !== "boolean" || typeof input.run_web !== "boolean" ||
        (!input.run_api && !input.run_web)) {
      return send(res, 400, { error: "Invalid smoke request" });
    }
    running = true;
    try { send(res, 200, await runSmoke(input.target_url, input.run_api, input.run_web)); }
    catch { send(res, 500, { error: "Runner failed" }); }
    finally { running = false; }
  });
});

server.requestTimeout = 65000;
server.listen(PORT, "0.0.0.0", () => console.log("GQA read-only runner ready on " + PORT));
