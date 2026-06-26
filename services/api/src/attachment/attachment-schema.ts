export const attachmentSchemaSql = `
create table attachment (
  id uuid primary key,
  tenant_id uuid not null,
  office_id uuid not null,
  conversation_id uuid not null references conversation(id),
  message_id uuid,
  storage_key text not null unique,
  filename text not null,
  content_type text not null,
  byte_size bigint not null,
  uploaded_by uuid not null,
  status text not null,
  created_at timestamptz not null default now(),
  finalized_at timestamptz
);

create index attachment_conversation_idx
  on attachment(tenant_id, conversation_id, created_at desc);

create index attachment_message_idx
  on attachment(tenant_id, message_id)
  where message_id is not null;
`.trim();
