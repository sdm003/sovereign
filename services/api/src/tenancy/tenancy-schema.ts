export const tenancySchemaSql = `
create table tenant (
  id uuid primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table office (
  id uuid primary key,
  tenant_id uuid not null unique references tenant(id),
  name text not null,
  created_at timestamptz not null default now()
);

create table membership (
  id uuid primary key,
  tenant_id uuid not null references tenant(id),
  office_id uuid not null references office(id),
  user_id uuid not null,
  role text not null,
  status text not null,
  created_at timestamptz not null default now()
);
`.trim();
