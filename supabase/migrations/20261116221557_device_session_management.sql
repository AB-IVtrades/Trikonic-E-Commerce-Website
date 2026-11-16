-- Session checks use the signed JWT's own user/session identifiers only.
create or replace function public.is_current_session_active() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.sessions s where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id' and (s.not_after is null or s.not_after>now()));
$$;
revoke all on function public.is_current_session_active() from public,anon;
grant execute on function public.is_current_session_active() to authenticated;
create table private.session_actions(id uuid primary key default gen_random_uuid(),user_id uuid not null,actor_session_id uuid not null,target_session_id uuid not null,created_at timestamptz not null default now());
alter table private.session_actions enable row level security;
revoke all on private.session_actions from public,anon,authenticated;
create or replace function public.manage_own_sessions(p_action text default 'list',p_target uuid default null,p_page integer default 1) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();current_id uuid;result jsonb;total integer;off integer:=greatest(0,least(999,coalesce(p_page,1)-1))*20;begin
 if uid is null then raise exception 'Please sign in again';end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,17));
 if not public.is_current_session_active() then raise exception 'Your session has ended. Please sign in again';end if;
 current_id:=(auth.jwt()->>'session_id')::uuid;
 if p_action='revoke' then
  if p_target is null or p_target=current_id then raise exception 'Use Sign out on this device to end your current session';end if;
  if not exists(select 1 from auth.sessions where id=p_target and user_id=uid) then raise exception 'This session is no longer available';end if;
  delete from auth.sessions where id=p_target and user_id=uid;
  insert into private.session_actions(user_id,actor_session_id,target_session_id) values(uid,current_id,p_target);
 elsif p_action<>'list' then raise exception 'Invalid session action';end if;
 select count(*) into total from auth.sessions where user_id=uid and (not_after is null or not_after>now());
 select coalesce(jsonb_agg(to_jsonb(q)),'[]') into result from(select id,created_at,updated_at,left(user_agent,300) user_agent,id=current_id is_current from auth.sessions where user_id=uid and (not_after is null or not_after>now()) order by created_at desc,id limit 20 offset off)q;
 return jsonb_build_object('sessions',result,'total',total,'page',off/20+1);
end $$;
revoke all on function public.manage_own_sessions(text,uuid,integer) from public,anon;
grant execute on function public.manage_own_sessions(text,uuid,integer) to authenticated;
-- A revoked access token must also fail private-data RLS immediately.
do $$ declare p record;ddl text;begin
 for p in select policies.* from pg_policies policies where schemaname='public' and tablename in('orders','order_status_events') or schemaname='public' and tablename='site_settings' and policies.cmd='UPDATE' or schemaname='storage' and tablename='objects' and policyname like 'Customers can %their profile photo' loop
 ddl:='alter policy '||quote_ident(p.policyname)||' on '||quote_ident(p.schemaname)||'.'||quote_ident(p.tablename);
 if p.qual is not null then ddl:=ddl||' using (('||p.qual||') and (select public.is_current_session_active()))';end if;
 if p.with_check is not null then ddl:=ddl||' with check (('||p.with_check||') and (select public.is_current_session_active()))';end if;
 execute ddl;
 end loop;
end $$;
