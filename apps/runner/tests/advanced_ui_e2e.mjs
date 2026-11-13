import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { chromium } from "playwright";

const WEB = "http://localhost:3000";
const API = "http://localhost:8080";
if (process.env.CI !== "true" || process.env.GQA_UI_E2E_ISOLATED !== "YES" ||
    !process.env.GQA_UI_TEST_ADMIN_PASSWORD) {
  throw new Error("Advanced UI permission tests require isolated CI credentials");
}
const suffix = randomBytes(5).toString("hex");
const accountPassword = randomBytes(22).toString("hex");
const browser = await chromium.launch({ headless: true });
const contexts = [];
const records = [];
const apiPath = path => API + path;

async function session(email, password) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 850 },
    reducedMotion: "reduce"
  });
  contexts.push(context);
  const response = await context.request.post(apiPath("/api/auth/login"), {
    data: { email, password },
    headers: { Origin: WEB }
  });
  assert.equal(response.status(), 200, "Failed to authenticate " + email);
  const page = await context.newPage();
  await page.goto(WEB, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Sign out" }).waitFor({ timeout: 20000 });
  return { context, page };
}

async function request(context, method, path, data) {
  const response = await context.request.fetch(apiPath(path), {
    method,
    ...(data === undefined ? {} : { data }),
    headers: { Origin: WEB }
  });
  return response;
}

async function checkRole(role, projectA, projectB, email) {
  const { context, page } = await session(email, accountPassword);
  const row = page.getByRole("button", { name: projectA.name, exact: true });
  await row.waitFor({ timeout: 15000 });
  assert.equal(await page.getByRole("button", { name: projectB.name, exact: true }).count(), 0,
    role + " unexpectedly saw an unrelated project");
  assert.equal(await page.getByRole("button", { name: "Create project" }).count(), 0,
    role + " unexpectedly saw administrator project controls");
  assert.equal(await page.getByRole("button", { name: /Team Access/ }).count(), 0,
    role + " unexpectedly saw membership management controls");
  assert.equal(await row.getAttribute("aria-pressed"), "true");
  assert.equal(await page.getByRole("main").count(), 1);

  const allowed = role === "qa";
  const planButton = page.getByRole("button", { name: "Generate QA plan" });
  await planButton.waitFor();
  assert.equal(await planButton.isEnabled(), allowed, role + " QA plan control mismatch");
  await page.getByRole("button", { name: /Project Memory/ }).click();
  await page.getByRole("heading", { name: "Persistent project memory" }).waitFor();
  assert.equal(await page.locator(".memory-editor").count(), allowed ? 1 : 0,
    role + " memory editor visibility mismatch");

  const read = await request(context, "GET", "/api/projects/" + projectA.id + "/memories?limit=5");
  assert.equal(read.status(), 200, role + " must read its own project");
  const alien = await request(context, "GET", "/api/projects/" + projectB.id + "/memories?limit=5");
  assert.equal(alien.status(), 404, role + " must not discover another project's records");

  const write = await request(context, "POST", "/api/projects/" + projectA.id + "/memories", {
    kind: "requirement",
    content: role + " authorization fixture " + suffix
  });
  assert.equal(write.status(), allowed ? 201 : 403, role + " unexpected memory write authority");
  const manage = await request(context, "GET", "/api/projects/" + projectA.id + "/members");
  assert.equal(manage.status(), 403, role + " unexpectedly received member management access");
  const createProject = await request(context, "POST", "/api/projects", {
    name: "Unauthorized project " + suffix, repo_url: "https://github.com/khoryik96-creator/GQA",
    app_type: "api", stack: "CI"
  });
  assert.equal(createProject.status(), 403, role + " unexpectedly created a project");

  if (role === "viewer") {
    // A single failed endpoint must not wipe successful project resources.
    // Recovery is user-initiated and no request is retried in a loop.
    let intercepted = false;
    await page.route("**/api/projects/" + projectA.id + "/memories?limit=25", route => {
      intercepted = true;
      return route.abort("failed");
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("alert").filter({ hasText: "Unable to load project memory" })
      .waitFor({ timeout: 15000 });
    assert.equal(intercepted, true, "Failure route did not intercept project loading");
    await page.getByRole("button", { name: "Retry project data" }).waitFor();
    await page.unroute("**/api/projects/" + projectA.id + "/memories?limit=25");
    await page.getByRole("button", { name: "Retry project data" }).click();
    await page.getByRole("button", { name: "Retry project data" }).waitFor({ state: "detached", timeout: 15000 });
    await page.getByRole("heading", { name: "Persistent project memory" }).waitFor();
    records.push("failed memory GET preserves session and recovers via explicit retry");
  }
  if (role === "qa") {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: /Project Memory/ }).waitFor();
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth
    }));
    assert.ok(dimensions.content <= dimensions.viewport + 2,
      "Mobile UI overflows viewport: " + JSON.stringify(dimensions));
    records.push("390px mobile layout does not horizontally overflow");
  }
  await context.close();
  records.push(role + " role UI visibility and API authorization");
}

try {
  const admin = await session("admin@gqa.local", process.env.GQA_UI_TEST_ADMIN_PASSWORD);
  const projectBase = {
    repo_url: "https://github.com/khoryik96-creator/GQA", app_type: "api", stack: "CI fixtures"
  };
  const pA = await request(admin.context, "POST", "/api/projects", {
    ...projectBase, name: "RBAC E2E Project A " + suffix
  });
  const pB = await request(admin.context, "POST", "/api/projects", {
    ...projectBase, name: "RBAC E2E Project B " + suffix
  });
  assert.equal(pA.status(), 201);
  assert.equal(pB.status(), 201);
  const projectA = await pA.json();
  const projectB = await pB.json();

  const memberEmails = {};
  for (const role of ["viewer", "reviewer", "qa"]) {
    const email = "gqa-ui-" + role + "-" + suffix + "@example.test";
    memberEmails[role] = email;
    const user = await request(admin.context, "POST", "/api/admin/users", {
      email, password: accountPassword
    });
    assert.equal(user.status(), 201, "Unable to provision " + role + " account");
    const assignment = await request(admin.context, "POST",
      "/api/projects/" + projectA.id + "/members", { email, role });
    assert.equal(assignment.status(), 200, "Unable to assign " + role);
  }
  for (const role of ["viewer", "reviewer", "qa"]) {
    await checkRole(role, projectA, projectB, memberEmails[role]);
  }

  // Tab keyboard focus should reveal the skip link before navigation and
  // its activation should target the main landmark.
  await admin.page.reload({ waitUntil: "domcontentloaded" });
  await admin.page.keyboard.press("Tab");
  const skip = admin.page.getByRole("link", { name: "Skip to main content" });
  await skip.waitFor();
  await skip.focus();
  const visible = await skip.evaluate(el => {
    const css = getComputedStyle(el);
    return css.visibility !== "hidden" && css.display !== "none" &&
      el.getBoundingClientRect().bottom > 0;
  });
  assert.ok(visible, "Skip-to-main link does not become visible on keyboard focus");
  await admin.page.keyboard.press("Enter");
  assert.equal(new URL(admin.page.url()).hash, "#main-content");
  records.push("keyboard skip navigation targets main content");

  console.log("PASS: " + records.join("; "));
} finally {
  await Promise.all(contexts.map(c => c.close().catch(() => {})));
  await browser.close();
}
