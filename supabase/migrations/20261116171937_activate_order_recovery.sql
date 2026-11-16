create or replace function private.dispatch_order_jobs() returns bigint language sql security definer set search_path='' as $$
 select net.http_post(url:='https://wxhdfrnjoohiktqujbik.supabase.co/functions/v1/process-order-jobs',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='order_worker_key')),body:='{}'::jsonb,timeout_milliseconds:=20000);
$$;
revoke all on function private.dispatch_order_jobs() from public,anon,authenticated;
do $$ declare old_job bigint;begin select jobid into old_job from cron.job where jobname='trikonic-order-recovery';if old_job is not null then perform cron.unschedule(old_job);end if;perform cron.schedule('trikonic-order-recovery','*/5 * * * *','select private.dispatch_order_jobs();');end $$;
