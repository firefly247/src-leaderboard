begin;

create table public.club_operations_config (
  id boolean primary key default true check (id),
  password_hash text not null,
  version uuid not null default gen_random_uuid()
);
create table public.club_operations_sessions (
  token_hash text primary key,
  user_id uuid not null references public.club_accounts(user_id) on delete cascade,
  version uuid not null,
  expires_at timestamptz not null default (now() + interval '30 minutes')
);
create table public.club_operations_posts (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('rules','equipment','general')),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  content text not null check (char_length(btrim(content)) between 1 and 8000),
  author_id uuid references public.club_accounts(user_id) on delete set null,
  author_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index on public.club_operations_posts (created_at desc, id desc) where archived_at is null;
create index on public.club_operations_sessions (expires_at);

alter table public.club_operations_config enable row level security;
alter table public.club_operations_sessions enable row level security;
alter table public.club_operations_posts enable row level security;
revoke all on public.club_operations_config, public.club_operations_sessions, public.club_operations_posts from public, anon, authenticated;
grant select, insert, update on public.club_operations_config, public.club_operations_posts to service_role;
grant select, insert, delete on public.club_operations_sessions to service_role;

create function public.club_operations_set_password(p_user_id uuid, p_password text) returns boolean
language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if not exists (select 1 from public.club_accounts where user_id=p_user_id and role='admin') then
    return false;
  end if;
  if p_password is null or char_length(p_password)<8 or octet_length(p_password)>72 then
    return false;
  end if;
  insert into public.club_operations_config (password_hash)
  values (extensions.crypt(p_password,extensions.gen_salt('bf',12)))
  on conflict (id) do update set password_hash=excluded.password_hash, version=excluded.version;
  return true;
end;
$$;

create function public.club_operations_unlock(p_user_id uuid, p_password text, p_token_hash text) returns text
language plpgsql security invoker set search_path=pg_catalog as $$
declare config public.club_operations_config%rowtype;
begin
  select * into config from public.club_operations_config where id;
  if not found then return 'unconfigured'; end if;
  if p_password is null or octet_length(p_password)>72 or extensions.crypt(p_password,config.password_hash) is distinct from config.password_hash then
    return 'invalid';
  end if;
  delete from public.club_operations_sessions where expires_at<=now();
  insert into public.club_operations_sessions (user_id,token_hash,version) values (p_user_id,p_token_hash,config.version);
  return 'ok';
end;
$$;

create function public.club_operations_session(p_user_id uuid, p_token_hash text) returns boolean
language sql stable security invoker set search_path=pg_catalog as $$
  select exists (
    select 1 from public.club_operations_sessions s
    join public.club_operations_config c on c.version=s.version
    where s.user_id=p_user_id and s.token_hash=p_token_hash and s.expires_at>now()
  );
$$;

revoke all on function public.club_operations_set_password(uuid,text), public.club_operations_unlock(uuid,text,text), public.club_operations_session(uuid,text) from public, anon, authenticated;
grant execute on function public.club_operations_set_password(uuid,text), public.club_operations_unlock(uuid,text,text), public.club_operations_session(uuid,text) to service_role;
commit;
