# Repository guardrails

## Baseline CI

The initial required workflow is:

- workflow: `baseline-ci`
- required job: `repo-structure`

Current baseline behavior:

1. validates the root `package.json`
2. verifies the approved monorepo paths exist
3. runs on pull requests, pushes to `main`, and manual dispatch

This is intentionally narrow so bootstrap work is protected without creating noisy failures before service-specific code exists.

## Review expectations

For `main`, the intended merge baseline is:

1. open a pull request instead of pushing directly
2. get at least one review before merge
3. require the `repo-structure` check to pass
4. do not allow force-pushes
5. do not allow branch deletion through protection bypass

Admin enforcement can stay relaxed during bootstrap if stricter enforcement would block repository setup work.

## Current platform limitation

This repository is private, and GitHub currently rejects branch-protection API access on the current account tier for this repository.

As a result:

- CI and required-check naming are implemented now
- the exact protection policy for `main` is documented here
- enforcement must be enabled later by either:
  - upgrading the repository/account tier to support private-repo branch protection, or
  - changing the repository visibility to public if that is acceptable

## Expansion path

Add new required checks gradually as real code appears:

1. `services/api` test and typecheck jobs
2. `apps/admin-console` lint, test, and build jobs
3. `packages/contracts` contract-generation and validation jobs
4. `packages/ui-admin` lint and test jobs
5. `apps/ios-client` build and test jobs through the chosen Apple runner strategy

Prefer path-aware workflows or separate jobs instead of one giant pipeline so checks remain diagnosable and incremental.
