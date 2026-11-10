-- Store trustworthy payment state and customer notification destinations.
alter table public.orders
  add column if not exists customer_email text,
  add column if not exists payment_status text not null default 'pending',
  add column if not exists payment_reference text,
  add column if not exists payment_paid_at timestamptz,
  add column if not exists email_notified_at timestamptz,
  add column if not exists sms_notified_at timestamptz;

-- Existing requests were placed before online payments existed.
update public.orders set payment_status = 'not_required' where payment_status = 'pending';
update public.orders as orders
set customer_email = lower(users.email)
from auth.users as users
where orders.user_id = users.id and (orders.customer_email is null or orders.customer_email = '');

alter table public.orders drop constraint if exists orders_payment_status_allowed;
alter table public.orders add constraint orders_payment_status_allowed
  check (payment_status in ('pending', 'paid', 'failed', 'refunded', 'not_required'));
create unique index if not exists orders_payment_reference_unique
  on public.orders (payment_reference) where payment_reference is not null;

-- Values supplied by a browser can never mark an order as paid or choose the
-- notification destination. A signed-in customer's account email is used.
create or replace function private.prepare_order_for_payment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.customer_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  new.payment_status := 'pending';
  new.payment_reference := null;
  new.payment_paid_at := null;
  new.email_notified_at := null;
  new.sms_notified_at := null;
  return new;
end;
$$;
revoke all on function private.prepare_order_for_payment() from public, anon, authenticated;
drop trigger if exists orders_prepare_payment on public.orders;
create trigger orders_prepare_payment before insert on public.orders
  for each row execute function private.prepare_order_for_payment();

-- A missing account email should prevent order creation rather than permit a
-- payment that cannot produce a customer receipt.
alter table public.orders drop constraint if exists orders_customer_email_nonempty;
alter table public.orders add constraint orders_customer_email_nonempty
  check (customer_email is not null and customer_email <> '');

