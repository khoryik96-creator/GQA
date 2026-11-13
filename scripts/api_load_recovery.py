#!/usr/bin/env python3
"""Disposable CI-only authenticated read load and PostgreSQL interruption probe.

Deliberately no third-party packages, internet requests, or write-heavy
concurrency. Set GQA_ISOLATED_LOAD_TEST=YES and use a localhost-only API.
Never execute this against a deployed or user-owned database.
"""
import concurrent.futures
import http.cookiejar
import json
import os
import statistics
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = "http://127.0.0.1:8080"
ORIGIN = "http://localhost:3000"
WORKERS = 12
REQUESTS = 360
PROJECT_NAME = "GQA disposable performance and recovery fixture"


def check_isolated():
    if os.environ.get("GQA_ISOLATED_LOAD_TEST") != "YES":
        raise RuntimeError("Refusing live execution without GQA_ISOLATED_LOAD_TEST=YES")
    if os.environ.get("CI") != "true":
        raise RuntimeError("Refusing execution outside a disposable CI runner")
    if not Path(".env").is_file():
        raise RuntimeError("Expected isolated CI .env in repository root")
    if not Path("compose.yaml").is_file():
        raise RuntimeError("Run from the GQA repository root")


def request(path, method="GET", payload=None, cookie=""):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"Origin": ORIGIN}
    if data is not None:
        headers["Content-Type"] = "application/json"
    if cookie:
        headers["Cookie"] = cookie
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=12) as response:
            raw = response.read()
            return response.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as exc:
        return exc.code, None


def wait_api(cookie=None, timeout=75):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            path = "/api/projects" if cookie else "/healthz"
            status, body = request(path, cookie=cookie or "")
            if status == 200 and (not cookie or isinstance(body, list)):
                return
        except (OSError, ValueError):
            pass
        time.sleep(1)
    raise AssertionError("API did not recover authenticated database access")


def authenticate():
    lines = Path(".env").read_text(encoding="utf-8").splitlines()
    password = next(line.split("=", 1)[1] for line in lines if line.startswith("GQA_ADMIN_PASSWORD="))
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    login = urllib.request.Request(BASE + "/api/auth/login", data=json.dumps({
        "password": password
    }).encode(), method="POST", headers={
        "Content-Type": "application/json", "Origin": ORIGIN
    })
    with opener.open(login, timeout=15) as response:
        if response.status != 200:
            raise AssertionError("Unable to authenticate isolated fixture")
    cookie = "; ".join(c.name + "=" + c.value for c in jar)
    if not cookie:
        raise AssertionError("Authenticated session cookie was not received")
    return cookie


def populate_fixture(cookie):
    status, project = request("/api/projects", "POST", {
        "name": PROJECT_NAME,
        "repo_url": "https://github.com/khoryik96-creator/GQA",
        "app_type": "api",
        "stack": "synthetic load testing"
    }, cookie)
    if status != 201:
        raise AssertionError("Unable to create isolated load fixture: " + str(status))
    pid = project["id"]
    for number in range(40):
        status, _ = request("/api/projects/" + pid + "/memories", "POST", {
            "kind": "requirement",
            "content": "isolated deterministic load fixture record %03d" % number
        }, cookie)
        if status != 201:
            raise AssertionError("Memory fixture seed failed: " + str(status))
    return pid


def run_read_load(cookie, project_id):
    paths = [
        "/api/projects",
        "/api/projects/" + project_id + "/memories?limit=10",
        "/api/projects/" + project_id + "/plans?limit=10",
        "/api/projects/" + project_id + "/runs?limit=10",
        "/api/projects/" + project_id + "/flows?limit=10",
        "/api/auth/session"
    ]
    def sample(index):
        path = paths[index % len(paths)]
        started = time.perf_counter()
        try:
            status, body = request(path, cookie=cookie)
            if status != 200:
                return (time.perf_counter() - started) * 1000, "status=" + str(status)
            if path.endswith("limit=10") and (
                not isinstance(body, dict) or "items" not in body
                or "next_cursor" not in body
            ):
                return (time.perf_counter() - started) * 1000, "invalid page"
            return (time.perf_counter() - started) * 1000, None
        except (OSError, ValueError) as exc:
            return (time.perf_counter() - started) * 1000, type(exc).__name__

    # A deterministic request mix; no concurrent database writes, smoke jobs,
    # worker executions, or unauthorised external targets.
    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
        results = list(pool.map(sample, range(REQUESTS)))
    durations = sorted(ms for ms, _ in results)
    errors = [err for _, err in results if err]
    report = {
        "requests": REQUESTS,
        "workers": WORKERS,
        "errors": len(errors),
        "error_samples": errors[:10],
        "p50_ms": round(statistics.median(durations), 2),
        "p95_ms": round(durations[int(0.95 * (len(durations) - 1))], 2),
        "p99_ms": round(durations[int(0.99 * (len(durations) - 1))], 2),
        "max_ms": round(max(durations), 2),
    }
    Path("gqa-api-concurrency-report.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    print("Concurrent read baseline:", json.dumps(report, sort_keys=True))
    if errors:
        raise AssertionError("Authenticated read requests failed under bounded load")
    return report


def docker(*args):
    subprocess.run(["docker", "compose", *args], check=True, timeout=120)


def exercise_db_interruption(cookie, project_id):
    # This exercises the already-running API, not an external host or an
    # existing-volume restore. The fixture is disposable and CI-exclusive.
    stopped = False
    try:
        docker("stop", "db")
        stopped = True
        status, _ = request("/api/projects/" + project_id + "/memories?limit=10", cookie=cookie)
        if status != 503:
            raise AssertionError("Expected retryable 503 during DB outage, not " + str(status))
        print("Database interruption produced retryable HTTP 503 without revoking the session")
    finally:
        if stopped:
            docker("up", "-d", "--wait", "db")
    wait_api(cookie, 75)
    status, page = request("/api/projects/" + project_id + "/memories?limit=10", cookie=cookie)
    if status != 200 or len(page.get("items", [])) != 10:
        raise AssertionError("API failed to restore authenticated project reads after DB restart")
    print("PASS: same authenticated session and project data recovered after database restart")


def main():
    check_isolated()
    wait_api()
    cookie = authenticate()
    project_id = populate_fixture(cookie)
    run_read_load(cookie, project_id)
    exercise_db_interruption(cookie, project_id)
    print("PASS: bounded concurrency, project isolation and DB interruption recovery")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("FAIL:", type(exc).__name__, str(exc), file=sys.stderr)
        raise
