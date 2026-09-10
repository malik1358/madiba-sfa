create extension if not exists pg_net;
create extension if not exists pg_cron with schema pg_catalog;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;
grant usage on schema private to postgres;
grant usage on schema private to service_role;

create or replace function private.upsert_vault_secret(
  p_name text,
  p_secret text,
  p_description text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_id uuid;
begin
  if p_name is null or btrim(p_name) = '' then
    raise exception 'secret name is required';
  end if;
  if p_secret is null or btrim(p_secret) = '' then
    raise exception 'secret value is required';
  end if;

  select id into existing_id
  from vault.secrets
  where name = p_name;

  if existing_id is null then
    perform vault.create_secret(p_secret, p_name, coalesce(p_description, ''));
  else
    perform vault.update_secret(existing_id, p_secret, p_name, coalesce(p_description, ''));
  end if;
end;
$$;

revoke all on function private.upsert_vault_secret(text, text, text) from public;
revoke all on function private.upsert_vault_secret(text, text, text) from anon;
revoke all on function private.upsert_vault_secret(text, text, text) from authenticated;
grant execute on function private.upsert_vault_secret(text, text, text) to postgres;
grant execute on function private.upsert_vault_secret(text, text, text) to service_role;

create or replace function public.upsert_missing_invoice_cron_vault(p_secret text, p_url text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_secret is null or btrim(p_secret) = '' then
    raise exception 'cron secret is required';
  end if;
  if p_url is null or btrim(p_url) !~ '^https://'
    or p_url !~ '/api/cron/missing-invoice-email/?$' then
    raise exception 'missing invoice email URL is invalid';
  end if;

  perform private.upsert_vault_secret(
    'cron_secret',
    btrim(p_secret),
    'Shared with Vercel CRON_SECRET for scheduled HTTP jobs'
  );
  perform private.upsert_vault_secret(
    'missing_invoice_email_url',
    btrim(p_url),
    'Production missing invoice email endpoint'
  );

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.upsert_missing_invoice_cron_vault(text, text) from public;
revoke all on function public.upsert_missing_invoice_cron_vault(text, text) from anon;
revoke all on function public.upsert_missing_invoice_cron_vault(text, text) from authenticated;
grant execute on function public.upsert_missing_invoice_cron_vault(text, text) to service_role;

create or replace function private.trigger_missing_invoice_email()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_url text;
  cron_secret text;
  request_id bigint;
begin
  select decrypted_secret into target_url
  from vault.decrypted_secrets
  where name = 'missing_invoice_email_url';

  select decrypted_secret into cron_secret
  from vault.decrypted_secrets
  where name = 'cron_secret';

  if target_url is null or btrim(target_url) = '' then
    raise exception 'vault secret missing_invoice_email_url is not set';
  end if;
  if cron_secret is null or btrim(cron_secret) = '' then
    raise exception 'vault secret cron_secret is not set';
  end if;

  select net.http_post(
    url := target_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', cron_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function private.trigger_missing_invoice_email() from public;
revoke all on function private.trigger_missing_invoice_email() from anon;
revoke all on function private.trigger_missing_invoice_email() from authenticated;
grant execute on function private.trigger_missing_invoice_email() to postgres;

do $$
begin
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'missing-invoice-email';
end;
$$;

select cron.schedule(
  'missing-invoice-email',
  '*/15 * * * *',
  $$select private.trigger_missing_invoice_email()$$
);
