-- A Kakao nickname helps an operator review a link request; it never grants a role.
alter table public.club_accounts add column if not exists display_name text not null default '' check(length(display_name)<=80);
