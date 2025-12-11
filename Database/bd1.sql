-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.education (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  school text NOT NULL,
  degree text,
  field text,
  start_date date,
  end_date date,
  CONSTRAINT education_pkey PRIMARY KEY (id),
  CONSTRAINT education_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.experiences (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  title text NOT NULL,
  company text,
  start_date date,
  end_date date,
  location text,
  description text,
  CONSTRAINT experiences_pkey PRIMARY KEY (id),
  CONSTRAINT experiences_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.ingested_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  external_id text,
  source_id bigint,
  job_id uuid,
  raw jsonb,
  fetched_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ingested_jobs_pkey PRIMARY KEY (id),
  CONSTRAINT ingested_jobs_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.scrape_sources(id),
  CONSTRAINT ingested_jobs_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id)
);
CREATE TABLE public.ingested_profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  external_id text,
  source_id bigint,
  profile_id uuid,
  raw jsonb,
  fetched_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ingested_profiles_pkey PRIMARY KEY (id),
  CONSTRAINT ingested_profiles_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.scrape_sources(id),
  CONSTRAINT ingested_profiles_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.job_skills (
  job_id uuid NOT NULL,
  skill_id bigint NOT NULL,
  required boolean NOT NULL DEFAULT true,
  CONSTRAINT job_skills_pkey PRIMARY KEY (job_id, skill_id),
  CONSTRAINT job_skills_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id),
  CONSTRAINT job_skills_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES public.skills(id)
);
CREATE TABLE public.jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid,
  source USER-DEFINED DEFAULT 'other'::source_type,
  external_id text,
  title text NOT NULL,
  description text,
  location text,
  seniority text,
  min_experience_years integer,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT jobs_pkey PRIMARY KEY (id),
  CONSTRAINT jobs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
);
CREATE TABLE public.organization_members (
  org_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role USER-DEFINED NOT NULL DEFAULT 'member'::role,
  joined_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT organization_members_pkey PRIMARY KEY (org_id, user_id),
  CONSTRAINT organization_members_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id),
  CONSTRAINT organization_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.organizations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT organizations_pkey PRIMARY KEY (id)
);
CREATE TABLE public.profile_skills (
  profile_id uuid NOT NULL,
  skill_id bigint NOT NULL,
  level integer,
  CONSTRAINT profile_skills_pkey PRIMARY KEY (profile_id, skill_id),
  CONSTRAINT profile_skills_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id),
  CONSTRAINT profile_skills_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES public.skills(id)
);
CREATE TABLE public.profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE,
  organization_id uuid,
  full_name text,
  headline text,
  location text,
  about text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT profiles_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
);
CREATE TABLE public.reports (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  search_id uuid NOT NULL,
  format USER-DEFINED NOT NULL,
  storage_path text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT reports_pkey PRIMARY KEY (id),
  CONSTRAINT reports_search_id_fkey FOREIGN KEY (search_id) REFERENCES public.searches(id)
);
CREATE TABLE public.scrape_queue (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  source_id bigint NOT NULL,
  query text,
  status text NOT NULL DEFAULT 'queued'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  CONSTRAINT scrape_queue_pkey PRIMARY KEY (id),
  CONSTRAINT scrape_queue_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.scrape_sources(id)
);
CREATE TABLE public.scrape_sources (
  id bigint NOT NULL DEFAULT nextval('scrape_sources_id_seq'::regclass),
  name text NOT NULL,
  base_url text,
  type USER-DEFINED NOT NULL DEFAULT 'other'::source_type,
  CONSTRAINT scrape_sources_pkey PRIMARY KEY (id)
);
CREATE TABLE public.search_results (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  search_id uuid NOT NULL,
  target_type USER-DEFINED NOT NULL,
  target_id uuid NOT NULL,
  score numeric,
  rank integer,
  data jsonb,
  CONSTRAINT search_results_pkey PRIMARY KEY (id),
  CONSTRAINT search_results_search_id_fkey FOREIGN KEY (search_id) REFERENCES public.searches(id)
);
CREATE TABLE public.searches (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  organization_id uuid,
  target USER-DEFINED NOT NULL,
  prompt text NOT NULL,
  constraints jsonb,
  status USER-DEFINED NOT NULL DEFAULT 'pending'::search_status,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT searches_pkey PRIMARY KEY (id),
  CONSTRAINT searches_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT searches_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
);
CREATE TABLE public.skills (
  id bigint NOT NULL DEFAULT nextval('skills_id_seq'::regclass),
  name text NOT NULL UNIQUE,
  CONSTRAINT skills_pkey PRIMARY KEY (id)
);