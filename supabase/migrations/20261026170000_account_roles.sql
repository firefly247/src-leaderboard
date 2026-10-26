begin;
-- Only the verified Edge API may call this function. Caller ID comes from Auth.
create or replace function public.club_account_set_role(p_actor_id uuid,p_user_id uuid,p_role text) returns boolean
language plpgsql security invoker set search_path=pg_catalog as $$
declare previous_role text;
begin
 perform pg_advisory_xact_lock(2610261700);
 if not exists(select 1 from public.club_accounts where user_id=p_actor_id and role='admin') then raise exception 'administrator_required'; end if;
 if p_role is null or p_role not in ('member','admin') then raise exception 'invalid_account_role'; end if;
 select role into previous_role from public.club_accounts where user_id=p_user_id for update;
 if not found then raise exception 'account_not_found'; end if;
 if previous_role='admin' and p_role='member' and (select count(*) from public.club_accounts where role='admin')<=1 then raise exception 'last_administrator'; end if;
 update public.club_accounts set role=p_role where user_id=p_user_id;
 return true;
end;$$;
revoke all on function public.club_account_set_role(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.club_account_set_role(uuid,uuid,text) to service_role;
commit;
