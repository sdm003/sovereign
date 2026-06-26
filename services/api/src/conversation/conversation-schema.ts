export const conversationSchemaSql = `
create table conversation (
  id uuid primary key,
  tenant_id uuid not null,
  office_id uuid not null,
  tier text not null,
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create table conversation_participant (
  id uuid primary key,
  conversation_id uuid not null references conversation(id),
  user_id uuid not null,
  role text not null,
  created_at timestamptz not null default now()
);
`.trim();
