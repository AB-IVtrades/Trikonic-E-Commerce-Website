-- Fixed-window counters contain keyed hashes only; callers cannot read/reset them.
create table private.request_limits (
  key text primary key,
  started_at timestamptz not null,
  hits integer not null check (hits > 0)
);
alter table private.request_limits enable row level security;
revoke all on private.request_limits from public, anon, authenticated;
grant usage on schema private to service_role;
grant all on private.request_limits to service_role;
create or replace function public.consume_request_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare used integer;
begin
  if length(p_key) > 128 or p_key is null or p_limit < 1 or p_limit > 10000 or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'Invalid request limit';
  end if;
  delete from private.request_limits where started_at < now() - interval '2 days';
  insert into private.request_limits as limits(key, started_at, hits)
  values(p_key, now(), 1)
  on conflict(key) do update set
    hits = case when limits.started_at <= now() - make_interval(secs => p_window_seconds) then 1 else limits.hits + 1 end,
    started_at = case when limits.started_at <= now() - make_interval(secs => p_window_seconds) then now() else limits.started_at end
  returning hits into used;
  return used <= p_limit;
end;
$$;
revoke all on function public.consume_request_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_request_limit(text, integer, integer) to service_role;
