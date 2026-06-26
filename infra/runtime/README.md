# Managed SaaS runtime baseline

This directory defines the operational baseline introduced in `SOV-29`.

## Runtime contract

The initial backend environment contract is represented in:

- `services/api/.env.example`
- `services/api/src/runtime/runtime-config.ts`

Required values:

- `NODE_ENV`
- `PORT`
- `DATABASE_URL`
- `REDIS_URL`
- `STORAGE_BUCKET`
- `STORAGE_REGION`
- `STORAGE_ENDPOINT`
- `STORAGE_ACCESS_KEY_ID`
- `STORAGE_SECRET_ACCESS_KEY`
- `SESSION_SIGNING_SECRET`

## Startup expectations

1. Load and validate runtime configuration before boot completes.
2. Verify database, Redis, and object-storage credentials are present.
3. Run pending migrations before serving traffic.
4. Expose health only after config validation succeeds.

## Migration baseline

The initial migration bootstrap contract is represented in:

- `services/api/src/runtime/runtime-schema.ts`

The baseline approach for now is:

- track applied versions in `schema_migration_log`
- run migrations before serving traffic
- keep business-schema ownership in domain issues, not in this runtime baseline issue

## Health baseline

The initial health surface is represented in:

- `services/api/src/runtime/runtime-config.ts`

Current health model reports:

- overall status
- database readiness
- Redis readiness
- migration currency

## Tenant isolation verification

Executable tenant-safety checks are represented in:

- `services/api/src/runtime/operations-baseline.ts`

The baseline verification set covers:

- cross-tenant conversation participant joins
- membership-to-office tenant alignment
- orphaned or mismatched audit-event tenant references

Any non-zero finding should be treated as a release-blocking anomaly until containment and root-cause analysis are complete.

## Monitoring and alerting

The initial operational alert catalog is represented in:

- `services/api/src/runtime/operations-baseline.ts`

Baseline alerts cover:

- tenant isolation anomalies
- degraded runtime health
- audit write failures
- failed backup jobs
- repeated governed recovery failures
- unexpected support elevation activation

## Backup and restore

The backup and restore operational baseline is represented in:

- `services/api/src/runtime/operations-baseline.ts`

Required operating expectations:

1. Run encrypted database backups on a fixed schedule.
2. Keep object-storage version manifests aligned to backup identifiers.
3. Rehearse point-in-time restore on a non-production environment every release cycle.
4. Run tenant-isolation verification checks before allowing restored environments to serve traffic.

## Operational runbooks

The first-release operational runbooks cover:

- tenant isolation incident response
- governed recovery escalation validation
- explicit support-elevation handling

These runbooks must remain aligned with the rules already encoded in the audit, recovery, and restricted-access slices.

## Secret handling assumptions

- Never commit real credentials.
- Use managed secret injection for production environments.
- Treat storage credentials and session signing material as required secrets, not optional local defaults.
