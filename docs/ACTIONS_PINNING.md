# GitHub Actions immutable commit pinning

All remote `uses:` references in the repository's ten GitHub Actions workflow files are pinned to full 40-character commits, rather than moving major-version tags. A dedicated standard-library policy script (`scripts/verify_action_pins.py`) verifies the exact reviewed commit map. `scripts/test_verify_action_pins.py` checks common bypasses (floating refs, unknown actions and swapped SHAs). These run in the dependency/security workflow on each PR, push and scheduled security run.

Approved pins were resolved from upstream GitHub tag refs on 13 November 2026:

| Action | Reviewed upstream tag | Commit |
| --- | --- | --- |
| actions/checkout | v4 | `11d5960a326750d5838078e36cf38b85af677262` |
| actions/setup-node | v4 | `49933ea5288caeca8642d1e84afbd3f7d6820020` |
| actions/setup-go | v5 | `40f1582b2485089dde7abd97c1529aa768e1baff` |
| actions/upload-artifact | v4 | `ea165f8d65b6e75b540449e92b4886f43607fa02` |
| aquasecurity/trivy-action | v0.36.0 (verified signed annotated tag) | `ed142fd0673e97e23eac54620cfb913e5ce36c25` |
| anchore/sbom-action | v0 | `e22c389904149dbc22b58101806040fa8d37a610` |

The reference comments (`# v4`, etc.) are documentation only. The commit SHA is the execution identity. Updating an Action requires a security review, updating the allowlist, rerunning all CI workflows and documenting the new commit.

**Limits:** SHA pinning prevents a repository action tag from moving underneath a build; it does not prove that the code at the reviewed commit is free of defects, or establish signed container provenance, digest-pinned Docker base images, least-privilege runner tokens, a fully constrained toolchain or organization-approved third-party publisher attestations. Do not treat this as production security certification.

No production systems or persistent user data are modified.
