# SOVEREIGN

Canonical monorepo for SOVEREIGN V1.

## V1 architecture baseline

SOVEREIGN V1 is a SOVEREIGN-managed multi-tenant SaaS product with:

- one tenant per office in V1
- SwiftUI iOS client for end-user messaging
- Next.js admin console for governance and office administration only
- NestJS API as the source of truth for identity, policy, messaging, audit, and recovery workflows
- PostgreSQL for system-of-record data
- Redis for ephemeral coordination and realtime support
- S3-compatible object storage for governed attachments

The repository-level architecture source of truth is:

- `doc/architecture/SOVEREIGN_V1_Monorepo_Technical_Architecture.md`

Supporting planning artifacts currently tracked in-repo:

- `doc/SOVEREIGN_Functional_Requirements_v1.txt`
- `doc/v1-delivery/SOVEREIGN_V1_Master_Breakdown.txt`
- `doc/v1-delivery/SOVEREIGN_V1_Dependencies_and_Phases.txt`
- `doc/v1-delivery/SOVEREIGN_V1_Backend_Breakdown.txt`
- `doc/v1-delivery/SOVEREIGN_V1_Frontend_Breakdown.txt`
- `doc/v1-delivery/SOVEREIGN_V1_Design_Breakdown.txt`
- `doc/v1-delivery/SOVEREIGN_V1_Infra_Security_Ops_Breakdown.txt`

## Contribution workflow

Repository workflow standards live in:

- `CONTRIBUTING.md`
- `.github/CODEOWNERS`
- `.github/pull_request_template.md`
- `.github/ISSUE_TEMPLATE/`

The working convention for bootstrap and product delivery is one Linear issue per branch and, when feasible, one PR and one primary commit per completed issue.
