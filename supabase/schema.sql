-- Customer order history for the Trikonic storefront.
-- The authenticated account owns every order row; customers have no access to another user's data.
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  order_number text not null unique,
  customer_name text not null,
  contact text not null,
  delivery_area text,
  notes text,
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  estimated_total numeric(12,2) not null check (estimated_total >= 0),
  currency text not null default 'GHS',
  status text not null default 'New',
  created_at timestamptz not null default now()
);

create index if not exists orders_user_created_idx
  on public.orders (user_id, created_at desc);

alter table public.orders enable row level security;
revoke all on public.orders from anon, authenticated;
grant usage on schema public to authenticated;
grant select, insert on public.orders to authenticated;

drop policy if exists "Customers can read their own orders" on public.orders;
create policy "Customers can read their own orders"
  on public.orders for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Customers can create their own orders" on public.orders;
create policy "Customers can create their own orders"
  on public.orders for insert to authenticated
  with check ((select auth.uid()) = user_id);
