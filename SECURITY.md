# Security policy — GQA local developer prototype

**Supported deployment:** trusted developer workstations with loopback-bound
web/API ports and the default private Docker test network. No production
security guarantee exists for any current branch, including v0.11.

Do not publish the service to the internet, accept untrusted target websites,
load actual customer data, run privileged credentials through tests, or mount
the Docker socket inside web/API/runner containers.

The optional host-side broker **has powerful Docker engine permissions**.
Keep TCP port 18090 isolated with host firewall rules and use independent,
high-entropy GQA runner/admin credentials. Browser containers still share
the host kernel and Chromium's own sandbox remains disabled.

## Reporting vulnerabilities

Report suspected security issues privately to the repository owner using
GitHub's private vulnerability reporting feature, if available. If it is
not enabled, contact the maintainer privately through a channel you already
trust before sharing exploit details, credentials or private logs.

For non-sensitive bugs, open a GitHub issue with the affected feature, commit,
steps to reproduce and sanitized logs. Never paste secret tokens or account
passwords into public issues.

## Known hardening backlog

- Dedicated trusted execution host or microVM isolation, away from the
  development workstation.
- Strong multi-organization authorization, independently scoped secrets,
  MFA/SSO, lifecycle-managed tokens and distributed login throttling.
- Network egress policy suitable for *explicitly authorized* staging sites.
- Durable audit and retention policy for evidence, screenshots and job
  history, with incident-response hooks.
- In-flight job cancellation when permission is revoked.
- Security evaluation, dependency scanning and third-party threat review.

Passing unit, integration and Docker tests does not imply these controls exist.
