begin;

create or replace function public.club_operations_set_password(p_user_id uuid, p_password text) returns boolean
language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if not exists (select 1 from public.club_accounts where user_id=p_user_id and role='admin') then
    return false;
  end if;
  if p_password is null or char_length(p_password)<6 or octet_length(p_password)>72 then
    return false;
  end if;
  insert into public.club_operations_config (password_hash)
  values (extensions.crypt(p_password,extensions.gen_salt('bf',12)))
  on conflict (id) do update set password_hash=excluded.password_hash, version=excluded.version;
  return true;
end;
$$;

commit;
