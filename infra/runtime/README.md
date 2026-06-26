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

## Secret handling assumptions

- Never commit real credentials.
- Use managed secret injection for production environments.
- Treat storage credentials and session signing material as required secrets, not optional local defaults.
