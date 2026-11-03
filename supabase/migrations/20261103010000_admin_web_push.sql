begin;
create table public.club_push_keys (
 id boolean primary key default true check(id),
 public_key text not null,
 private_jwk jsonb not null
);
create table public.club_push_subscriptions (
 endpoint_hash text primary key check(length(endpoint_hash)=64),
 user_id uuid not null references public.club_accounts(user_id) on delete cascade,
 endpoint text not null check(length(endpoint)<=2048),
 updated_at timestamptz not null default now()
);
create index club_push_subscriptions_user_idx on public.club_push_subscriptions(user_id);
alter table public.club_push_keys enable row level security;
alter table public.club_push_subscriptions enable row level security;
revoke all on public.club_push_keys,public.club_push_subscriptions from public,anon,authenticated;
grant select,insert on public.club_push_keys to service_role;
grant select,insert,update,delete on public.club_push_subscriptions to service_role;
commit;
