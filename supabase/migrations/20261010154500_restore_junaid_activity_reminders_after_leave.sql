-- One-shot leave restore: JUNAID annual leave ends 2026-11-08 (inclusive).
-- From 2026-11-09 KSA, turn activity reminders back on and unschedule this job.
-- Requires existing pg_cron (see 20260910120000_missing_invoice_pg_cron.sql).

create schema if not exists private;

create or replace function private.restore_junaid_activity_reminders_after_leave()
returns void
language plpgsql
security definer
set search_path = public, cron, pg_temp
as $$
begin
  if (timezone('Asia/Riyadh', now()))::date < date '2026-11-09' then
    return;
  end if;

  update public.profiles
  set activity_reminders_enabled = true
  where upper(btrim(coalesce(salesman_code, ''))) = 'JUNAID'
    and activity_reminders_enabled is distinct from true;

  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'restore-junaid-activity-reminders-after-leave';
end;
$$;

revoke all on function private.restore_junaid_activity_reminders_after_leave() from public;
revoke all on function private.restore_junaid_activity_reminders_after_leave() from anon;
revoke all on function private.restore_junaid_activity_reminders_after_leave() from authenticated;
grant execute on function private.restore_junaid_activity_reminders_after_leave() to postgres;
grant execute on function private.restore_junaid_activity_reminders_after_leave() to service_role;

do $$
begin
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'restore-junaid-activity-reminders-after-leave';
exception
  when undefined_table then
    null;
  when others then
    -- job may not exist yet
    null;
end;
$$;

-- 00:10 KSA daily until the function unschedules itself on/after 2026-11-09.
select cron.schedule(
  'restore-junaid-activity-reminders-after-leave',
  '10 21 * * *',
  $$select private.restore_junaid_activity_reminders_after_leave()$$
);
