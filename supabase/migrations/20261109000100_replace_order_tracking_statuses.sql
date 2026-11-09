-- Replace legacy tracking labels with the team's new order lifecycle.
begin;

alter table public.orders disable trigger orders_log_status_event;

update public.order_status_events
set status = case lower(btrim(status))
  when 'new' then 'Order Received'
  when 'confirmed' then 'Payment Made'
  when 'preparing' then 'Order Placed'
  when 'in transit' then 'Order Shipped'
  when 'delivered' then 'Order Delivered'
  when 'cancelled' then 'Order Cancelled'
  else status
end
where lower(btrim(status)) in ('new', 'confirmed', 'preparing', 'in transit', 'delivered', 'cancelled');

update public.orders
set status = case lower(btrim(status))
  when 'new' then 'Order Received'
  when 'confirmed' then 'Payment Made'
  when 'preparing' then 'Order Placed'
  when 'in transit' then 'Order Shipped'
  when 'delivered' then 'Order Delivered'
  when 'cancelled' then 'Order Cancelled'
  else status
end
where lower(btrim(status)) in ('new', 'confirmed', 'preparing', 'in transit', 'delivered', 'cancelled');

alter table public.orders enable trigger orders_log_status_event;
alter table public.orders alter column status set default 'Order Received';

alter table public.orders
  add constraint orders_status_allowed
  check (status in (
    'Order Received', 'Payment Made', 'Order Placed', 'Order Shipped',
    'Order Arrived in Ghana', 'Order Arrived at Warehouse',
    'Order Ready for Collection', 'Order Delivered', 'Order Cancelled'
  ));

alter table public.order_status_events
  add constraint order_status_events_status_allowed
  check (status in (
    'Order Received', 'Payment Made', 'Order Placed', 'Order Shipped',
    'Order Arrived in Ghana', 'Order Arrived at Warehouse',
    'Order Ready for Collection', 'Order Delivered', 'Order Cancelled'
  ));

commit;
