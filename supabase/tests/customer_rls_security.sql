begin;
insert into auth.users(id,raw_app_meta_data) values('00000000-0000-0000-0000-000000000081','{}'),('00000000-0000-0000-0000-000000000082','{}');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into public.orders(order_number,user_id,customer_name,customer_email,contact,items,estimated_total,pricing_verified_at) values('TRK-1794840000000-RLS1','00000000-0000-0000-0000-000000000081','Test','rls@example.test','test','[]',1,now()),('TRK-1794840000000-RLS2','00000000-0000-0000-0000-000000000082','Test','rls@example.test','test','[]',1,now());
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000081","user_metadata":{"store_role":"admin"}}',true);
set local role authenticated;
do $$ declare affected int;blocked boolean;begin
 if public.is_store_admin() then raise exception 'Customer-controlled metadata grants admin';end if;
 update public.site_settings set maintenance_mode=not maintenance_mode where id=1;get diagnostics affected=row_count;
 if affected<>0 then raise exception 'Non-admin can toggle maintenance';end if;
 if (select count(*) from public.orders)<>1 then raise exception 'Order ownership failure';end if;
 if (select count(*) from public.order_status_events)<>1 then raise exception 'Timeline ownership failure';end if;
 if exists(select 1 from public.order_status_events e join public.orders o on o.id=e.order_id where o.user_id<>auth.uid()) then raise exception 'Other customer timeline visible';end if;
 blocked:=false;begin update public.orders set payment_status='paid';exception when insufficient_privilege then blocked:=true;end;if not blocked then raise exception 'Direct order update allowed';end if;
 blocked:=false;begin insert into public.orders(order_number,user_id,customer_name,customer_email,contact,items,estimated_total) values('TRK-1794840000000-RLS3',auth.uid(),'Fake','rls@example.test','test','[]',0);exception when insufficient_privilege then blocked:=true;end;if not blocked then raise exception 'Direct order insert allowed';end if;
 blocked:=false;begin insert into public.order_status_events(order_id,status) select id,'Order Delivered' from public.orders;exception when insufficient_privilege then blocked:=true;end;if not blocked then raise exception 'Direct status insert allowed';end if;
 blocked:=false;begin update public.order_status_events set status='Order Delivered';exception when insufficient_privilege then blocked:=true;end;if not blocked then raise exception 'Direct status update allowed';end if;
end $$;
reset role;
do $$ declare p record;allowed boolean; own text:= '00000000-0000-0000-0000-000000000081/avatar';begin
 for p in select policyname,coalesce(with_check,qual) predicate from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'Customers can %their profile photo' loop
 execute 'select '||p.predicate||' from (select ''profile-photos''::text bucket_id,$1::text name) x' into allowed using own;
 if not allowed then raise exception 'Own avatar rejected by %',p.policyname;end if;
 execute 'select '||p.predicate||' from (select ''profile-photos''::text bucket_id,$1::text name) x' into allowed using '00000000-0000-0000-0000-000000000082/avatar';
 if allowed then raise exception 'Cross-user avatar allowed by %',p.policyname;end if;
 execute 'select '||p.predicate||' from (select ''profile-photos''::text bucket_id,$1::text name) x' into allowed using own||'/extra';
 if allowed then raise exception 'Other avatar path allowed by %',p.policyname;end if;
 end loop;
end $$;
select json_build_object('non_admin_maintenance_blocked',true,'customer_order_isolation',true,'direct_order_and_status_writes_blocked',true,'avatar_policy_predicates_checked',true);
rollback;
