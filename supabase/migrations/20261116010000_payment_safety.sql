-- Admin status is server-controlled metadata, never an email embedded in JS.
create or replace function public.is_store_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from auth.users where id = auth.uid() and raw_app_meta_data ->> 'store_role' = 'admin');
$$;
revoke all on function public.is_store_admin() from public, anon;
grant execute on function public.is_store_admin() to authenticated;
drop policy if exists "Only store admin can update maintenance setting" on public.site_settings;
create policy "Only store admin can update maintenance setting" on public.site_settings for update to authenticated
using ((select public.is_store_admin())) with check ((select public.is_store_admin()));

alter table public.orders add column if not exists pricing_verified_at timestamptz;
create table if not exists public.payment_attempts (
  reference text primary key,
  order_id uuid not null references public.orders(id),
  amount bigint not null check(amount > 0),
  currency text not null check(currency = 'GHS'),
  state text not null default 'initializing' check(state in ('initializing','ready','paid','failed')),
  authorization_url text,
  created_at timestamptz not null default now()
);
alter table public.payment_attempts enable row level security;
revoke all on public.payment_attempts from public, anon, authenticated;
grant all on public.payment_attempts to service_role;
create unique index if not exists one_active_payment_per_order on public.payment_attempts(order_id) where state in ('initializing','ready');
create or replace function private.check_payment_attempt()
returns trigger language plpgsql security definer set search_path = '' as $$
declare saved public.orders;
begin
  select * into saved from public.orders where id = new.order_id for update;
  if saved.id is null or saved.payment_status <> 'pending' or saved.status = 'Order Cancelled' then
    raise exception 'Order is not payable';
  end if;
  if new.amount <> round(saved.estimated_total * 100) or new.currency <> saved.currency then
    raise exception 'Payment amount must match order';
  end if;
  return new;
end;
$$;
revoke all on function private.check_payment_attempt() from public, anon, authenticated;
drop trigger if exists payment_attempt_check on public.payment_attempts;
create trigger payment_attempt_check before insert on public.payment_attempts for each row execute function private.check_payment_attempt();

-- Browser inserts cannot choose their own totals, paid status or notification email.
revoke insert on public.orders from authenticated;
drop policy if exists "Customers can create their own orders" on public.orders;
create or replace function private.prepare_order_for_payment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt() ->> 'role','') <> 'service_role' then
    raise exception 'Orders must be created through the verified checkout service';
  end if;
  if new.pricing_verified_at is null or new.user_id is null then raise exception 'Verified pricing and customer required'; end if;
  new.customer_email := lower(coalesce(new.customer_email,''));
  new.status := 'Order Received';
  new.payment_status := 'pending'; new.payment_reference := null; new.payment_paid_at := null;
  new.email_notified_at := null; new.sms_notified_at := null;
  return new;
end;
$$;
revoke all on function private.prepare_order_for_payment() from public, anon, authenticated;
