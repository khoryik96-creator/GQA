"use strict";

const http = require("node:http");
const crypto = require("node:crypto");
const { allowedTarget } = require("./policy.cjs");
const { validateFlow } = require("./browser-flow.cjs");
const { runIsolatedJob } = require("./job-supervisor.cjs");

const PORT = Number(process.env.PORT || 8090);
const ALLOWLIST = process.env.GQA_SMOKE_TARGETS || "http://fixture:8081";
const TOKEN = process.env.GQA_RUNNER_TOKEN || "";
let running = false;

function tokenMatches(actual, expected) {
  if (!actual || !expected) return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function send(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json",
    "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(JSON.stringify(payload));
}
const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    return send(res, 200, {status:"ok",busy:running,mode:"one-shot-job-process"});
  }
  if (req.method !== "POST" || !["/run","/flow"].includes(req.url)) {
    return send(res, 404, {error:"Not found"});
  }
  if (!tokenMatches(req.headers["x-gqa-runner-token"], TOKEN)) {
    return send(res, 401, {error:"Unauthorized"});
  }
  if (running) return send(res, 429, {error:"Runner busy"});
  let raw = "";
  let tooLarge = false;
  req.on("data", chunk => {
    raw += chunk;
    if (raw.length > 16384) { tooLarge = true; raw = ""; }
  });
  req.on("end", async () => {
    if (tooLarge) return send(res, 413, {error:"Payload exceeds limit"});
    let input;
    try { input = JSON.parse(raw); } catch { return send(res, 400, {error:"Invalid JSON"}); }
    if (!input || typeof input !== "object" || !allowedTarget(input.target_url, ALLOWLIST)) {
      return send(res, 403, {error:"Target is not approved"});
    }
    const kind = req.url === "/flow" ? "flow" : "smoke";
    if (kind === "flow" && !validateFlow(input.steps)) {
      return send(res, 400, {error:"Browser flow is not valid"});
    }
    if (kind === "smoke" && (typeof input.run_api !== "boolean" ||
      typeof input.run_web !== "boolean" || (!input.run_api && !input.run_web))) {
      return send(res, 400, {error:"Invalid smoke request"});
    }
    running = true;
    try {
      const result = await runIsolatedJob({
        kind, target_url: input.target_url,
        ...(kind === "flow" ? {steps:input.steps} :
          {run_api:input.run_api,run_web:input.run_web})
      });
      send(res, 200, result);
    } catch {
      send(res, 500, {error:"Unable to complete isolated job"});
    } finally {
      running = false;
    }
  });
});
server.requestTimeout = 65000;
server.listen(PORT, "0.0.0.0", () => console.log("GQA one-shot worker supervisor ready on " + PORT));
