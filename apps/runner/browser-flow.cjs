"use strict";
const { chromium } = require("playwright");
const { allowedTarget } = require("./policy.cjs");
const ROLES = new Set(["button", "link", "heading", "textbox"]);
const OPS = new Set(["navigate", "click_role", "fill_label", "assert_text", "assert_visible_role", "assert_url_path"]);

function safePath(value) {
  return typeof value === "string" && value.startsWith("/") &&
    !value.startsWith("//") && value.length <= 160 &&
    !/[\\?#\u0000-\u001F]/.test(value) && !value.split("/").includes("..");
}
function validateFlow(steps) {
  if (!Array.isArray(steps) || steps.length < 2 || steps.length > 8) return false;
  if (!steps.some(s => s && ["assert_text", "assert_visible_role", "assert_url_path"].includes(s.op))) return false;
  if (steps[0]?.op !== "navigate") return false;
  for (const s of steps) {
    if (!s || typeof s !== "object" || Array.isArray(s)) return false;
    if (Object.keys(s).some(key => !["op","path","role","name","label","value","text"].includes(key))) return false;
    if (!OPS.has(s.op)) return false;
    if (s.op === "navigate" || s.op === "assert_url_path") {
      if (!safePath(s.path)) return false;
    } else if (s.op === "click_role" || s.op === "assert_visible_role") {
      if (!ROLES.has(s.role) || typeof s.name !== "string" ||
          !s.name.trim() || s.name.length > 120) return false;
      if (s.op === "click_role" && !["button","link"].includes(s.role)) return false;
    } else if (s.op === "fill_label") {
      if (typeof s.label !== "string" || !s.label.trim() || s.label.length > 100 ||
          typeof s.value !== "string" || s.value.length > 200 ||
          /password|secret|token|api.?key/i.test(s.label)) return false;
    } else if (s.op === "assert_text") {
      if (typeof s.text !== "string" || !s.text.trim() || s.text.length > 200) return false;
    }
  }
  return true;
}
function stepName(index, step) {
  const labels = {
    navigate: "Navigate", click_role: "Click accessible element",
    fill_label: "Fill labeled field", assert_text: "Assert visible text",
    assert_visible_role: "Assert accessible role", assert_url_path: "Assert URL path"
  };
  return "Browser step " + (index + 1) + ": " + labels[step.op];
}

// Typed, explicitly reviewed actions only. No arbitrary scripts or eval.
async function runBrowserFlow(target, steps, allowlist) {
  if (!allowedTarget(target, allowlist) || !validateFlow(steps)) {
    throw new Error("Invalid or unauthorized browser flow");
  }
  const origin = new URL(target).origin;
  const checks = [];
  let screenshot = "", browser, context;
  try {
    browser = await chromium.launch({ headless: true, chromiumSandbox: false });
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 }, serviceWorkers: "block",
      acceptDownloads: false, permissions: []
    });
    await context.route("**/*", async route => {
      try {
        const u = new URL(route.request().url());
        if (u.origin === origin && ["GET","HEAD"].includes(route.request().method())) {
          return route.continue();
        }
      } catch { /* block below */ }
      return route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i], started = Date.now();
      try {
        let detail = "";
        switch (s.op) {
          case "navigate": {
            const response = await page.goto(new URL(s.path, origin).href, {
              waitUntil: "domcontentloaded", timeout: 10000
            });
            const code = response?.status() || 0;
            if (code < 200 || code >= 300) throw new Error("Navigation returned HTTP " + code);
            detail = "HTTP " + code;
            break;
          }
          case "click_role":
            await page.getByRole(s.role, { name: s.name, exact: true }).click();
            detail = "Action completed; follow-up assertion required";
            break;
          case "fill_label":
            await page.getByLabel(s.label, { exact: true }).fill(s.value);
            detail = "Field filled with approved test data";
            break;
          case "assert_text":
            await page.getByText(s.text, { exact: true }).waitFor({ state: "visible" });
            detail = "Expected text is visible";
            break;
          case "assert_visible_role":
            await page.getByRole(s.role, { name: s.name, exact: true }).waitFor({ state: "visible" });
            detail = "Expected accessible element is visible";
            break;
          case "assert_url_path":
            if (new URL(page.url()).pathname !== s.path) throw new Error("URL path assertion failed");
            detail = "Current URL path matches expected path";
            break;
        }
        if (new URL(page.url()).origin !== origin) throw new Error("Unexpected navigation outside approved origin");
        checks.push({ name: stepName(i, s), status: "passed",
          duration_ms: Date.now() - started, detail });
      } catch (err) {
        checks.push({ name: stepName(i, s), status: "failed",
          duration_ms: Date.now() - started,
          detail: String(err.message || err).split("\n")[0].slice(0, 200) });
        break;
      }
    }
    try {
      if (new URL(page.url()).origin === origin) {
        const png = await page.screenshot({ type: "png", fullPage: false, timeout: 5000 });
        if (png.length <= 1000000) screenshot = png.toString("base64");
      }
    } catch { /* screenshots are optional */ }
  } catch (err) {
    checks.push({ name: "Browser runner initialization", status: "failed",
      duration_ms: 0, detail: String(err.message || err).split("\n")[0].slice(0, 200) });
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
  return { checks, screenshot_base64: screenshot };
}
module.exports = { safePath, validateFlow, runBrowserFlow };
