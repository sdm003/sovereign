export const runtimeMigrationSql = `
create table if not exists schema_migration_log (
  id uuid primary key,
  version text not null unique,
  applied_at timestamptz not null default now()
);
`.trim();
