import assert from "node:assert/strict";
import { chromium } from "playwright";
import fs from "node:fs/promises";

const WEB = "http://localhost:3000";
const API = "http://localhost:8080";
const origin = WEB;
const password = process.env.GQA_UI_TEST_ADMIN_PASSWORD;
if (process.env.CI !== "true" || process.env.GQA_UI_E2E_ISOLATED !== "YES" || !password) {
  throw new Error("Browser E2E must run only against isolated CI fixtures");
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1365, height: 900 }, reducedMotion: "reduce" });
const failures = [];
const observed = [];
page.on("pageerror", error => failures.push("Page error: " + error.message));
page.on("console", message => {
  if (message.type() === "error" && /uncaught|hydration|failed to fetch/i.test(message.text()))
    failures.push("Browser console: " + message.text());
});
page.on("response", response => {
  if (response.url().startsWith(API + "/api/") && response.status() >= 500) {
    failures.push("Server failure: " + response.status() + " " + new URL(response.url()).pathname);
  }
});

const id = String(Date.now());
const projectA = "UI E2E Alpha " + id;
const projectB = "UI E2E Beta " + id;
const safeRepo = "https://github.com/khoryik96-creator/GQA";
const screenshot = async name => {
  await fs.mkdir("ui-e2e-artifacts", { recursive: true });
  await page.screenshot({ path: "ui-e2e-artifacts/" + name + ".png", fullPage: true });
};

async function login() {
  await page.goto(WEB, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Sign in to GQA" }).waitFor({ timeout: 30000 });
  await page.getByRole("textbox", { name: "Account email" }).fill("admin@gqa.local");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Sign out" }).waitFor({ timeout: 30000 });
}

async function addProject(name) {
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("textbox", { name: "Project name" }).fill(name);
  await page.getByRole("textbox", { name: "GitHub repository URL" }).fill(safeRepo);
  await page.getByRole("button", { name: "Create project", exact: true }).last().click();
  await page.locator(".project-item.active", { hasText: name }).waitFor({ timeout: 30000 });
}

async function seedMemories(count) {
  const result = await page.evaluate(async ({ api, count }) => {
    const projects = await fetch(api + "/api/projects", { credentials: "include", cache: "no-store" }).then(r => r.json());
    const selected = document.querySelector(".project-item.active span")?.textContent;
    const project = projects.find(p => p.name === selected);
    if (!project) throw new Error("Cannot resolve selected fixture project");
    for (let i = 0; i < count; i++) {
      const response = await fetch(api + "/api/projects/" + project.id + "/memories", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", "Origin": "http://localhost:3000" },
        body: JSON.stringify({ kind: "requirement", content: "e2epagination sample " + String(i).padStart(3, "0") })
      });
      if (response.status !== 201) throw new Error("Seed failed: " + response.status);
    }
    return project.id;
  }, { api: API, count });
  return result;
}

try {
  await page.goto(WEB);
  await page.getByRole("heading", { name: "Sign in to GQA" }).waitFor({ timeout: 30000 });
  assert.equal(await page.getByRole("button", { name: "Create project" }).count(), 0, "Anonymous users must not see project controls");
  assert.equal(await page.getByLabel("Password").getAttribute("type"), "password");
  await screenshot("01-login");

  await login();
  await addProject(projectA);
  await addProject(projectB);
  await page.getByRole("button", { name: projectA, exact: true }).click();
  await page.locator(".project-item.active", { hasText: projectA }).waitFor();
  await page.getByRole("button", { name: /Project Memory/ }).click();
  await page.getByRole("heading", { name: "Persistent project memory" }).waitFor();
  const betaToken = "Unique beta memory E2E " + id;
  await page.getByRole("button", { name: projectB, exact: true }).click();
  await page.getByRole("button", { name: /Project Memory/ }).click();
  await page.getByRole("textbox", { name: "Category" }).count().catch(() => {});
  const memEditor = page.locator(".memory-editor");
  await memEditor.locator("textarea").fill(betaToken);
  await memEditor.locator('button[type="submit"]').click();
  await page.locator(".memory-item", { hasText: betaToken }).waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: projectA, exact: true }).click();
  await page.getByRole("button", { name: /Project Memory/ }).click();
  assert.equal(await page.getByText(betaToken).count(), 0, "Project switching leaked previous project's memories");

  await seedMemories(30);
  await page.getByPlaceholder("Search remembered knowledge...").fill("e2epagination");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.locator(".memory-item").first().waitFor();
  await page.getByRole("button", { name: "Load 25 more memories" }).waitFor({ timeout: 15000 });
  assert.equal(await page.locator(".memory-item").count(), 25, "First memory page was not capped at 25");
  await page.getByRole("button", { name: "Load 25 more memories" }).click();
  await page.locator(".memory-item").nth(29).waitFor({ timeout: 15000 });
  assert.equal(await page.locator(".memory-item").count(), 30, "Second page did not append remaining memories");
  assert.equal(await page.getByRole("button", { name: "Load 25 more memories" }).count(), 0);
  await screenshot("02-memory-pagination");

  // Keyboard-only navigation must visibly expose focus and accessible names.
  await page.getByRole("button", { name: "Sign out" }).focus();
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.includes("Sign out")), true);
  const focusOutline = await page.getByRole("button", { name: "Sign out" }).evaluate(el => {
    const css = getComputedStyle(el);
    return { outlineWidth: css.outlineWidth, outlineStyle: css.outlineStyle };
  });
  assert.notEqual(focusOutline.outlineStyle, "none", "Keyboard focus style is absent");
  assert.notEqual(focusOutline.outlineWidth, "0px", "Keyboard focus indicator is invisible");
  assert.equal(await page.locator("main").count(), 1);
  await screenshot("03-dashboard");

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("heading", { name: "Sign in to GQA" }).waitFor({ timeout: 15000 });
  assert.equal(await page.getByText(betaToken).count(), 0);
  observed.push("login, project creation, project selection isolation, memory creation, pagination, keyboard focus and logout");
} catch (error) {
  await screenshot("failure").catch(() => {});
  throw error;
} finally {
  await browser.close();
}
assert.deepEqual(failures, [], "Unhandled browser errors: " + JSON.stringify(failures));
console.log("PASS: " + observed.join(", "));
