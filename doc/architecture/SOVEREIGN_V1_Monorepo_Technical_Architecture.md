# SOVEREIGN V1 Monorepo Technical Architecture

## 1. Purpose

This document locks the repository architecture for SOVEREIGN V1 so bootstrap and implementation work can proceed without ambiguity.

It replaces any earlier self-hosted-first assumptions with the approved V1 shape:

- SOVEREIGN-managed SaaS first release
- one tenant equals one office in V1
- iOS-only end-user client
- admin-only web console
- backend-enforced policy and governance
- deferred cross-office and inter-instance messaging

## 2. Architecture invariants

1. `services/api` is the only system-of-record boundary for business policy, identity state, conversation permissions, governance enforcement, recovery controls, and attachment authorization.
2. `apps/ios-client` is the only end-user messaging surface in V1.
3. `apps/admin-console` is governance and administration only. It does not participate in conversations as an end-user client.
4. `packages/contracts` defines shared API-facing contracts for backend and TypeScript consumers and is generated from or validated against backend-owned schemas.
5. PostgreSQL stores tenant, identity, membership, device, conversation, message, governance, recovery, and attachment metadata.
6. Redis is limited to ephemeral coordination, caching, rate limiting, and realtime fan-out support.
7. Object storage stores attachment binaries only; all upload and download permission decisions remain backend-owned.
8. Support access is never implicit. Any support elevation must be explicit, bounded, and auditable.
9. No V1 repository path may assume self-hosted customer deployment as the primary release target.

## 3. Canonical top-level repository layout

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
```

## 4. Path ownership and responsibilities

### `apps/ios-client`

Owns:

- end-user authentication entry flows after invitation handoff
- conversation list, thread, tier visibility, and attachment UX
- restricted re-entry and locked-state UX
- guest-scoped participant and conversation presentation
- bilateral dissolution user flows

Must not own:

- tenant policy decisions
- role and permission truth
- attachment authorization rules
- admin governance workflows

### `apps/admin-console`

Owns:

- office setup and office administration flows
- internal member invite, activation, suspension, and role management
- guest lifecycle management and kill switch controls
- audit review, recovery approvals, and support-elevation controls

Must not own:

- end-user conversation participation
- direct message composition as an admin user
- source-of-truth policy logic

### `services/api`

Owns:

- authentication and invitation lifecycle
- tenant, office, membership, device, and guest models
- conversation, participant, message, and tier enforcement
- audit event persistence and review APIs
- restricted-session enforcement and recovery workflows
- signed attachment authorization
- realtime events and WebSocket orchestration

Must not defer policy-sensitive decisions to clients.

### `packages/contracts`

Owns:

- backend-authored DTO definitions
- OpenAPI schemas and generated TypeScript client artifacts for admin usage
- event payload shapes used by backend and TypeScript clients
- shared validation semantics that can be generated from backend-owned contracts

Rules:

1. Backend schemas are authoritative.
2. Admin console consumes generated or shared TypeScript contracts from this package.
3. iOS does not import TypeScript directly; it consumes artifacts generated from the same backend contract source.
4. Breaking contract changes require explicit versioning or coordinated updates in dependent apps.

### `packages/ui-admin`

Owns:

- reusable admin-only UI primitives
- governance/admin table, form, badge, modal, and state components
- admin design-token usage wrappers if shared across the admin surface

Must not contain:

- backend access logic
- conversation-domain business policy
- iOS-specific UI abstractions

### `infra`

Owns:

- SaaS environment definitions
- deployment, secrets, migration, and runtime configuration assets
- observability and operational runbook assets

Must not become a dumping ground for application business logic.

### `doc`

Owns:

- functional requirements
- delivery breakdowns
- architecture references and decisions

## 5. Runtime architecture

### Client surfaces

- `apps/ios-client` communicates with `services/api` over HTTPS and realtime channels.
- `apps/admin-console` communicates with `services/api` over HTTPS and approved realtime surfaces where needed for governance state refresh.

### Backend services

- `services/api` exposes REST APIs for CRUD, policy actions, onboarding, recovery, governance, and attachment authorization.
- `services/api` exposes WebSocket channels for realtime message delivery and selected state/event updates.

### Data systems

- PostgreSQL is the persistent system of record.
- Redis supports ephemeral coordination only.
- Object storage stores attachment binaries and never becomes the authorization layer.

## 6. Tenant and trust boundaries

1. One tenant maps to exactly one office in V1.
2. Cross-tenant data access is forbidden by default.
3. Guest identities are scoped to the office tenant where they are provisioned.
4. Personal conversations are single-owner only in V1.
5. Cross-office and inter-instance messaging are deferred and may only leave non-invasive groundwork in shared contracts or domain modeling.

## 7. Contract sharing strategy

### TypeScript consumers

- Admin and backend share contract definitions through `packages/contracts`.
- Contract generation should produce strongly typed API clients and DTOs for TypeScript consumers.

### iOS consumer

- iOS consumes backend-defined contracts through generated client artifacts, not handwritten duplicated models where generation is practical.
- If some iOS presentation models diverge from transport models, the mapping layer belongs inside `apps/ios-client`.

### Event taxonomy

- Realtime and audit events must have stable, named payloads defined from backend-owned schemas.
- Governance and policy events should be distinguishable from user-visible conversation events.

## 8. Boundary rules for downstream scaffold work

`SOV-5` should create the repository skeleton exactly around these directories:

```txt
apps/ios-client
apps/admin-console
services/api
packages/contracts
packages/ui-admin
infra
doc/architecture
```

Additional packages may be added later only when they solve a clear reuse or isolation problem.

Do not introduce in V1 bootstrap:

- `apps/web-client`
- customer-self-hosted deployment as the default path
- cross-instance messaging services
- search infrastructure
- native push notification infrastructure as a core dependency

## 9. Explicit V1 deferrals

Deferred from V1 implementation:

- self-hosted deployment productization
- end-user web messaging client
- inter-instance and cross-office messaging
- general search
- default support visibility into customer content
- export-package workflow for audit review

## 10. Definition of architecture done for bootstrap

Architecture is considered locked enough for scaffold work when:

1. The top-level repository paths are fixed.
2. Each path has a clear ownership boundary.
3. Backend contract authority is explicit.
4. Tenant model and client-surface restrictions are explicit.
5. Deferred scope is explicit enough to prevent accidental V1 leakage.
