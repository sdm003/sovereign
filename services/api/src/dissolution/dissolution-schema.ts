export const dissolutionSchemaSql = `
create table dissolution_request (
  id uuid primary key,
  tenant_id uuid not null,
  office_id uuid not null,
  conversation_id uuid not null references conversation(id),
  status text not null,
  requested_by uuid not null,
  confirmed_by uuid,
  rejected_by uuid,
  rejection_reason text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create unique index dissolution_request_one_pending_idx
  on dissolution_request(conversation_id)
  where status = 'pending_confirmation';

create index dissolution_request_tenant_conversation_idx
  on dissolution_request(tenant_id, conversation_id, created_at desc);
`.trim();
