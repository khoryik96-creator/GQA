"use strict";

const { fork } = require("node:child_process");
const path = require("node:path");
const crypto = require("node:crypto");

// The runner HTTP service retains its token. One-shot children receive only
// runtime essentials and the bounded origin allowlist, never the auth secret.
function sanitizedChildEnv(original) {
  const allowed = ["PATH", "HOME", "LANG", "NODE_ENV",
    "PLAYWRIGHT_BROWSERS_PATH", "XDG_CACHE_HOME", "FONTCONFIG_PATH"];
  const env = {};
  for (const k of allowed) if (typeof original[k] === "string") env[k] = original[k];
  env.GQA_SMOKE_TARGETS = original.GQA_SMOKE_TARGETS || "";
  return env;
}

function failureResult(kind) {
  return {
    checks: [{ name: "One-shot worker lifecycle", status: "failed", duration_ms: 0,
      detail: kind === "worker_timeout"
        ? "The test exceeded the worker's time limit"
        : "The disposable job process exited without valid evidence" }],
    screenshot_base64: "",
    evidence: {
      worker_lifecycle: "single_job_process", failure_kind: kind,
      console_errors: 0, page_exceptions: 0, failed_requests: 0, http_5xx: 0
    }
  };
}

function terminateGroup(child) {
  if (!child.pid) return;
  if (process.platform !== "win32") {
    try { process.kill(-child.pid, "SIGKILL"); return; } catch { /* fallback */ }
  }
  try { child.kill("SIGKILL"); } catch { /* already exited */ }
}

function runIsolatedJob(job, {
  script = path.join(__dirname, "job-worker.cjs"),
  timeoutMs = 55000,
  env = process.env
} = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 20 || timeoutMs > 60000) {
    return Promise.resolve(failureResult("invalid_worker_timeout"));
  }
  return new Promise(resolve => {
    let child;
    try {
      child = fork(script, [], {
        execArgv: [], cwd: __dirname, env: sanitizedChildEnv(env),
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        detached: process.platform !== "win32"
      });
    } catch {
      resolve(failureResult("worker_spawn_failure"));
      return;
    }
    const jobId = crypto.randomUUID();
    let settled = false;
    function finish(result, kill = false) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (kill) terminateGroup(child);
      result.evidence = { ...result.evidence,
        worker_lifecycle: "single_job_process", job_id: jobId };
      resolve(result);
    }
    const timer = setTimeout(() => finish(failureResult("worker_timeout"), true), timeoutMs);
    child.on("message", message => {
      if (message?.kind !== "result" || !message.result ||
          !Array.isArray(message.result.checks) ||
          message.result.checks.length === 0 ||
          message.result.checks.length > 20) {
        finish(failureResult("invalid_worker_result"), true);
      } else {
        finish(message.result);
      }
    });
    child.once("error", () => finish(failureResult("worker_spawn_failure"), true));
    child.once("exit", () => finish(failureResult("worker_crash")));
    child.send(job, error => {
      if (error) finish(failureResult("worker_ipc_failure"), true);
    });
  });
}

module.exports = { sanitizedChildEnv, failureResult, runIsolatedJob };
