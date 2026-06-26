export const restrictedAccessSchemaSql = `
create table hardware_key (
  id uuid primary key,
  tenant_id uuid not null references tenant(id),
  office_id uuid not null references office(id),
  user_id uuid not null,
  device_id uuid not null references device(id),
  type text not null,
  label text not null,
  is_backup boolean not null,
  status text not null,
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz not null default now()
);

create index hardware_key_tenant_user_status_idx
  on hardware_key(tenant_id, user_id, status);

create table restricted_session (
  id uuid primary key,
  tenant_id uuid not null references tenant(id),
  office_id uuid not null references office(id),
  user_id uuid not null,
  device_id uuid not null references device(id),
  hardware_key_id uuid not null references hardware_key(id),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index restricted_session_tenant_user_idx
  on restricted_session(tenant_id, user_id, expires_at desc);
`.trim();
