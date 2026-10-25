-- Versioned, server-only snapshot storage. All 12 datasets commit together.
begin;
-- Original workbook remains untouched. Do not drop populated legacy SQL columns.
do $$ begin if exists(select 1 from public.club_request_log limit 1) then raise exception 'request_log_must_be_migrated_before_compaction'; end if; end $$;
alter table public.club_request_log drop column "member_name", drop column "event_id", drop column "event_name", drop column "time_display", drop column "competition_date", drop column "competition", drop column "note", drop column "proof_photo_url", drop column "delete_reason";
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
create function public.club_store_commit(p_expected_revision bigint, p_changes jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare current_revision bigint; dataset text; counts jsonb := '{}'::jsonb; key_columns text; key_match text; conflict_clause text;
begin
 select revision into current_revision from public.club_store_meta where id for update;
 if current_revision is distinct from p_expected_revision then raise exception 'storage_revision_conflict'; end if;
 if p_changes is null or jsonb_typeof(p_changes) <> 'object' then raise exception 'invalid_changes'; end if;
 for dataset in select jsonb_object_keys(p_changes) loop
  if not (dataset=any(array['events','records','competitions','competition_dates','competition_events','competition_divisions','competition_records','dormant_members','player_birth_years','weekend_training','competition_lineups','request_log'])) or jsonb_typeof(p_changes->dataset->'upsert') is distinct from 'array' or jsonb_typeof(p_changes->dataset->'remove') is distinct from 'array' then raise exception 'invalid_dataset'; end if;
  case dataset
 when 'events' then key_columns := '"event_id"'; key_match := 't."event_id"=d."event_id"'; conflict_clause := 'do update set "event_name"=excluded."event_name" where t is distinct from excluded';
 when 'records' then key_columns := '"record_id"'; key_match := 't."record_id"=d."record_id"'; conflict_clause := 'do update set "member_name"=excluded."member_name","event_id"=excluded."event_id","event_name"=excluded."event_name","time_ms"=excluded."time_ms","time_display"=excluded."time_display","competition"=excluded."competition","competition_date"=excluded."competition_date","note"=excluded."note","proof_photo_url"=excluded."proof_photo_url","created_at"=excluded."created_at" where t is distinct from excluded';
 when 'competitions' then key_columns := '"competition_id"'; key_match := 't."competition_id"=d."competition_id"'; conflict_clause := 'do update set "competition_name"=excluded."competition_name" where t is distinct from excluded';
 when 'competition_dates' then key_columns := '"competition_id","year"'; key_match := 't."competition_id"=d."competition_id" and t."year"=d."year"'; conflict_clause := 'do update set "competition_date"=excluded."competition_date" where t is distinct from excluded';
 when 'competition_events' then key_columns := '"competition_event_id"'; key_match := 't."competition_event_id"=d."competition_event_id"'; conflict_clause := 'do update set "competition_event_name"=excluded."competition_event_name" where t is distinct from excluded';
 when 'competition_divisions' then key_columns := '"competition_division_id"'; key_match := 't."competition_division_id"=d."competition_division_id"'; conflict_clause := 'do update set "competition_division_name"=excluded."competition_division_name" where t is distinct from excluded';
 when 'competition_records' then key_columns := '"record_id"'; key_match := 't."record_id"=d."record_id"'; conflict_clause := 'do update set "member_name"=excluded."member_name","competition_id"=excluded."competition_id","competition_name"=excluded."competition_name","competition_event_id"=excluded."competition_event_id","competition_event_name"=excluded."competition_event_name","competition_division_id"=excluded."competition_division_id","competition_division_name"=excluded."competition_division_name","year"=excluded."year","competition_type"=excluded."competition_type","is_cox"=excluded."is_cox","gold"=excluded."gold","silver"=excluded."silver","bronze"=excluded."bronze","note"=excluded."note","created_at"=excluded."created_at","lineup_group_id"=excluded."lineup_group_id" where t is distinct from excluded';
 when 'dormant_members' then key_columns := '"member_name"'; key_match := 't."member_name"=d."member_name"'; conflict_clause := 'do nothing';
 when 'player_birth_years' then key_columns := '"member_name"'; key_match := 't."member_name"=d."member_name"'; conflict_clause := 'do update set "birth_year"=excluded."birth_year","updated_at"=excluded."updated_at","join_year"=excluded."join_year" where t is distinct from excluded';
 when 'weekend_training' then key_columns := '"date"'; key_match := 't."date"=d."date"'; conflict_clause := 'do update set "session_json"=excluded."session_json" where t is distinct from excluded';
 when 'competition_lineups' then key_columns := '"id"'; key_match := 't."id"=d."id"'; conflict_clause := 'do update set "session_json"=excluded."session_json" where t is distinct from excluded';
 when 'request_log' then key_columns := '"request_id"'; key_match := 't."request_id"=d."request_id"'; conflict_clause := 'do update set "request_type"=excluded."request_type","requested_at"=excluded."requested_at","source_json"=excluded."source_json","status"=excluded."status","processed_at"=excluded."processed_at","result"=excluded."result","record_id"=excluded."record_id" where t is distinct from excluded';
  else raise exception 'invalid_dataset'; end case;
  execute format('delete from public.%I t using jsonb_populate_recordset(null::public.%I,$1) d where %s', 'club_'||dataset,'club_'||dataset,key_match) using p_changes->dataset->'remove';
  execute format('insert into public.%I as t select * from jsonb_populate_recordset(null::public.%I,$1) on conflict (%s) %s', 'club_'||dataset,'club_'||dataset,key_columns,conflict_clause) using p_changes->dataset->'upsert';
 end loop;
 if p_changes <> '{}'::jsonb then update public.club_store_meta set revision=revision+1 where id; current_revision:=current_revision+1; end if;
 foreach dataset in array array['events','records','competitions','competition_dates','competition_events','competition_divisions','competition_records','dormant_members','player_birth_years','weekend_training','competition_lineups','request_log'] loop
  execute format('select count(*) from public.%I','club_'||dataset) into key_columns;
  counts := counts || jsonb_build_object(dataset,key_columns::bigint);
 end loop;
 return jsonb_build_object('revision',current_revision,'counts',counts);
end;
$$;
revoke all on function public.club_store_read() from public, anon, authenticated;
revoke all on function public.club_store_commit(bigint,jsonb) from public, anon, authenticated;
grant execute on function public.club_store_read() to service_role;
grant execute on function public.club_store_commit(bigint,jsonb) to service_role;
commit;
