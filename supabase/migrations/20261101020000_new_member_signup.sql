-- Keep prospective members private until an administrator approves the request.
begin;
alter table public.club_accounts
 add column requested_birth_year smallint check(requested_birth_year between 1900 and 9999),
 add column requested_join_year smallint check(requested_join_year between 1900 and 9999);
create or replace function public.club_member_approve(p_user_id uuid,p_player_name text) returns boolean
language plpgsql security invoker set search_path=pg_catalog as $$
declare applicant public.club_accounts%rowtype; current_year integer; inserted_count integer;
begin
 select * into applicant from public.club_accounts where user_id=p_user_id and requested_player_name=p_player_name and player_name is null for update;
 if not found then raise exception 'membership_request_changed'; end if;
 -- Serialize catalog changes with the existing optimistic storage commits.
 perform 1 from public.club_store_meta where id for update;
 if exists(select 1 from public.club_dormant_members where member_name=p_player_name) then raise exception 'invalid_player'; end if;
 if not (exists(select 1 from public.club_player_birth_years where member_name=p_player_name)
  or exists(select 1 from public.club_records where member_name=p_player_name)
  or exists(select 1 from public.club_competition_records where member_name=p_player_name)) then
  current_year:=extract(year from now() at time zone 'Asia/Seoul');
  if applicant.requested_birth_year is null or applicant.requested_join_year is null
   or applicant.requested_birth_year not between 1900 and current_year
   or applicant.requested_join_year not between applicant.requested_birth_year and current_year then raise exception 'invalid_member_years'; end if;
  insert into public.club_player_birth_years(member_name,birth_year,join_year,updated_at)
   values(p_player_name,applicant.requested_birth_year::text,applicant.requested_join_year::text,to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) on conflict(member_name) do nothing;
  get diagnostics inserted_count=row_count;
  if inserted_count>0 then update public.club_store_meta set revision=revision+1 where id; end if;
 end if;
 update public.club_accounts set player_name=p_player_name,requested_player_name=null,requested_birth_year=null,requested_join_year=null,linked_at=now() where user_id=p_user_id;
 return true;
end;$$;
revoke all on function public.club_member_approve(uuid,text) from public,anon,authenticated;
grant execute on function public.club_member_approve(uuid,text) to service_role;
commit;
