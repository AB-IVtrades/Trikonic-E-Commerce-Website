begin;
insert into auth.users(id,raw_app_meta_data)values('00000000-0000-0000-0000-000000000083','{}'),('00000000-0000-0000-0000-000000000084','{}');
insert into auth.sessions(id,user_id,created_at,updated_at,user_agent)values('00000000-0000-0000-0000-000000000085','00000000-0000-0000-0000-000000000083',now(),now(),'Test current browser'),('00000000-0000-0000-0000-000000000086','00000000-0000-0000-0000-000000000083',now(),now(),'Test other browser'),('00000000-0000-0000-0000-000000000087','00000000-0000-0000-0000-000000000084',now(),now(),'Another customer');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into public.orders(order_number,user_id,customer_name,customer_email,contact,items,estimated_total,pricing_verified_at)values('TRK-1794840000000-SESS','00000000-0000-0000-0000-000000000083','Fixture','test@example.test','test','[]',1,now());
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000083","session_id":"00000000-0000-0000-0000-000000000085"}',true);
set local role authenticated;
do $$ declare r jsonb;blocked boolean;begin
 if not public.is_current_session_active() then raise exception 'Valid session rejected';end if;
 r:=public.manage_own_sessions();if jsonb_array_length(r->'sessions')<>2 then raise exception 'Session list ownership failed';end if;
 if (select count(*) from public.orders)<>1 then raise exception 'Active session cannot read own order';end if;
 blocked:=false;begin perform public.manage_own_sessions('revoke','00000000-0000-0000-0000-000000000087');exception when raise_exception then blocked:=true;end;if not blocked then raise exception 'Foreign session revocation accepted';end if;
 blocked:=false;begin perform public.manage_own_sessions('revoke','00000000-0000-0000-0000-000000000085');exception when raise_exception then blocked:=true;end;if not blocked then raise exception 'Current session protection failed';end if;
 r:=public.manage_own_sessions('revoke','00000000-0000-0000-0000-000000000086');if jsonb_array_length(r->'sessions')<>1 or not public.is_current_session_active() then raise exception 'Selective revocation failed';end if;
end $$;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000083","session_id":"00000000-0000-0000-0000-000000000086"}',true);
do $$ declare blocked boolean;begin
 if public.is_current_session_active() then raise exception 'Revoked session accepted';end if;
 if exists(select 1 from public.orders) then raise exception 'Revoked token can read orders';end if;
 if exists(select 1 from public.order_status_events) then raise exception 'Revoked token can read tracking';end if;
 blocked:=false;begin perform public.manage_own_sessions();exception when raise_exception then blocked:=true;end;if not blocked then raise exception 'Revoked session can manage devices';end if;
end $$;
reset role;
select json_build_object('device_session_tests','passed','other_user_still_signed_in',exists(select 1 from auth.sessions where id='00000000-0000-0000-0000-000000000087'),'anon_can_list',has_function_privilege('anon','public.manage_own_sessions(text,uuid,integer)','execute'));
rollback;
