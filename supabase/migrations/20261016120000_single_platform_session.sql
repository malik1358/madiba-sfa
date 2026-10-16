-- Keep one Supabase Auth session per platform for every role except admin.
-- android = Capacitor/Android WebView (user agent contains "; wv)").
-- web = every other browser.
-- Keep the decision aligned with sessionsToRevoke in app/lib/authSessionLimit.js.

create or replace function public.enforce_single_platform_session(
  p_session_id uuid,
  p_platform text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user uuid;
  v_role text;
  v_user_agent text;
  v_platform text;
  v_revoked integer := 0;
begin
  select s.user_id, s.user_agent
    into v_user, v_user_agent
  from auth.sessions s
  where s.id = p_session_id;

  if v_user is null then
    return jsonb_build_object('ok', false, 'limited', false, 'revoked', 0);
  end if;

  select p.role
    into v_role
  from public.profiles p
  where p.id = v_user;

  if replace(lower(trim(coalesce(v_role, ''))), '_', '-') = 'admin' then
    return jsonb_build_object('ok', true, 'limited', false, 'revoked', 0);
  end if;

  if coalesce(v_user_agent, '') ~* ';[[:space:]]*wv\)' then
    v_platform := 'android';
  elsif length(trim(coalesce(v_user_agent, ''))) > 0 then
    v_platform := 'web';
  elsif lower(trim(coalesce(p_platform, ''))) in ('android', 'web') then
    v_platform := lower(trim(p_platform));
  else
    v_platform := 'web';
  end if;

  with doomed as (
    select s.id
    from auth.sessions s
    where s.user_id = v_user
      and s.id <> p_session_id
      and (
        case
          when coalesce(s.user_agent, '') ~* ';[[:space:]]*wv\)' then 'android'
          else 'web'
        end
      ) = v_platform
  ),
  deleted_sessions as (
    delete from auth.sessions s
    where s.id in (select doomed.id from doomed)
    returning s.id
  )
  select count(*) into v_revoked from deleted_sessions;

  return jsonb_build_object('ok', true, 'limited', true, 'revoked', v_revoked);
end;
$$;

revoke all on function public.enforce_single_platform_session(uuid, text) from public;
revoke all on function public.enforce_single_platform_session(uuid, text) from anon;
revoke all on function public.enforce_single_platform_session(uuid, text) from authenticated;
grant execute on function public.enforce_single_platform_session(uuid, text) to service_role;
