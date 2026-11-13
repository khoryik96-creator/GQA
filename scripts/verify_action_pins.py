#!/usr/bin/env python3
"""Reject floating or unapproved GitHub Actions references in GQA workflows."""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
ACTIONS = {
    "actions/checkout": "11d5960a326750d5838078e36cf38b85af677262",  # v4
    "actions/setup-node": "49933ea5288caeca8642d1e84afbd3f7d6820020",  # v4
    "actions/setup-go": "40f1582b2485089dde7abd97c1529aa768e1baff",  # v5
    "actions/upload-artifact": "ea165f8d65b6e75b540449e92b4886f43607fa02",  # v4
    "aquasecurity/trivy-action": "ed142fd0673e97e23eac54620cfb913e5ce36c25",  # v0.36.0
    "anchore/sbom-action": "e22c389904149dbc22b58101806040fa8d37a610",  # v0
}
USES = re.compile(r"^\s*(?:-\s*)?uses:\s*(\S+)", re.MULTILINE)
SHA = re.compile(r"[0-9a-f]{40}\Z")


def validate_workflow(source: str) -> list[str]:
    problems: list[str] = []
    for action in USES.findall(source):
        if action.startswith("./"):
            continue  # Local checked-in actions do not use Git refs.
        if "@" not in action:
            problems.append(f"{action}: unpinned action")
            continue
        name, sha = action.rsplit("@", 1)
        if not SHA.fullmatch(sha):
            problems.append(f"{action}: expected a full 40-character commit SHA")
        elif name not in ACTIONS:
            problems.append(f"{name}: action has not been explicitly reviewed")
        elif ACTIONS[name] != sha:
            problems.append(f"{name}: commit SHA differs from reviewed version")
    return problems


def main() -> int:
    workflows = sorted((ROOT / ".github" / "workflows").glob("*.yml"))
    if not workflows:
        print("ERROR: no GitHub workflows found", file=sys.stderr)
        return 1
    problems = []
    checked = 0
    for path in workflows:
        source = path.read_text(encoding="utf-8")
        checked += len(USES.findall(source))
        problems += [f"{path.relative_to(ROOT)}: {error}"
                     for error in validate_workflow(source)]
    if problems:
        print("\n".join(problems), file=sys.stderr)
        return 1
    print(f"PASS: {checked} GitHub Actions references checked across "
          f"{len(workflows)} workflows; remote actions pinned to reviewed commits")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
