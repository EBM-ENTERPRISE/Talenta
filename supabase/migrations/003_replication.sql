create table if not exists public.replication_outbox (
  id uuid primary key default gen_random_uuid(),
  operation_id text not null unique,
  endpoint text not null,
  method text not null,
  payload jsonb,
  headers jsonb,
  status text not null default 'pending',
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now()
);

create index if not exists idx_replication_outbox_created on public.replication_outbox(created_at);

create table if not exists public.replication_operations (
  operation_id text primary key,
  applied_at timestamptz not null default now(),
  source text
);
