begin;
create table public.club_officers (member_name text primary key check(length(btrim(member_name)) between 1 and 30));
alter table public.club_officers enable row level security;
revoke all on public.club_officers from public,anon,authenticated;
grant select,insert,delete on public.club_officers to service_role;
commit;
