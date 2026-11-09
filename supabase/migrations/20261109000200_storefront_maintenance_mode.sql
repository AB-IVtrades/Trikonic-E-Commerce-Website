-- A public storefront status flag, writable only by the Trikonic admin account.
create table if not exists public.site_settings (
  id smallint primary key default 1 check (id = 1),
  maintenance_mode boolean not null default false
);

insert into public.site_settings (id, maintenance_mode)
values (1, false)
on conflict (id) do nothing;

alter table public.site_settings enable row level security;
revoke all on public.site_settings from anon, authenticated;
grant select on public.site_settings to anon, authenticated;
grant update (maintenance_mode) on public.site_settings to authenticated;

drop policy if exists "Anyone can read storefront maintenance setting" on public.site_settings;
create policy "Anyone can read storefront maintenance setting"
  on public.site_settings for select to anon, authenticated
  using (true);

drop policy if exists "Only store admin can update maintenance setting" on public.site_settings;
create policy "Only store admin can update maintenance setting"
  on public.site_settings for update to authenticated
  using (lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'nkab200321@gmail.com')
  with check (lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'nkab200321@gmail.com');
