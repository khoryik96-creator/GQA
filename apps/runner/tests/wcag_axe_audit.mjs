import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

/**
 * Automated WCAG 2.2 A/AA screening on an isolated GQA fixture.
 * This is a regression guard, not evidence of full WCAG conformance.
 */
const WEB = "http://localhost:3000";
const API = "http://localhost:8080";
if (process.env.CI !== "true" || process.env.GQA_UI_E2E_ISOLATED !== "YES" ||
    !process.env.GQA_UI_TEST_ADMIN_PASSWORD) {
  throw new Error("WCAG screen requires isolated CI fixture credentials");
}
const browser = await chromium.launch({headless:true});
const context = await browser.newContext({viewport:{width:1280,height:900},reducedMotion:"reduce"});
const page = await context.newPage();
const reports=[];
const errors=[];
const tags=["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"];

async function audit(name){
  await page.getByRole("main").waitFor();
  const results=await new AxeBuilder({page}).withTags(tags).analyze();
  const violations=results.violations.map(v=>({
    id:v.id,impact:v.impact,description:v.description,help:v.help,
    helpUrl:v.helpUrl,
    nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary,html:n.html?.slice(0,400)}))
  }));
  reports.push({name,url:new URL(page.url()).pathname,viewport:page.viewportSize(),
    passed:results.passes.length,incomplete:results.incomplete.length,violations});
  for(const v of violations){
    console.log("AXE "+name+" "+v.impact+" "+v.id+" nodes="+v.nodes.length+
      " targets="+JSON.stringify(v.nodes.slice(0,3).map(n=>n.target)));
    if(v.impact==="serious"||v.impact==="critical")errors.push(name+": "+v.id+" ("+v.nodes.length+" nodes)");
  }
}

try{
  await page.goto(WEB,{waitUntil:"domcontentloaded"});
  await page.getByRole("heading",{name:"Sign in to GQA"}).waitFor({timeout:30000});
  await audit("anonymous login");

  await page.getByRole("textbox",{name:"Account email"}).fill("admin@gqa.local");
  await page.getByLabel("Password").fill(process.env.GQA_UI_TEST_ADMIN_PASSWORD);
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await page.getByRole("button",{name:"Sign out"}).waitFor({timeout:20000});
  const create=await context.request.post(API+"/api/projects",{
    data:{name:"Axe accessibility CI fixture",repo_url:"https://github.com/khoryik96-creator/GQA",app_type:"web",stack:"CI"},
    headers:{Origin:WEB}
  });
  assert.equal(create.status(),201);
  const project=await create.json();
  await page.reload({waitUntil:"domcontentloaded"});
  await page.getByRole("button",{name:project.name,exact:true}).waitFor({timeout:20000});
  await page.getByRole("heading",{name:project.name}).waitFor();
  await audit("dashboard");

  await page.getByRole("button",{name:/Project Memory/}).click();
  await page.getByRole("heading",{name:"Persistent project memory"}).waitFor();
  await audit("project memory");

  await page.getByRole("button",{name:/Team Access/}).click();
  await page.getByRole("heading",{name:"Project team"}).waitFor();
  await audit("team access");

  await page.setViewportSize({width:390,height:844});
  await audit("mobile team access");
  await page.getByRole("button",{name:/Project Memory/}).click();
  await page.getByRole("heading",{name:"Persistent project memory"}).waitFor();
  await audit("mobile memory");

} finally {
  await fs.mkdir("ui-e2e-artifacts",{recursive:true});
  await fs.writeFile("ui-e2e-artifacts/wcag-axe-report.json",
    JSON.stringify({tool:"axe-core",tags,reports},null,2)+"\n");
  await context.close();
  await browser.close();
}
console.log("WCAG axe scans="+reports.length+" severe findings="+errors.length);
if(errors.length){
  console.error("Serious/critical accessibility regressions: "+errors.join("; "));
  process.exitCode=1;
}
