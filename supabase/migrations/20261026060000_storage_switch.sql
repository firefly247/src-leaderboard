-- Versioned, server-only snapshot storage. All 12 datasets commit together.
begin;
create table public.club_store_meta (id boolean primary key default true check(id), revision bigint not null default 0);
insert into public.club_store_meta values(true,0);
alter table public.club_store_meta enable row level security;
revoke all on public.club_store_meta from public, anon, authenticated;
grant select, update on public.club_store_meta to service_role;
create function public.club_store_read() returns jsonb language sql stable security invoker
set search_path=pg_catalog as $$
select jsonb_build_object('revision',(select revision from public.club_store_meta where id), 'tables', jsonb_build_object(
'events', (select coalesce(jsonb_agg(to_jsonb(x) order by x."event_id"), '[]'::jsonb) from public.club_events x),
'records', (select coalesce(jsonb_agg(to_jsonb(x) order by x."record_id"), '[]'::jsonb) from public.club_records x),
'competitions', (select coalesce(jsonb_agg(to_jsonb(x) order by x."competition_id"), '[]'::jsonb) from public.club_competitions x),
'competition_dates', (select coalesce(jsonb_agg(to_jsonb(x) order by x."competition_id",x."year"), '[]'::jsonb) from public.club_competition_dates x),
'competition_events', (select coalesce(jsonb_agg(to_jsonb(x) order by x."competition_event_id"), '[]'::jsonb) from public.club_competition_events x),
'competition_divisions', (select coalesce(jsonb_agg(to_jsonb(x) order by x."competition_division_id"), '[]'::jsonb) from public.club_competition_divisions x),
'competition_records', (select coalesce(jsonb_agg(to_jsonb(x) order by x."record_id"), '[]'::jsonb) from public.club_competition_records x),
'dormant_members', (select coalesce(jsonb_agg(to_jsonb(x) order by x."member_name"), '[]'::jsonb) from public.club_dormant_members x),
'player_birth_years', (select coalesce(jsonb_agg(to_jsonb(x) order by x."member_name"), '[]'::jsonb) from public.club_player_birth_years x),
'weekend_training', (select coalesce(jsonb_agg(to_jsonb(x) order by x."date"), '[]'::jsonb) from public.club_weekend_training x),
'competition_lineups', (select coalesce(jsonb_agg(to_jsonb(x) order by x."id"), '[]'::jsonb) from public.club_competition_lineups x),
'request_log', (select coalesce(jsonb_agg(to_jsonb(x) order by x."request_id"), '[]'::jsonb) from public.club_request_log x)));
$$;
create function public.club_store_commit(p_expected_revision bigint, p_tables jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare current_revision bigint; dataset text; counts jsonb := '{}'::jsonb;
begin
 select revision into current_revision from public.club_store_meta where id for update;
 if current_revision is distinct from p_expected_revision then raise exception 'storage_revision_conflict'; end if;
 if p_tables is null or jsonb_typeof(p_tables) <> 'object' or (select count(*) from jsonb_object_keys(p_tables)) <> 12 then raise exception 'invalid_snapshot'; end if;
 foreach dataset in array array['events','records','competitions','competition_dates','competition_events','competition_divisions','competition_records','dormant_members','player_birth_years','weekend_training','competition_lineups','request_log'] loop
  if jsonb_typeof(p_tables->dataset) is distinct from 'array' then raise exception 'invalid_dataset'; end if;
 end loop;
 foreach dataset in array array['events','records','competitions','competition_dates','competition_events','competition_divisions','competition_records','dormant_members','player_birth_years','weekend_training','competition_lineups','request_log'] loop
  execute format('delete from public.%I', 'club_' || dataset);
  execute format('insert into public.%I select * from jsonb_populate_recordset(null::public.%I, $1)', 'club_' || dataset, 'club_' || dataset) using p_tables->dataset;
  counts := counts || jsonb_build_object(dataset, jsonb_array_length(p_tables->dataset));
 end loop;
 update public.club_store_meta set revision=revision+1 where id;
 return jsonb_build_object('revision',current_revision+1,'counts',counts);
end;
$$;
revoke all on function public.club_store_read() from public, anon, authenticated;
revoke all on function public.club_store_commit(bigint,jsonb) from public, anon, authenticated;
grant execute on function public.club_store_read() to service_role;
grant execute on function public.club_store_commit(bigint,jsonb) to service_role;
commit;
