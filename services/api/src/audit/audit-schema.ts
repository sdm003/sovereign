export const auditEventSchemaSql = `
create table if not exists audit_event (
  id uuid primary key,
  tenant_id uuid not null,
  office_id uuid not null,
  type text not null,
  actor_id uuid,
  metadata jsonb not null,
  occurred_at timestamptz not null default now()
);

create index if not exists audit_event_tenant_time_idx
  on audit_event(tenant_id, occurred_at desc);

create or replace function prevent_audit_event_mutation()
returns trigger as $$
begin
  raise exception 'audit_event is append-only';
end;
$$ language plpgsql;

drop trigger if exists audit_event_no_update on audit_event;
create trigger audit_event_no_update
before update on audit_event
for each row
execute function prevent_audit_event_mutation();

drop trigger if exists audit_event_no_delete on audit_event;
create trigger audit_event_no_delete
before delete on audit_event
for each row
execute function prevent_audit_event_mutation();
`.trim();
