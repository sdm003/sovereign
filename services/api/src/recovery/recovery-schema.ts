export const recoveryWorkflowSchemaSql = `
create table recovery_request (
  id uuid primary key,
  tenant_id uuid not null references tenant(id),
  office_id uuid not null references office(id),
  user_id uuid not null,
  status text not null,
  reason text not null,
  recovery_channel text not null,
  approved_by uuid,
  approved_at timestamptz,
  verified_by uuid,
  recovery_channel_verified_at timestamptz,
  completed_at timestamptz,
  replacement_device_id uuid references device(id),
  replacement_hardware_key_id uuid references hardware_key(id),
  created_at timestamptz not null default now()
);

create index recovery_request_tenant_user_idx
  on recovery_request(tenant_id, user_id, created_at desc);
`.trim();
