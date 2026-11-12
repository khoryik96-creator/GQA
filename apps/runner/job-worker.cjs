"use strict";

const { allowedTarget } = require("./policy.cjs");
const { validateFlow, runBrowserFlow } = require("./browser-flow.cjs");
const { runSmoke } = require("./smoke-runner.cjs");

let handled = false;
process.on("message", async (job) => {
  if (handled) return;
  handled = true;
  try {
    if (!job || !allowedTarget(job.target_url, process.env.GQA_SMOKE_TARGETS || "")) {
      throw new Error("Unapproved job target");
    }
    let result;
    if (job.kind === "flow" && validateFlow(job.steps)) {
      result = await runBrowserFlow(job.target_url, job.steps, process.env.GQA_SMOKE_TARGETS);
    } else if (job.kind === "smoke" &&
        typeof job.run_api === "boolean" &&
        typeof job.run_web === "boolean" &&
        (job.run_api || job.run_web)) {
      result = await runSmoke(job.target_url, job.run_api, job.run_web);
    } else {
      throw new Error("Invalid job specification");
    }
    result.evidence = {
      ...result.evidence,
      worker_lifecycle: "single_job_process"
    };
    process.send?.({ kind: "result", result }, () => process.exit(0));
  } catch {
    process.send?.({ kind: "result", result: {
      checks: [{ name: "One-shot job validation", status: "failed",
        duration_ms: 0, detail: "The runner could not complete the approved job" }],
      screenshot_base64: "",
      evidence: { worker_lifecycle: "single_job_process",
        failure_kind: "worker_error", console_errors: 0,
        page_exceptions: 0, failed_requests: 0, http_5xx: 0 }
    } }, () => process.exit(1));
  }
});
