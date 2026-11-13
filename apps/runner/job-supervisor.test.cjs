"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { sanitizedChildEnv, runIsolatedJob } = require("./job-supervisor.cjs");

test("child environment excludes API secrets and credentials", () => {
  const result = sanitizedChildEnv({
    PATH: "/bin", HOME: "/tmp", GQA_SMOKE_TARGETS: "http://fixture:8081",
    GQA_RUNNER_TOKEN: "runner_secret", GQA_ADMIN_PASSWORD: "admin_secret",
    GQA_LLM_API_KEY: "model_secret", DATABASE_URL: "postgresql://hidden"
  });
  assert.equal(result.PATH, "/bin");
  assert.equal(result.GQA_SMOKE_TARGETS, "http://fixture:8081");
  for (const key of ["GQA_RUNNER_TOKEN","GQA_ADMIN_PASSWORD","GQA_LLM_API_KEY","DATABASE_URL"]) {
    assert.equal(Object.hasOwn(result, key), false, key);
  }
});

test("each job gets fresh single-use child and a distinct job identity", async () => {
  const script = path.join(__dirname, "fixtures", "echo-job.cjs");
  const [a,b] = await Promise.all([
    runIsolatedJob({kind:"a"}, {script, timeoutMs:1500}),
    runIsolatedJob({kind:"b"}, {script, timeoutMs:1500})
  ]);
  assert.equal(a.checks[0].status,"passed");
  assert.equal(b.checks[0].status,"passed");
  assert.notEqual(a.evidence.job_id,b.evidence.job_id);
  assert.equal(a.evidence.worker_lifecycle,"single_job_process");
});

test("hanging job is forcibly bounded and explicitly failed", async () => {
  const script = path.join(__dirname, "fixtures", "hanging-job.cjs");
  const result = await runIsolatedJob({kind:"hang"}, {script, timeoutMs:300});
  assert.equal(result.checks[0].status,"failed");
  assert.equal(result.evidence.failure_kind,"worker_timeout");
});

test("client abort kills a previously spawned hanging one-shot worker", async () => {
  const controller = new AbortController();
  const script = path.join(__dirname, "fixtures", "hanging-job.cjs");
  const pending = runIsolatedJob({kind:"hang"}, {
    script, timeoutMs:3000, signal:controller.signal
  });
  setTimeout(() => controller.abort(), 120);
  const result = await pending;
  assert.equal(result.checks[0].status, "failed");
  assert.equal(result.evidence.failure_kind, "worker_cancelled");
});

test("pre-aborted worker request fails without spawning a child", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await runIsolatedJob({kind:"aborted"}, {
    script:"does-not-exist.cjs", timeoutMs:500, signal:controller.signal
  });
  assert.equal(result.evidence.failure_kind, "worker_cancelled");
  assert.equal(result.checks[0].status, "failed");
});
