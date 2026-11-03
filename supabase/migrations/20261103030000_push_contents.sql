begin;
alter table public.club_push_subscriptions
 add column p256dh text check(length(p256dh)<=90),
 add column auth text check(length(auth)<=25);
commit;
