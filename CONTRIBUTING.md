# Contributing to SOVEREIGN

## Purpose

This repository uses a lightweight, issue-scoped workflow so bootstrap and product delivery can proceed in small, reviewable units.

## Source of truth

Before starting implementation, read:

1. `doc/architecture/SOVEREIGN_V1_Monorepo_Technical_Architecture.md`
2. the target Linear issue
3. any directly referenced planning doc sections

Repository architecture rules in the architecture document override older assumptions in ad hoc notes.

## Delivery workflow

The default workflow is:

1. Pick one Linear issue.
2. Create one branch for that issue.
3. Make the smallest complete change that satisfies the issue.
4. Open one pull request scoped to that issue.
5. Merge only after review and required checks pass.

When feasible, keep one completed Linear issue mapped to one PR and one primary commit.

## Branch naming

Use the Linear issue identifier in every working branch:

```txt
sov-<number>-short-kebab-summary
```

Examples:

- `sov-5-bootstrap-monorepo-structure`
- `sov-17-model-tenant-office-membership`

## Commit expectations

Commits should be:

- issue-scoped
- reviewable
- explicit about the affected surface

Preferred format:

```txt
<type>: <summary for issue>
```

Examples:

- `docs: lock monorepo architecture for SOV-6`
- `chore: bootstrap admin-console workspace for SOV-5`
- `feat: add tenant membership schema for SOV-17`

Do not batch unrelated issue work into the same commit.

## Pull request expectations

Every pull request should:

- reference the Linear issue
- explain the scope of change
- note any architecture, contract, migration, or ops impact
- describe how the change was validated
- identify follow-up work if the issue intentionally leaves something for a later ticket

Use the repository PR template.

The current baseline CI and merge-guard expectations are documented in:

- `.github/REPOSITORY_GUARDRAILS.md`

## Ownership boundaries

Path ownership follows the locked architecture:

- `apps/ios-client` - end-user iOS client
- `apps/admin-console` - admin and governance web surface
- `services/api` - backend policy and system-of-record logic
- `packages/contracts` - backend-owned shared contracts and generated consumer artifacts
- `packages/ui-admin` - reusable admin-only UI building blocks
- `infra` - runtime, deployment, and operational assets
- `doc` - architecture, requirements, and delivery references

Do not move business logic across these boundaries without updating the architecture source of truth.

## Definition of ready

An issue is ready to implement when:

1. the Linear issue scope is concrete
2. required blocked-by issues are done
3. target repository paths are known
4. contract, schema, or migration impact is called out when relevant

## Definition of done

An issue is done when:

1. acceptance criteria are satisfied
2. repo docs are updated if the change affects architecture or workflow
3. tests or checks appropriate to the change have been run
4. the Linear issue status and PR context reflect reality

For pull-request work that touches repository structure or bootstrap rules, the baseline `repo-structure` check is expected to pass.

## Safety rules

- Do not commit secrets, tokens, or real credentials.
- Do not add self-hosted-first assumptions back into V1.
- Keep support access explicit and auditable in design and implementation decisions.
- Preserve one tenant equals one office in V1 unless a future architecture issue changes that rule.
