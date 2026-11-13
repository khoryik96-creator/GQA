import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { chromium } from "playwright";

// This exercises only disposable CI fixtures. Never target a live GQA system.
if (process.env.CI !== "true" || process.env.GQA_UI_E2E_ISOLATED !== "YES" ||
    !process.env.GQA_UI_TEST_ADMIN_PASSWORD) {
  throw new Error("Browser repair review E2E requires disposable CI credentials");
}
const API = "http://localhost:8080";
const WEB = "http://localhost:3000";
const browser = await chromium.launch({ headless: true });
const contexts = [];
const suffix = randomBytes(5).toString("hex");
const reviewerEmail = "review-flow-" + suffix + "@example.test";
const reviewerPassword = randomBytes(22).toString("hex");
const revision = "fixture-review-" + suffix;

async function authenticate(email, password) {
  const context = await browser.newContext({viewport:{width:1280,height:900},reducedMotion:"reduce"});
  contexts.push(context);
  const response = await context.request.post(API + "/api/auth/login", {
    data: {email,password},headers: {Origin:WEB}
  });
  assert.equal(response.status(), 200, "Fixture login failed for " + email);
  return context;
}
async function api(context,method,path,data) {
  const response = await context.request.fetch(API + path, {
    method, ...(data === undefined ? {} : {data}), headers: {Origin:WEB},timeout:90000
  });
  return response;
}
async function created(context,path,data) {
  const response=await api(context,"POST",path,data);
  assert.ok([200,201].includes(response.status()),
    "Fixture write failed (" + response.status() + "): " + path + " " + (await response.text()));
  return response.json();
}
async function dashboard(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await page.goto(WEB,{waitUntil:"domcontentloaded"});
  await page.getByRole("button",{name:"Sign out"}).waitFor();
  return page;
}

try {
  const admin = await authenticate("admin@gqa.local",process.env.GQA_UI_TEST_ADMIN_PASSWORD);
  const project = await created(admin,"/api/projects",{
    name:"Reviewed Repair Browser E2E "+suffix,
    repo_url:"https://github.com/khoryik96-creator/GQA",
    app_type:"web",stack:"fixture-only CI test"
  });
  const plan=await created(admin,"/api/projects/"+project.id+"/plans",{
    prompt:"Verify the application homepage and API health using read-only smoke checks",
    environment:"local"
  });
  assert.ok(plan.selected_agents.some(x=>x.id==="web"),"Fixture plan lacks Web QA");
  const prefix="/api/projects/"+project.id;
  const original=await created(admin,prefix+"/flows",{
    plan_id:plan.id,
    prompt:"Open the demo app, click Show details and verify fixture details are visible"
  });
  assert.equal(original.generation_mode,"rules");
  const failed=await created(admin,prefix+"/flows/"+original.id+"/execute",{
    target_url:"http://fixture-renamed:8081",
    acknowledged_digest:original.digest
  });
  assert.equal(failed.status,"failed");
  assert.ok(failed.checks.some(c=>c.repair?.proposed_name==="Reveal details"),
    "Expected a controlled locator-change suggestion");

  const reviewer=await created(admin,"/api/admin/users",{
    email:reviewerEmail,password:reviewerPassword
  });
  await created(admin,prefix+"/members",{email:reviewerEmail,role:"reviewer"});

  const page=await dashboard(admin);
  await page.getByRole("heading",{name:"Browser Flow Studio"}).waitFor();
  await page.getByText("Possible locator change").waitFor({timeout:20000});
  await page.getByRole("button",{name:"Create reviewable repair proposal"}).click();
  await page.getByText("Repair lineage:").waitFor({timeout:20000});
  const approvedOrigin=page.getByRole("textbox",{name:"Approved test origin"});
  assert.equal(await approvedOrigin.inputValue(),"http://fixture-renamed:8081");
  assert.equal(await approvedOrigin.getAttribute("readonly"),"");
  const execute=page.getByRole("button",{name:"Execute reviewed flow"});
  assert.equal(await execute.isDisabled(),true,"Unacknowledged flow must not execute");
  await page.getByRole("checkbox",{name:/I reviewed every action and assertion/}).check();
  assert.equal(await execute.isEnabled(),true);
  await execute.click();
  await page.locator(".browser-flow-result .pill",{hasText:"passed"}).waitFor({timeout:90000});

  const repairedResponse=await api(admin,"GET",prefix+"/flows?limit=10");
  assert.equal(repairedResponse.status(),200);
  const flows=(await repairedResponse.json()).items;
  const repair=flows.find(f=>f.repaired_from_run_id===failed.id);
  assert.ok(repair,"UI-created repair proposal was not persisted");
  const originalAssertions=original.steps.filter(a=>a.op.startsWith("assert_"));
  const newAssertions=repair.steps.filter(a=>a.op.startsWith("assert_"));
  assert.deepEqual(newAssertions,originalAssertions,
    "Repair must never alter original application assertions");
  const runResponse=await api(admin,"GET",prefix+"/runs?limit=10");
  assert.equal(runResponse.status(),200);
  const run=(await runResponse.json()).items.find(r=>r.flow_id===repair.id&&r.status==="passed");
  assert.ok(run,"UI-executed repair did not persist a successful replay");

  // A reviewer can approve a successful replay, but cannot execute a flow or
  // create new project memories. Both the rendered UI and backend are tested.
  const reviewerContext=await authenticate(reviewerEmail,reviewerPassword);
  const reviewerPage=await dashboard(reviewerContext);
  await reviewerPage.getByRole("heading",{name:"Browser Flow Studio"}).waitFor();
  await reviewerPage.getByText("Record this verified correction").waitFor({timeout:20000});
  assert.equal(await reviewerPage.getByRole("button",{name:"Execute reviewed flow"}).isDisabled(),true);
  assert.equal(await reviewerPage.getByRole("button",{name:"Draft browser flow"}).isDisabled(),true);
  const forbidden=await api(reviewerContext,"POST",prefix+"/flows",{
    plan_id:plan.id,prompt:"This reviewer must not draft actions"
  });
  assert.equal(forbidden.status(),403);
  const revisionField=reviewerPage.getByRole("textbox",{name:/Application version or commit ID/});
  await revisionField.fill(revision);
  await reviewerPage.getByRole("button",{name:"Confirm and save verified repair"}).click();
  await reviewerPage.getByText("Verified locator lesson saved").waitFor({timeout:20000});
  const lessonsResponse=await api(reviewerContext,"GET",prefix+"/repairs");
  assert.equal(lessonsResponse.status(),200);
  const lessons=await lessonsResponse.json();
  const lesson=lessons.find(x=>x.repaired_flow_id===repair.id);
  assert.ok(lesson,"Approved repair has no durable review record");
  assert.equal(lesson.app_revision,revision);
  const repeats=await api(reviewerContext,"POST",prefix+"/flows/"+repair.id+"/confirm-repair",{
    successful_run_id:run.id,app_revision:revision
  });
  assert.equal(repeats.status(),409,"Second confirmation must be rejected");
  console.log("PASS: failed browser flow → UI repair proposal → acknowledged replay → reviewer approval → immutable, version-scoped lesson");
} finally {
  await Promise.all(contexts.map(c=>c.close().catch(()=>{})));
  await browser.close();
}
