-- A row exists only for a member marked as a coach. No changes to snapshot rows.
begin;
create table public.club_coaches (member_name text primary key check(length(btrim(member_name)) between 1 and 30));
alter table public.club_coaches enable row level security;
revoke all on public.club_coaches from public,anon,authenticated;
grant select,insert,delete on public.club_coaches to service_role;
commit;
