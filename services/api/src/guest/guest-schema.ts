export const guestAccessSchemaSql = `
create table guest_identity (
  id uuid primary key,
  tenant_id uuid not null references tenant(id),
  office_id uuid not null references office(id),
  user_id uuid not null,
  display_name text,
  status text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid,
  revocation_reason text,
  unique(tenant_id, user_id)
);

create table guest_scope (
  id uuid primary key,
  tenant_id uuid not null references tenant(id),
  office_id uuid not null references office(id),
  guest_user_id uuid not null,
  conversation_id uuid not null references conversation(id),
  granted_by uuid not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid
);

create unique index guest_scope_active_unique_idx
  on guest_scope(tenant_id, guest_user_id, conversation_id)
  where revoked_at is null;

create index guest_scope_guest_idx
  on guest_scope(tenant_id, guest_user_id)
  where revoked_at is null;
`.trim();
