-- Include legacy athletes that exist in records but have no private year row yet.
create or replace function public.club_member_approve(p_user_id uuid,p_player_name text) returns boolean
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 perform 1 from public.club_accounts where user_id=p_user_id and requested_player_name=p_player_name for update;
 if not found then raise exception 'membership_request_changed'; end if;
 if not (exists(select 1 from public.club_player_birth_years where member_name=p_player_name)
  or exists(select 1 from public.club_records where member_name=p_player_name)
  or exists(select 1 from public.club_competition_records where member_name=p_player_name))
  or exists(select 1 from public.club_dormant_members where member_name=p_player_name) then raise exception 'invalid_player'; end if;
 update public.club_accounts set player_name=p_player_name,requested_player_name=null,linked_at=now() where user_id=p_user_id;
 return true;
end;$$;
revoke all on function public.club_member_approve(uuid,text) from public,anon,authenticated;
grant execute on function public.club_member_approve(uuid,text) to service_role;
