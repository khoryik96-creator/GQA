"use strict";
const { allowedTarget } = require("./policy.cjs");
const { validateFlow, runBrowserFlow } = require("./browser-flow.cjs");
const { runSmoke } = require("./smoke-runner.cjs");

// A one-shot entrypoint for a fresh Docker container. Only demo-fixture
// input is accepted. No host directories, credentials, or Docker socket.
async function main() {
  const encoded = process.env.GQA_JOB_SPEC || "";
  if (encoded.length > 21000) throw new Error("Invalid job size");
  const job = JSON.parse(Buffer.from(encoded,"base64").toString("utf8"));
  const allowed = "http://fixture:8081,http://fixture-renamed:8081";
  if (!job || !allowedTarget(job.target_url,allowed)) throw new Error("Target not allowed");
  let result;
  if (job.kind==="flow" && validateFlow(job.steps)) {
    result = await runBrowserFlow(job.target_url,job.steps,allowed);
  } else if (job.kind==="smoke" && typeof job.run_api==="boolean" &&
      typeof job.run_web==="boolean" && (job.run_api||job.run_web)) {
    result = await runSmoke(job.target_url,job.run_api,job.run_web);
  } else throw new Error("Invalid job");
  result.evidence={...result.evidence,worker_lifecycle:"ephemeral_container"};
  if (!Array.isArray(result.checks) || JSON.stringify(result).length>1950000)
    throw new Error("Result too large");
  process.stdout.write(JSON.stringify(result));
}
main().catch(() => {
  process.stderr.write("GQA ephemeral job failed without valid results\n");
  process.exitCode=1;
});
