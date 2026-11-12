# GQA v0.11 release acceptance checklist

Status: **review candidate; no merge or production release is authorized.**

## Before merging to main

- [ ] Review PR #12's cumulative diff against the original bootstrap main.
- [ ] Review detailed feature history in stacked PRs #1–#11.
- [ ] Foundation CI: Go tests, TypeScript/Next.js build, Node runner tests,
      and host broker policy / scheduler tests **passed on the candidate head**.
- [ ] Docker integration: real local smoke/browser tests, evidence,
      repair/replay, and multi-user RBAC/account-security behavior **passed**.
- [ ] Experimental disposable-container integration: new restricted job
      container per run, queue status, restart journal, screenshot and forced
      cleanup **passed**.
- [ ] Security defaults reviewed: runner and fixture networks remain private;
      test targets limited to fixtures; API/web bound to loopback.
- [ ] Confirm no credentials, generated .env, screenshots or journal files
      have entered Git.
- [ ] Review the current README, the role model and bootstrap-password
      behavior. Confirm no instructions suggest public deployment.
- [ ] Create a backup of any local PostgreSQL/evidence volumes used to test
      the release. **Do not use docker compose down -v** without a backup.
- [ ] Record the final reviewed candidate SHA and maintainers' approval.
- [ ] Only then merge the consolidated PR to main (or merge the stacked
      PRs intentionally in dependency order; **not both approaches**).

## After an approved merge

- [ ] Verify main's commit equals the reviewed release.
- [ ] Verify Foundation CI after push to main.
- [ ] Clone from main into a fresh working directory and run the default
      Docker stack with newly generated local credentials.
- [ ] Confirm admin login, project creation, test execution, screenshot
      download, logout and relogin.
- [ ] Confirm optional host broker is **off by default**.
- [ ] Review outstanding feature PRs; close superseded drafts with
      explanatory comments rather than merging overlapping changes twice.
- [ ] Keep a clear rollback/backup plan and document known residual risks.

## Not acceptable as a production release

- Hosting the UI/API or broker on public internet without independent
  security review and infrastructure controls.
- Testing untrusted sites or exposing privileged host Docker capabilities.
- Real customer data, secrets or credentials in browser flow input or
  persistent job journals.
- Claims of VM-grade isolation, SOC2, multi-tenant commercial SaaS,
  arbitrary-site autonomous agents, or GDPR/PDPA compliance certifications.

This checklist is a review aid, **not** a declaration that every item has
been completed.
