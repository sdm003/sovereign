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
- `src/audit/audit-service.ts`
- `src/audit/audit-query-service.ts`
- `src/audit/audit-schema.ts`
- `src/attachment/attachment-service.ts`
- `src/attachment/attachment-schema.ts`
- `src/device/device-service.ts`
- `src/device/device-schema.ts`
- `src/guest/guest-service.ts`
- `src/guest/guest-schema.ts`
- `src/recovery/recovery-service.ts`
- `src/recovery/recovery-schema.ts`
- `src/realtime/realtime-service.ts`
- `src/realtime/realtime-schema.ts`
- `src/restricted/restricted-access-service.ts`
- `src/restricted/restricted-access-schema.ts`
- `src/runtime/runtime-config.ts`
- `src/runtime/runtime-schema.ts`
