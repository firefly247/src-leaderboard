begin;

create table public.club_operations_categories (
  id text primary key default gen_random_uuid()::text,
  name text not null unique check (name = btrim(name) and char_length(name) between 1 and 30 and name !~ '[[:cntrl:]]')
);

insert into public.club_operations_categories (id, name) values
  ('rules', '동호회 회칙'),
  ('equipment', '물품관리'),
  ('general', '기타');

alter table public.club_operations_categories enable row level security;
revoke all on public.club_operations_categories from public, anon, authenticated;
grant select, insert, update on public.club_operations_categories to service_role;

alter table public.club_operations_posts
  drop constraint club_operations_posts_category_check,
  add constraint club_operations_posts_category_fkey
    foreign key (category) references public.club_operations_categories (id);

commit;
