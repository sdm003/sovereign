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

## Monorepo layout

```txt
apps/
  ios-client/
  admin-console/
services/
  api/
packages/
  contracts/
  ui-admin/
infra/
doc/
scripts/
```

Bootstrap notes:

- `apps/ios-client` is reserved for the SwiftUI end-user client
- `apps/admin-console` is reserved for the Next.js admin surface
- `services/api` is reserved for the NestJS backend
- `packages/contracts` is reserved for backend-owned shared contracts
- `packages/ui-admin` is reserved for reusable admin-only UI building blocks
- `infra` is reserved for SaaS runtime and operational assets

Framework-specific deep setup is intentionally deferred to downstream issues. For this bootstrap phase, the repository only establishes stable paths, minimal manifests, and ownership documentation.
