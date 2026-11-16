-- All operations data is private. Only the server's service role can invoke operations.
alter table public.orders add column needs_attention boolean not null default false;
alter table public.orders add column attention_reason text;
alter table public.orders add column refund_review_required boolean not null default false;
alter table public.orders add column confirmed_reference text;
update public.orders set confirmed_reference=payment_reference where payment_status='paid';
create table private.order_items(id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id) on delete cascade,line_index integer not null,snapshot jsonb not null,quantity integer not null check(quantity>0),baseline_stage integer not null check(baseline_stage between 0 and 7),unique(order_id,line_index));
create table private.shipments(id uuid primary key default gen_random_uuid(),label text not null check(length(label) between 1 and 120),tracking_code text not null default '',stage integer not null default 2 check(stage between 2 and 7),version integer not null default 1,created_at timestamptz not null default now());
create table private.shipment_items(id uuid primary key default gen_random_uuid(),shipment_id uuid not null references private.shipments(id),order_item_id uuid not null references private.order_items(id),quantity integer not null check(quantity>0),unique(shipment_id,order_item_id));
create index on private.shipment_items(order_item_id);
create table private.order_audit(id bigint generated always as identity primary key,actor_id uuid,order_id uuid references public.orders(id) on delete cascade,shipment_id uuid references private.shipments(id),action text not null,details jsonb not null default '{}',created_at timestamptz not null default now());
create index on private.order_audit(order_id,created_at);
create table private.order_jobs(id uuid primary key default gen_random_uuid(),kind text not null check(kind in ('payment','receipt')),job_key text not null,order_id uuid not null references public.orders(id) on delete cascade,state text not null default 'queued' check(state in ('queued','running','done','attention')),attempts integer not null default 0,next_run timestamptz not null default now(),deadline timestamptz not null,lease_token uuid,lease_until timestamptz,last_error text,created_at timestamptz not null default now(),unique(kind,job_key));
create index on private.order_jobs(state,next_run);
do $$ declare t text; begin foreach t in array array['order_items','shipments','shipment_items','order_audit','order_jobs'] loop execute format('alter table private.%I enable row level security',t);execute format('revoke all on private.%I from public, anon, authenticated',t);execute format('grant all on private.%I to service_role',t);end loop;end $$;
grant usage on schema private to service_role;
grant usage,select on all sequences in schema private to service_role;
create or replace function private.stage_name(n integer) returns text language sql immutable set search_path='' as $$ select (array['Order Received','Payment Made','Order Placed','Order Shipped','Order Arrived in Ghana','Order Arrived at Warehouse','Order Ready for Collection','Order Delivered'])[n+1] $$;
create or replace function private.stage_number(n text) returns integer language sql immutable set search_path='' as $$ select coalesce(array_position(array['Order Received','Payment Made','Order Placed','Order Shipped','Order Arrived in Ghana','Order Arrived at Warehouse','Order Ready for Collection','Order Delivered'],n)-1,0) $$;
create or replace function private.seed_order_items() returns trigger language plpgsql security definer set search_path='' as $$ begin
 insert into private.order_items(order_id,line_index,snapshot,quantity,baseline_stage)
 select new.id,ordinality::int-1,value,(value->>'quantity')::int,private.stage_number(new.status) from jsonb_array_elements(new.items) with ordinality where value->>'quantity' ~ '^[1-9][0-9]{0,5}$'; return new;end $$;
create trigger orders_seed_items after insert on public.orders for each row execute function private.seed_order_items();
insert into private.order_items(order_id,line_index,snapshot,quantity,baseline_stage)
select o.id,e.ordinality::int-1,e.value,(e.value->>'quantity')::int,private.stage_number(o.status) from public.orders o cross join lateral jsonb_array_elements(o.items) with ordinality e where e.value->>'quantity' ~ '^[1-9][0-9]{0,5}$';
-- Preserve historical shipment stages using one imported batch per already-progressed order.
do $$ declare o record;s uuid;begin for o in select * from public.orders where private.stage_number(status)>=2 loop
 insert into private.shipments(label,stage) values('Existing order '||o.order_number,private.stage_number(o.status)) returning id into s;
 insert into private.shipment_items(shipment_id,order_item_id,quantity) select s,id,quantity from private.order_items where order_id=o.id;
 update private.order_items set baseline_stage=1 where order_id=o.id;
end loop;end $$;
update public.orders o set needs_attention=true,attention_reason='Legacy order needs a verified checkout; recreate it before payment.' where payment_status='pending' and pricing_verified_at is null;
update public.orders set refund_review_required=true,needs_attention=true,attention_reason='Cancelled paid order: review whether a refund is required.' where status='Order Cancelled' and payment_status='paid';
create or replace function private.recalculate_order(p_order uuid) returns void language plpgsql security definer set search_path='' as $$ declare o public.orders;n integer;begin
 select * into o from public.orders where id=p_order for update;
 if o.status='Order Cancelled' or o.payment_status<>'paid' then return;end if;
 select min(stage) into n from (
 select case when coalesce(sum(a.quantity),0)<i.quantity then i.baseline_stage else 7 end stage from private.order_items i left join private.shipment_items a on a.order_item_id=i.id where i.order_id=p_order group by i.id
 union all select s.stage from private.order_items i join private.shipment_items a on a.order_item_id=i.id join private.shipments s on s.id=a.shipment_id where i.order_id=p_order
 ) x;
 if n is not null then update public.orders set status=private.stage_name(greatest(1,n)) where id=p_order and status is distinct from private.stage_name(greatest(1,n));end if;
end $$;
create or replace function private.enqueue_receipt() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if new.payment_status='paid' and old.payment_status is distinct from 'paid' then
 update private.order_items set baseline_stage=1 where order_id=new.id and baseline_stage=0;
 insert into private.order_jobs(kind,job_key,order_id,deadline) values('receipt',new.id::text,new.id,now()+interval '23 hours') on conflict do nothing;
 end if;return new;end $$;
create trigger orders_enqueue_receipt after update of payment_status on public.orders for each row execute function private.enqueue_receipt();
create or replace function private.enqueue_payment() returns trigger language plpgsql security definer set search_path='' as $$ begin
 insert into private.order_jobs(kind,job_key,order_id,next_run,deadline) values('payment',new.reference,new.order_id,now()+interval '5 minutes',now()+interval '72 hours') on conflict do nothing;return new;end $$;
create trigger attempts_enqueue_payment after insert on public.payment_attempts for each row execute function private.enqueue_payment();
insert into private.order_jobs(kind,job_key,order_id,deadline) select 'payment',a.reference,a.order_id,now()+interval '72 hours' from public.payment_attempts a join public.orders o on o.id=a.order_id where o.payment_status='pending' and o.status<>'Order Cancelled' on conflict do nothing;
-- Historical paid receipts are preserved, never blindly resent during migration.
create or replace function public.finalize_verified_payment(p_order uuid,p_reference text,p_transaction jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$ declare o public.orders;a public.payment_attempts;begin
 select * into o from public.orders where id=p_order for update;
 select * into a from public.payment_attempts where reference=p_reference;
 if o.id is null or ((a.reference is not null and a.order_id is distinct from o.id) or (a.reference is null and o.payment_reference is distinct from p_reference)) then raise exception 'Payment reference does not belong to order';end if;
 if p_transaction->>'status' is distinct from 'success' or p_transaction->>'reference' is distinct from p_reference or p_transaction->>'currency' is distinct from o.currency or o.currency<>'GHS' or (p_transaction->>'amount')::numeric is distinct from round(o.estimated_total*100) or lower(p_transaction#>>'{customer,email}') is distinct from lower(o.customer_email) then raise exception 'Payment details do not match order';end if;
 if a.reference is not null and (a.amount<>round(o.estimated_total*100) or a.currency<>o.currency) then raise exception 'Payment attempt amount mismatch';end if;
 if (p_transaction#>>'{metadata,order_id}' is not null and p_transaction#>>'{metadata,order_id}'<>o.id::text) or (p_transaction#>>'{metadata,user_id}' is not null and p_transaction#>>'{metadata,user_id}'<>o.user_id::text) then raise exception 'Payment ownership mismatch';end if;
 if o.payment_status='paid' then
  if o.confirmed_reference is not null and o.confirmed_reference<>p_reference then update public.orders set needs_attention=true,refund_review_required=true,attention_reason='A second successful payment reference requires review.' where id=o.id;end if;
 else
  if o.payment_status<>'pending' or o.pricing_verified_at is null then raise exception 'Order requires payment review';end if;
  update public.orders set payment_status='paid',confirmed_reference=p_reference,payment_paid_at=coalesce((p_transaction->>'paid_at')::timestamptz,now()),status=case when status='Order Received' then 'Payment Made' else status end,refund_review_required=(status='Order Cancelled'),needs_attention=(status='Order Cancelled'),attention_reason=case when status='Order Cancelled' then 'Payment received after cancellation: refund review required.' else null end where id=o.id;
  insert into private.order_audit(order_id,action,details) values(o.id,'payment_verified',jsonb_build_object('reference',p_reference,'amount',p_transaction->'amount','currency',o.currency));
 end if;
 update public.payment_attempts set state='paid' where reference=p_reference;
 update private.order_jobs set state='done',lease_token=null,lease_until=null,last_error=null where kind='payment' and job_key=p_reference;
 select * into o from public.orders where id=p_order;return to_jsonb(o);
end $$;
create or replace function public.enqueue_payment_check(p_reference text) returns boolean language plpgsql security invoker set search_path='' as $$ declare oid uuid;begin
 select order_id into oid from public.payment_attempts where reference=p_reference;
 if oid is null then select id into oid from public.orders where payment_reference=p_reference;end if;
 if oid is null then return false;end if;
 insert into private.order_jobs(kind,job_key,order_id,deadline) values('payment',p_reference,oid,now()+interval '72 hours') on conflict(kind,job_key) do update set state=case when order_jobs.state='running' then 'running' else 'queued' end,next_run=now(),deadline=greatest(order_jobs.deadline,now()+interval '1 hour');return true;
end $$;
create or replace function public.claim_order_jobs() returns setof private.order_jobs language sql security invoker set search_path='' as $$
 update private.order_jobs j set state='running',lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=attempts+1
 where j.id in(select id from private.order_jobs where (state='queued' and next_run<=now()) or (state='running' and lease_until<now()) order by next_run for update skip locked limit 50) returning j.*;
$$;
create or replace function public.read_order_job(p_id uuid,p_lease uuid) returns jsonb language sql security invoker set search_path='' as $$ select to_jsonb(j) from private.order_jobs j where id=p_id and lease_token=p_lease and state='running' and lease_until>now() $$;
create or replace function public.finish_order_job(p_id uuid,p_lease uuid,p_state text,p_error text default null) returns void language plpgsql security invoker set search_path='' as $$ declare j private.order_jobs;begin
 select * into j from private.order_jobs where id=p_id and lease_token=p_lease and state='running' for update;if j.id is null then return;end if;
 if p_state not in ('done','queued','attention') then raise exception 'Invalid job state';end if;
 update private.order_jobs set state=case when p_state='queued' and deadline<=now() then 'attention' else p_state end,lease_token=null,lease_until=null,last_error=left(p_error,500),next_run=now()+make_interval(secs=>least(21600,(300*power(3,least(j.attempts-1,4)))::integer)) where id=j.id;
end $$;
create or replace function public.cancel_customer_order(p_user uuid,p_number text) returns jsonb language plpgsql security invoker set search_path='' as $$ declare o public.orders;begin
 select * into o from public.orders where order_number=p_number and user_id=p_user for update;if o.id is null then raise exception 'Order not found';end if;
 if o.status='Order Cancelled' then return jsonb_build_object('ok',true,'status',o.status);end if;
 if private.stage_number(o.status)>=3 or exists(select 1 from private.shipment_items a join private.order_items i on i.id=a.order_item_id join private.shipments s on s.id=a.shipment_id where i.order_id=o.id and s.stage>=3) then raise exception 'An item has already shipped; contact support';end if;
 update public.orders set status='Order Cancelled',refund_review_required=(payment_status='paid'),needs_attention=(payment_status='paid'),attention_reason=case when payment_status='paid' then 'Cancelled paid order: refund review required.' else attention_reason end where id=o.id;
 insert into private.order_audit(actor_id,order_id,action) values(p_user,o.id,'customer_cancelled');return jsonb_build_object('ok',true,'status','Order Cancelled','refundReviewRequired',o.payment_status='paid');
end $$;
create or replace function private.store_admin(p_actor uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from auth.users where id=p_actor and raw_app_meta_data->>'store_role'='admin') $$;
revoke all on function private.store_admin(uuid) from public,anon,authenticated;
grant execute on function private.store_admin(uuid) to service_role;
create or replace function public.order_operations(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;sid uuid;oid uuid;item private.order_items;s private.shipments;allocation record;requested integer;used integer;off integer:=greatest(0,least(1000000,coalesce((p_data->>'page')::int,1)-1))*25;begin
 if not private.store_admin(p_actor) then raise exception 'Admin access required';end if;
 if p_action='orders' then
 select jsonb_build_object('orders',coalesce(jsonb_agg(to_jsonb(q)),'[]'),'page',off/25+1) into result from (
 select o.*,count(*) over() total_count,exists(select 1 from private.order_jobs j where j.order_id=o.id and j.state='attention') job_attention from public.orders o where
 (coalesce(p_data->>'search','')='' or o.order_number ilike '%'||(p_data->>'search')||'%' or o.customer_name ilike '%'||(p_data->>'search')||'%') and
 (coalesce(p_data->>'payment','')='' or o.payment_status=p_data->>'payment') and (coalesce(p_data->>'status','')='' or o.status=p_data->>'status') and
 (coalesce((p_data->>'attention')::boolean,false)=false or o.needs_attention or exists(select 1 from private.order_jobs j where j.order_id=o.id and j.state='attention'))
 order by o.created_at desc,o.id desc limit 25 offset off) q;return result;
 elsif p_action='detail' then
 select id into oid from public.orders where id=(p_data->>'id')::uuid;
 select jsonb_build_object('order',to_jsonb(o),'items',(select coalesce(jsonb_agg(to_jsonb(i)||jsonb_build_object('allocated',coalesce((select sum(quantity) from private.shipment_items where order_item_id=i.id),0)) order by i.line_index),'[]') from private.order_items i where order_id=o.id),'attempts',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from public.payment_attempts a where a.order_id=o.id),'jobs',(select coalesce(jsonb_agg(to_jsonb(j)-'lease_token'),'[]') from private.order_jobs j where order_id=o.id),'audit',(select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc),'[]') from private.order_audit a where order_id=o.id)) into result from public.orders o where id=oid;return result;
 elsif p_action='shipments' then
 select coalesce(jsonb_agg(to_jsonb(q)),'[]') into result from(select s.*,count(*) over() total_count,(select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('order_number',o.order_number,'name',i.snapshot->>'name')),'[]') from private.shipment_items a join private.order_items i on i.id=a.order_item_id join public.orders o on o.id=i.order_id where a.shipment_id=s.id) items from private.shipments s order by s.created_at desc,s.id desc limit 25 offset off)q;return jsonb_build_object('shipments',result,'page',off/25+1);
 elsif p_action='create_shipment' then
 if length(trim(coalesce(p_data->>'label',''))) not between 1 and 120 or length(coalesce(p_data->>'tracking_code',''))>120 then raise exception 'Enter a shipment name (120 characters maximum)';end if;
 insert into private.shipments(label,tracking_code) values(trim(p_data->>'label'),coalesce(p_data->>'tracking_code','')) returning id into sid;
 insert into private.order_audit(actor_id,shipment_id,action,details) values(p_actor,sid,p_action,p_data);return jsonb_build_object('id',sid);
 elsif p_action in ('allocate','unassign','advance') then
 sid:=(p_data->>'shipment_id')::uuid;select * into s from private.shipments where id=sid for update;
 if s.id is null then raise exception 'Shipment not found';end if;
 if s.version is distinct from (p_data->>'version')::int then raise exception 'Shipment changed; refresh and try again';end if;
 if p_action='allocate' then
 if s.stage<>2 then raise exception 'Items can only be assigned before shipment';end if;
 if jsonb_typeof(p_data->'items')<>'array' or jsonb_array_length(p_data->'items') not between 1 and 100 then raise exception 'Choose items to assign';end if;
 -- Lock all affected orders in a stable order before enforcing allocation limits.
 perform 1 from public.orders o where id in(select i.order_id from private.order_items i join jsonb_array_elements(p_data->'items') x on i.id=(x->>'item_id')::uuid) order by id for update;
 for allocation in select value from jsonb_array_elements(p_data->'items') loop
 select * into item from private.order_items where id=(allocation.value->>'item_id')::uuid for update;
 if item.id is null then raise exception 'Order item not found';end if;
 if not exists(select 1 from public.orders where id=item.order_id and payment_status='paid' and status<>'Order Cancelled') or item.baseline_stage>2 then raise exception 'Only paid, unshipped items can be assigned';end if;
 requested:=(allocation.value->>'quantity')::integer;
 select coalesce(sum(quantity),0) into used from private.shipment_items where order_item_id=item.id;
 if requested is null or requested<1 or requested>item.quantity-used then raise exception 'Quantity exceeds remaining items';end if;
 insert into private.shipment_items(shipment_id,order_item_id,quantity) values(sid,item.id,requested) on conflict(shipment_id,order_item_id) do update set quantity=shipment_items.quantity+excluded.quantity;
 insert into private.order_audit(actor_id,order_id,shipment_id,action,details) values(p_actor,item.order_id,sid,p_action,allocation.value);
 perform private.recalculate_order(item.order_id);
 end loop;
 else
 perform 1 from public.orders o where id in(select i.order_id from private.order_items i join private.shipment_items a on a.order_item_id=i.id where a.shipment_id=sid) order by id for update;
 if p_action='unassign' then
 if s.stage<>2 then raise exception 'Shipped items cannot be unassigned';end if;
 select i.order_id into oid from private.order_items i join private.shipment_items a on a.order_item_id=i.id where a.id=(p_data->>'allocation_id')::uuid and a.shipment_id=sid;
 if oid is null then raise exception 'Allocation not found';end if;
 delete from private.shipment_items where id=(p_data->>'allocation_id')::uuid and shipment_id=sid;
 insert into private.order_audit(actor_id,order_id,shipment_id,action,details) values(p_actor,oid,sid,p_action,p_data);perform private.recalculate_order(oid);
 else
 requested:=(p_data->>'stage')::int;
 if requested is null or requested<=s.stage or requested>7 then raise exception 'Choose a later shipment stage';end if;
 if not exists(select 1 from private.shipment_items where shipment_id=sid) then raise exception 'Assign items before advancing shipment';end if;
 if exists(select 1 from private.shipment_items a join private.order_items i on i.id=a.order_item_id join public.orders o on o.id=i.order_id where a.shipment_id=sid and (o.status='Order Cancelled' or o.payment_status<>'paid')) then raise exception 'Remove cancelled or unpaid orders before advancing';end if;
 update private.shipments set stage=requested where id=sid;
 for oid in select distinct i.order_id from private.order_items i join private.shipment_items a on a.order_item_id=i.id where a.shipment_id=sid loop
 insert into private.order_audit(actor_id,order_id,shipment_id,action,details) values(p_actor,oid,sid,p_action,jsonb_build_object('before',s.stage,'after',requested));perform private.recalculate_order(oid);end loop;
 end if;
 end if;
 update private.shipments set version=version+1 where id=sid;return jsonb_build_object('ok',true);
 elsif p_action='audit_recheck' then
 insert into private.order_audit(actor_id,order_id,action) values(p_actor,(p_data->>'id')::uuid,'admin_payment_recheck');return jsonb_build_object('ok',true);
 end if;raise exception 'Unsupported operation';end $$;
create or replace function public.customer_shipment_tracking(p_user uuid,p_order uuid) returns jsonb language sql security invoker set search_path='' as $$
select jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object('name',i.snapshot->>'name','color',i.snapshot->>'color','size',i.snapshot->>'size','variant',i.snapshot->>'variant','quantity',i.quantity,'unassigned',i.quantity-coalesce((select sum(a.quantity) from private.shipment_items a where a.order_item_id=i.id),0),'shipments',(select coalesce(jsonb_agg(jsonb_build_object('label',s.label,'tracking_code',s.tracking_code,'stage',private.stage_name(s.stage),'quantity',a.quantity)),'[]') from private.shipment_items a join private.shipments s on s.id=a.shipment_id where a.order_item_id=i.id))) ,'[]')) from private.order_items i join public.orders o on o.id=i.order_id where o.id=p_order and o.user_id=p_user;
$$;
-- All privileged RPCs are server-only; browser callers cannot choose actors or users.
do $$ declare f record;begin
 for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='private' and p.proname in ('stage_name','stage_number','seed_order_items','recalculate_order','enqueue_receipt','enqueue_payment')) or (n.nspname='public' and p.proname in ('finalize_verified_payment','enqueue_payment_check','claim_order_jobs','read_order_job','finish_order_job','cancel_customer_order','order_operations','customer_shipment_tracking')) loop
 execute format('revoke all on function %s from public, anon, authenticated',f.sig);execute format('grant execute on function %s to service_role',f.sig);end loop;end $$;
