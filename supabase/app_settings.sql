-- Admin-managed global app settings (best-effort sync from client)
-- Used by: `index.html` -> `loadRemoteSettings()` / `saveRemoteSettingsIfAdmin()`
--
-- Stores a single row with id='global' containing JSON settings.
-- Access: Admins only (via profiles.role='admin' and/or JWT app_metadata.role='admin').

create table if not exists public.app_settings (
  id text primary key,
  settings_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid null
);

-- Keep updated_at fresh on updates
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_app_settings_updated_at on public.app_settings;
create trigger trg_app_settings_updated_at
before update on public.app_settings
for each row execute function public.set_updated_at();

alter table public.app_settings enable row level security;

-- Helper condition for admin: prefer JWT claim, fallback to profiles row.
-- Note: referencing profiles from this policy is safe (no recursion on this table).
drop policy if exists "app_settings_admin_select" on public.app_settings;
create policy "app_settings_admin_select"
on public.app_settings
for select
using (
  (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

drop policy if exists "app_settings_admin_insert" on public.app_settings;
create policy "app_settings_admin_insert"
on public.app_settings
for insert
with check (
  (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

drop policy if exists "app_settings_admin_update" on public.app_settings;
create policy "app_settings_admin_update"
on public.app_settings
for update
using (
  (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
)
with check (
  (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

-- Seed the single global row (safe to re-run).
insert into public.app_settings (id, settings_json)
values ('global', '{}'::jsonb)
on conflict (id) do nothing;

