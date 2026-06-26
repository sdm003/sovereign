export const supportElevationSchemaSql = `
create table support_action (
  id uuid primary key,
  tenant_id uuid not null,
  office_id uuid not null,
  support_user_id text not null,
  action_type text not null,
  status text not null,
  reason text not null,
  requested_by uuid,
  granted_by uuid,
  granted_at timestamptz,
  expires_at timestamptz not null,
  revoked_by uuid,
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz not null default now()
);

create unique index support_action_active_idx
  on support_action(tenant_id, office_id, support_user_id)
  where status = 'active';

create index support_action_office_time_idx
  on support_action(tenant_id, office_id, created_at desc);
`.trim();
