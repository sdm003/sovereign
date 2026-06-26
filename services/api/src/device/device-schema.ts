export const deviceRegistrySchemaSql = `
create table device (
  id uuid primary key,
  tenant_id uuid not null references tenant(id),
  office_id uuid not null references office(id),
  user_id uuid not null,
  status text not null,
  platform text not null,
  client_device_id text not null,
  device_name text,
  approved_at timestamptz,
  approved_by uuid,
  revoked_at timestamptz,
  revoked_by uuid,
  revocation_reason text,
  created_at timestamptz not null default now()
);

create index device_tenant_user_client_idx
  on device(tenant_id, user_id, client_device_id);

create table auth_session (
  id uuid primary key,
  tenant_id uuid not null references tenant(id),
  office_id uuid not null references office(id),
  user_id uuid not null,
  device_id uuid not null references device(id),
  status text not null,
  revocation_reason text,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index auth_session_device_status_idx
  on auth_session(device_id, status);
`.trim();
