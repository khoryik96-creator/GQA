import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { chromium } from "playwright";

if(process.env.CI!=="true"||process.env.GQA_UI_E2E_ISOLATED!=="YES"||
   !process.env.GQA_UI_TEST_ADMIN_PASSWORD){
  throw new Error("Typed-flow E2E is restricted to disposable CI");
}
const API="http://localhost:8080",WEB="http://localhost:3000";
const suffix=randomBytes(5).toString("hex");
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1365,height:900}});
async function request(method,path,data){
 const res=await context.request.fetch(API+path,{method,
  ...(data===undefined?{}:{data}),headers:{Origin:WEB},timeout:45000});
 return res;
}
try{
 const auth=await request("POST","/api/auth/login",{
  email:"admin@gqa.local",password:process.env.GQA_UI_TEST_ADMIN_PASSWORD
 });
 assert.equal(auth.status(),200);
 const projectResponse=await request("POST","/api/projects",{
  name:"UI typed revision "+suffix,repo_url:"https://github.com/khoryik96-creator/GQA",
  app_type:"web",stack:"isolated"
 });
 assert.equal(projectResponse.status(),201);
 const project=await projectResponse.json(),prefix="/api/projects/"+project.id;
 const planResponse=await request("POST",prefix+"/plans",{
  prompt:"Verify the application homepage and API health using read-only smoke checks",
  environment:"local"
 });
 assert.equal(planResponse.status(),201);
 const plan=await planResponse.json();
 const flowResponse=await request("POST",prefix+"/flows",{
  plan_id:plan.id,
  prompt:"Open the demo app, click Show details and verify fixture details are visible"
 });
 assert.equal(flowResponse.status(),201);
 const source=await flowResponse.json();
 const page=await context.newPage();
 await page.goto(WEB,{waitUntil:"domcontentloaded"});
 await page.getByRole("heading",{name:"Browser Flow Studio"}).waitFor();
 await page.getByRole("button",{name:"Edit typed steps as a new version"}).click();
 const expected="Edited review assertion "+suffix;
 await page.getByRole("textbox",{name:"Expected visible text"}).fill(expected);
 await page.getByRole("button",{name:"Save new version for review"}).click();
 await page.getByRole("button",{name:"Version 2 · selected"}).waitFor({timeout:20000});
 const ack=page.getByRole("checkbox",{name:/I reviewed every action and assertion/});
 assert.equal(await ack.isChecked(),false,"Editing must invalidate prior acknowledgement");
 assert.equal(await page.getByRole("button",{name:"Execute reviewed flow"}).isDisabled(),true);
 const all=await request("GET",prefix+"/flows?limit=25");
 assert.equal(all.status(),200);
 const flows=(await all.json()).items;
 const revision=flows.find(x=>x.revised_from_flow_id===source.id);
 assert.ok(revision,"UI revision was not persisted");
 assert.notEqual(revision.digest,source.digest);
 assert.equal(revision.steps.at(-1).text,expected);
 const history=await request("GET",prefix+"/flows/"+revision.id+"/revisions");
 assert.equal(history.status(),200);
 assert.deepEqual((await history.json()).map(x=>x.id),[source.id,revision.id]);
 console.log("PASS: typed UI edits create immutable history, new digest and cleared execution acknowledgement");
}finally{
 await context.close();
 await browser.close();
}
