#!/usr/bin/env python3
"""CI-only race: revoke a QA member while their runner request is in flight.

The runner is paused ONLY inside the disposable Docker Compose fixture; it is
always unpaused in finally. Nothing touches user-owned servers or volumes.
"""
import http.cookiejar
import json
import os
from pathlib import Path
import subprocess
import threading
import time
import urllib.error
import urllib.request
from uuid import uuid4

BASE = "http://127.0.0.1:8080"
ORIGIN = "http://localhost:3000"
if os.environ.get("CI") != "true" or os.environ.get("GQA_ISOLATED_REVOCATION_TEST") != "YES":
    raise RuntimeError("Refusing permission-race test outside isolated CI")

password = next(line.split("=", 1)[1] for line in Path(".env").read_text().splitlines()
                if line.startswith("GQA_ADMIN_PASSWORD="))


def client():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def call(opener, path, payload=None, method=None, timeout=65):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(BASE + path, data=data, method=method or ("POST" if data else "GET"),
       headers={"Origin": ORIGIN, "Content-Type": "application/json"})
    try:
        with opener.open(req, timeout=timeout) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        return exc.code, json.loads(raw) if raw else None


admin = client()
status, _ = call(admin, "/api/auth/login", {
    "email": "admin@gqa.local", "password": password
})
assert status == 200
suffix = uuid4().hex[:10]
email = "revoked-inflight-" + suffix + "@example.test"
qa_password = "test-only-" + uuid4().hex + uuid4().hex[:8]
status, project = call(admin, "/api/projects", {
    "name": "GQA disposable revocation race " + suffix,
    "repo_url": "https://github.com/khoryik96-creator/GQA",
    "app_type": "web", "stack": "isolated"
})
assert status == 201, status
prefix = "/api/projects/" + project["id"]
status, plan = call(admin, prefix + "/plans", {
    "prompt": "Verify the application homepage and API health using read-only smoke checks",
    "environment": "local"
})
assert status == 201
status, flow = call(admin, prefix + "/flows", {
    "plan_id": plan["id"],
    "prompt": "Open the demo app, click Show details and verify fixture details are visible"
})
assert status == 201
status, user = call(admin, "/api/admin/users", {"email": email, "password": qa_password})
assert status == 201
status, _ = call(admin, prefix + "/members", {"email": email, "role": "qa"})
assert status == 200

qa = client()
status, _ = call(qa, "/api/auth/login", {"email": email, "password": qa_password})
assert status == 200
result = {}
paused = False
try:
    subprocess.run(["docker", "compose", "pause", "runner"], check=True, timeout=20)
    paused = True

    def execute():
        try:
            result["response"] = call(qa, prefix + "/flows/" + flow["id"] + "/execute", {
                "target_url": "http://fixture:8081",
                "acknowledged_digest": flow["digest"]
            }, timeout=45)
        except Exception as exc:
            result["exception"] = str(exc)

    worker = threading.Thread(target=execute, daemon=True)
    worker.start()
    running = False
    for _ in range(80):
        status, page = call(admin, prefix + "/runs?limit=10")
        assert status == 200
        running = any(run["flow_id"] == flow["id"] and run["status"] == "running"
                      for run in page["items"])
        if running:
            break
        time.sleep(.1)
    assert running, "A paused runner request never reached the durable running state"
    status, _ = call(admin, prefix + "/members/" + user["id"], method="DELETE")
    assert status == 204, status
    worker.join(timeout=15)
    assert not worker.is_alive(), "The revoked job did not cancel within the bounded interval"
    assert "exception" not in result, result
    assert result["response"][0] == 403, result
    status, page = call(admin, prefix + "/runs?limit=10")
    assert status == 200
    revoked_run = next(run for run in page["items"] if run["flow_id"] == flow["id"])
    assert revoked_run["status"] == "failed", revoked_run
    assert not revoked_run["screenshot_available"], revoked_run
    assert all(check["status"] != "passed" for check in revoked_run["checks"]), revoked_run
    print("PASS: revoked in-flight QA execution cancelled and finalized with failed evidence and HTTP 403")
finally:
    if paused:
        subprocess.run(["docker", "compose", "unpause", "runner"], check=True, timeout=20)

# A cancelled HTTP request can leave the isolated single-slot runner finishing
# its own child process briefly after the API returns. Do not race it by
# immediately submitting a new job; wait for its actual /healthz busy flag.
probe = ("fetch('http://127.0.0.1:8090/healthz',"
         "{signal:AbortSignal.timeout(3000)})"
         ".then(r=>r.json()).then(x=>process.exit(x.busy?1:0))"
         ".catch(()=>process.exit(1))")
for attempt in range(60):
    health = subprocess.run(["docker", "compose", "exec", "-T", "runner",
                             "node", "-e", probe], capture_output=True,
                            text=True, timeout=8)
    if health.returncode == 0:
        break
    time.sleep(1)
else:
    raise AssertionError("Runner remained busy or unhealthy after cancellation")

# Authorized QA execution remains functional when the runner becomes idle.
status, _ = call(admin, prefix + "/members", {"email": email, "role": "qa"})
assert status == 200
status, restored = call(qa, prefix + "/flows/" + flow["id"] + "/execute", {
    "target_url": "http://fixture:8081",
    "acknowledged_digest": flow["digest"]
}, timeout=65)
assert status == 201 and restored["status"] == "passed", (status, restored)
print("PASS: restored QA role can execute the same reviewed fixture successfully")
