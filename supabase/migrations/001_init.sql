-- Extensões necessárias
create extension if not exists pgcrypto;

-- Tipos
do $$ begin
    create type public.role as enum ('owner','admin','member');
exception when duplicate_object then null; end $$;

do $$ begin
    create type public.target_type as enum ('profile','job');
exception when duplicate_object then null; end $$;

do $$ begin
    create type public.search_status as enum ('pending','running','done','failed');
exception when duplicate_object then null; end $$;

do $$ begin
    create type public.report_format as enum ('pdf','xlsx');
exception when duplicate_object then null; end $$;

do $$ begin
    create type public.source_type as enum ('linkedin','github','indeed','other');
exception when duplicate_object then null; end $$;

-- Organizações e membros
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

-- Perfis de usuário
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  full_name text,
  headline text,
  location text,
  about text,
  created_at timestamptz not null default now()
);

-- Skills e relações
create table if not exists public.skills (
  id bigserial primary key,
  name text not null unique
);

create table if not exists public.profile_skills (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  skill_id bigint not null references public.skills(id) on delete cascade,
  level int,
  primary key (profile_id, skill_id)
);

create table if not exists public.experiences (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  company text,
  start_date date,
  end_date date,
  location text,
  description text
);

create table if not exists public.education (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  school text not null,
  degree text,
  field text,
  start_date date,
  end_date date
);

-- Vagas
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  source public.source_type default 'other',
  external_id text,
  title text not null,
  description text,
  location text,
  seniority text,
  min_experience_years int,
  created_at timestamptz not null default now()
);

create table if not exists public.job_skills (
  job_id uuid not null references public.jobs(id) on delete cascade,
  skill_id bigint not null references public.skills(id) on delete cascade,
  required boolean not null default true,
  primary key (job_id, skill_id)
);

-- Buscas e resultados
create table if not exists public.searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  target public.target_type not null,
  prompt text not null,
  constraints jsonb,
  status public.search_status not null default 'pending',
  created_at timestamptz not null default now()
);

create table if not exists public.search_results (
  id uuid primary key default gen_random_uuid(),
  search_id uuid not null references public.searches(id) on delete cascade,
  target_type public.target_type not null,
  target_id uuid not null,
  score numeric(5,2),
  rank int,
  data jsonb,
  unique (search_id, target_type, target_id)
);

create index if not exists idx_search_results_search on public.search_results(search_id);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  search_id uuid not null references public.searches(id) on delete cascade,
  format public.report_format not null,
  storage_path text not null,
  created_at timestamptz not null default now()
);

-- Scraping / ingestão
create table if not exists public.scrape_sources (
  id bigserial primary key,
  name text not null,
  base_url text,
  type public.source_type not null default 'other'
);

create table if not exists public.scrape_queue (
  id uuid primary key default gen_random_uuid(),
  source_id bigint not null references public.scrape_sources(id) on delete cascade,
  query text,
  status text not null default 'queued',
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create table if not exists public.ingested_profiles (
  id uuid primary key default gen_random_uuid(),
  external_id text,
  source_id bigint references public.scrape_sources(id) on delete set null,
  profile_id uuid references public.profiles(id) on delete set null,
  raw jsonb,
  fetched_at timestamptz not null default now()
);

create table if not exists public.ingested_jobs (
  id uuid primary key default gen_random_uuid(),
  external_id text,
  source_id bigint references public.scrape_sources(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  raw jsonb,
  fetched_at timestamptz not null default now()
);

-- Índices úteis
create index if not exists idx_skills_name on public.skills using btree (name);
create index if not exists idx_profile_skills_skill on public.profile_skills(skill_id);
create index if not exists idx_job_skills_skill on public.job_skills(skill_id);
create index if not exists idx_jobs_created_at on public.jobs(created_at);
create index if not exists idx_searches_created_at on public.searches(created_at);

-- RLS
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.profiles enable row level security;
alter table public.jobs enable row level security;
alter table public.searches enable row level security;
alter table public.search_results enable row level security;
alter table public.reports enable row level security;

-- Policies
create policy orgs_select_for_members on public.organizations
  for select using (exists (
    select 1 from public.organization_members m
    where m.org_id = organizations.id and m.user_id = auth.uid()
  ));

create policy org_members_select_self on public.organization_members
  for select using (user_id = auth.uid());

create policy profiles_select_own on public.profiles
  for select using (user_id = auth.uid());

create policy profiles_select_org on public.profiles
  for select using (
    organization_id is not null and exists (
      select 1 from public.organization_members m
      where m.org_id = profiles.organization_id and m.user_id = auth.uid()
    )
  );

create policy profiles_insert_own on public.profiles
  for insert with check (user_id = auth.uid());

create policy profiles_update_own on public.profiles
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy jobs_select_org on public.jobs
  for select using (
    organization_id is null
    or exists (
      select 1 from public.organization_members m
      where jobs.organization_id = m.org_id and m.user_id = auth.uid()
    )
  );

create policy jobs_insert_org on public.jobs
  for insert with check (
    organization_id is not null and exists (
      select 1 from public.organization_members m
      where m.org_id = jobs.organization_id and m.user_id = auth.uid()
    )
  );

create policy jobs_update_org on public.jobs
  for update using (
    organization_id is not null and exists (
      select 1 from public.organization_members m
      where m.org_id = jobs.organization_id and m.user_id = auth.uid()
    )
  ) with check (
    organization_id is not null and exists (
      select 1 from public.organization_members m
      where m.org_id = jobs.organization_id and m.user_id = auth.uid()
    )
  );

create policy searches_select_own on public.searches
  for select using (user_id = auth.uid());

create policy searches_select_org on public.searches
  for select using (
    organization_id is not null and exists (
      select 1 from public.organization_members m
      where m.org_id = searches.organization_id and m.user_id = auth.uid()
    )
  );

create policy searches_insert_own on public.searches
  for insert with check (user_id = auth.uid());

create policy results_select_by_search on public.search_results
  for select using (exists (
    select 1 from public.searches s
    join public.organization_members m on s.organization_id = m.org_id
    where s.id = search_results.search_id
      and (s.user_id = auth.uid() or m.user_id = auth.uid())
  ) or exists (
    select 1 from public.searches s
    where s.id = search_results.search_id and s.user_id = auth.uid()
  ));

create policy reports_select_by_search on public.reports
  for select using (exists (
    select 1 from public.searches s
    join public.organization_members m on s.organization_id = m.org_id
    where s.id = reports.search_id
      and (s.user_id = auth.uid() or m.user_id = auth.uid())
  ) or exists (
    select 1 from public.searches s
    where s.id = reports.search_id and s.user_id = auth.uid()
  ));