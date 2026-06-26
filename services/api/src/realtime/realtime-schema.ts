export const realtimeSchemaSql = `
create table realtime_subscription (
  id uuid primary key,
  tenant_id uuid not null references tenant(id),
  office_id uuid not null references office(id),
  user_id uuid not null,
  conversation_id uuid not null references conversation(id),
  connection_id text not null,
  created_at timestamptz not null default now()
);

create index realtime_subscription_connection_idx
  on realtime_subscription(connection_id, conversation_id);
`.trim();
