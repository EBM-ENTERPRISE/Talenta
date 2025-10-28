-- Incremental RLS updates: allow updating/deleting searches safely
-- Uses DROP POLICY IF EXISTS to avoid duplicate policy errors.

-- Enable RLS on searches (harmless if already enabled)
alter table public.searches enable row level security;

-- Allow the owner to update their search (e.g., set status='done')
drop policy if exists searches_update_own on public.searches;
create policy searches_update_own on public.searches
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Optionally allow organization members to update searches of their org
drop policy if exists searches_update_org on public.searches;
create policy searches_update_org on public.searches
  for update using (
    organization_id is not null and exists (
      select 1 from public.organization_members m
      where m.org_id = searches.organization_id and m.user_id = auth.uid()
    )
  ) with check (
    organization_id is not null and exists (
      select 1 from public.organization_members m
      where m.org_id = searches.organization_id and m.user_id = auth.uid()
    )
  );

-- Allow the owner to delete their own searches (optional but handy)
drop policy if exists searches_delete_own on public.searches;
create policy searches_delete_own on public.searches
  for delete using (user_id = auth.uid());

-- Note: results_select_by_search already exists in 001_init.sql. Insert/update
-- on search_results should be done by backend (service key bypasses RLS).