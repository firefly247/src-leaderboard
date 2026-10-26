"""Generate the independent API's public projection and server-only auth schema."""
from pathlib import Path
import json, re
ROOT=Path(__file__).resolve().parents[1]
layout=json.loads(re.search(r'var StorageLayout = (.*);', (ROOT/'apps-script/StorageLayout.gs').read_text(), re.S)[1])
public=[(n,s) for n,s in layout.items() if s.get('path')]
aggregates=',\n'.join("'%s',(select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.club_%s t)"%(n,n) for n,s in public)
sql='''-- Additive migration; existing Apps Script production remains functional until cutover.
begin;
create or replace function public.club_public_read() returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
select jsonb_build_object('revision',(select revision from public.club_store_meta where id),'tables',jsonb_build_object(
'''+aggregates+'''));
$$;
revoke all on function public.club_public_read() from public;
grant execute on function public.club_public_read() to anon, authenticated, service_role;

create table if not exists public.club_accounts (
 user_id uuid primary key references auth.users(id) on delete cascade,
 player_name text unique, requested_player_name text,
 role text not null default 'member' check(role in ('member','admin')),
 linked_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.club_admin_config (id boolean primary key default true check(id), password_hash text not null);
create table if not exists public.club_admin_sessions (token_hash text primary key, expires_at timestamptz not null);
create table if not exists public.club_api_limits (key text primary key, count integer not null, expires_at timestamptz not null);
alter table public.club_accounts enable row level security;
alter table public.club_admin_config enable row level security;
alter table public.club_admin_sessions enable row level security;
alter table public.club_api_limits enable row level security;
revoke all on public.club_accounts,public.club_admin_config,public.club_admin_sessions,public.club_api_limits from public,anon,authenticated;
grant select,insert,update,delete on public.club_accounts,public.club_admin_config,public.club_admin_sessions,public.club_api_limits to service_role;

create or replace function public.club_api_limit(p_key text,p_limit integer,p_seconds integer) returns boolean
language plpgsql security invoker set search_path=pg_catalog as $$
declare attempts integer;
begin
 if length(p_key)>200 or p_limit<1 or p_limit>1000 or p_seconds<1 or p_seconds>3600 then raise exception 'invalid_limit'; end if;
 delete from public.club_api_limits where expires_at < now();
 insert into public.club_api_limits values(p_key,1,now()+make_interval(secs=>p_seconds))
 on conflict(key) do update set count=club_api_limits.count+1 returning count into attempts;
 return attempts<=p_limit;
end;$$;

-- One-time owner-run transfer from the existing server; never accepts browser calls.
create or replace function public.club_admin_initialize(p_password text) returns boolean
language plpgsql security invoker set search_path=pg_catalog,extensions as $$
begin
 if length(p_password)<1 or length(p_password)>512 then raise exception 'invalid_password'; end if;
 insert into public.club_admin_config values(true,extensions.crypt(p_password,extensions.gen_salt('bf',12))) on conflict(id) do nothing;
 return found;
end;$$;
create or replace function public.club_admin_login(p_password text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,extensions as $$
declare saved_hash text; token text;
begin
 select password_hash into saved_hash from public.club_admin_config where id;
 if saved_hash is null or p_password is null or length(p_password)>512 or extensions.crypt(p_password,saved_hash) is distinct from saved_hash then raise exception 'invalid_credentials'; end if;
 delete from public.club_admin_sessions where expires_at<now();
 token:=gen_random_uuid()::text||gen_random_uuid()::text;
 insert into public.club_admin_sessions values(encode(extensions.digest(token,'sha256'),'hex'),now()+interval '6 hours');
 return jsonb_build_object('adminToken',token);
end;$$;
create or replace function public.club_admin_validate(p_token text) returns boolean
language sql stable security invoker set search_path=pg_catalog,extensions as $$
 select length(p_token)=72 and exists(select 1 from public.club_admin_sessions where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and expires_at>now());
$$;
create or replace function public.club_member_approve(p_user_id uuid,p_player_name text) returns boolean
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 perform 1 from public.club_accounts where user_id=p_user_id and requested_player_name=p_player_name for update;
 if not found then raise exception 'membership_request_changed'; end if;
 if not exists(select 1 from public.club_player_birth_years where member_name=p_player_name) or exists(select 1 from public.club_dormant_members where member_name=p_player_name) then raise exception 'invalid_player'; end if;
 update public.club_accounts set player_name=p_player_name,requested_player_name=null,linked_at=now() where user_id=p_user_id;
 return true;
end;$$;
revoke all on function public.club_api_limit(text,integer,integer),public.club_admin_initialize(text),public.club_admin_login(text),public.club_admin_validate(text),public.club_member_approve(uuid,text) from public,anon,authenticated;
grant execute on function public.club_api_limit(text,integer,integer),public.club_admin_initialize(text),public.club_admin_login(text),public.club_admin_validate(text),public.club_member_approve(uuid,text) to service_role;
commit;
'''
(ROOT/'supabase/migrations/20261026090000_independent_api.sql').write_text(sql,encoding='utf-8')
print('Prepared independent public read + server-only account/session migration')
