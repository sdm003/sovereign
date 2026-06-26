# API Service

This path is reserved for the NestJS backend.

V1 responsibilities:

- authentication and invitation lifecycle
- tenant, office, membership, device, and guest models
- conversation, participant, and message policy enforcement
- audit persistence and review APIs
- restricted-session and recovery workflows
- signed attachment authorization
- realtime delivery orchestration

The backend remains the source of truth for policy-sensitive decisions.

Runtime baseline artifacts introduced during bootstrap:

- `.env.example`
- `src/runtime/runtime-config.ts`
- `src/runtime/runtime-schema.ts`
