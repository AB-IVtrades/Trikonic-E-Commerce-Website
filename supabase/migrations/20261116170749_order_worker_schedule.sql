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
 select coalesce(jsonb_agg(to_jsonb(q)),'[]') into result from(select s.*,count(*) over() total_count,(select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('order_number',o.order_number,'name',i.snapshot->>'name')),'[]') from private.shipment_items a join private.order_items i on i.id=a.order_item_id join public.orders o on o.id=i.order_id where a.shipment_id=s.id) items from private.shipments s where (coalesce(p_data->>'search','')='' or s.label ilike '%'||(p_data->>'search')||'%' or s.tracking_code ilike '%'||(p_data->>'search')||'%') and (p_data->>'stage' is null or s.stage=(p_data->>'stage')::int) order by s.created_at desc,s.id desc limit 25 offset off)q;return jsonb_build_object('shipments',result,'page',off/25+1);
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

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
do $$ begin if not exists(select 1 from vault.secrets where name='order_worker_key') then perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'order_worker_key');end if;end $$;
create or replace function private.worker_key_matches(p_token text) returns boolean language sql stable security definer set search_path='' as $$ select coalesce((select extensions.digest(p_token,'sha256')=extensions.digest(decrypted_secret,'sha256') from vault.decrypted_secrets where name='order_worker_key'),false) $$;
revoke all on function private.worker_key_matches(text) from public,anon,authenticated;
grant execute on function private.worker_key_matches(text) to service_role;
create or replace function public.authorize_order_worker(p_token text) returns boolean language sql security invoker set search_path='' as $$ select private.worker_key_matches(p_token) $$;
revoke all on function public.authorize_order_worker(text) from public,anon,authenticated;
grant execute on function public.authorize_order_worker(text) to service_role;
create or replace function private.dispatch_order_jobs() returns bigint language sql security definer set search_path='' as $$
 select net.http_post(url:='https://wxhdfrnjoohiktqujbik.supabase.co/functions/v1/process-order-jobs',headers:=jsonb_build_object('Content-Type','application/json','X-Order-Worker-Key',(select decrypted_secret from vault.decrypted_secrets where name='order_worker_key')),body:='{}'::jsonb,timeout_milliseconds:=20000);
$$;
revoke all on function private.dispatch_order_jobs() from public,anon,authenticated;
-- Schedule is activated only after functions are deployed and tested.
