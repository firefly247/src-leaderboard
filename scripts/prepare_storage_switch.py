"""Generate the server layout and transactional snapshot RPCs, without credentials/data."""
import json
from prepare_supabase import ROOT, catalog, literal

mapping, entries = catalog()
layout = {}
for name, columns, key in entries:
    sheet = next((s for s, v in mapping['sheets'].items() if v['table'] == name), None)
    layout[name] = dict(columns=columns, key=key, sheet=sheet, path=None if sheet else 'data/' + name + '.csv')
(ROOT / 'apps-script' / 'StorageLayout.gs').write_text('/* Generated from source-map.json and public CSV headers. */\nvar StorageLayout = ' + json.dumps(layout, ensure_ascii=False, indent=2) + ';\n', encoding='utf-8')
names = ','.join(literal(n) for n in layout)
compact_request = ['request_id','request_type','requested_at','source_json','status','processed_at','result','record_id']
drop_request_columns = [c for c in layout['request_log']['columns'] if c not in compact_request]
definitions = []
for name, spec in layout.items():
    columns = compact_request if name == 'request_log' else spec['columns']
    keys = ','.join('"'+k+'"' for k in spec['key'])
    matches = ' and '.join('t."'+k+'"=d."'+k+'"' for k in spec['key'])
    updates = ','.join('"'+c+'"=excluded."'+c+'"' for c in columns if c not in spec['key'])
    conflict = 'do update set '+updates+' where t is distinct from excluded' if updates else 'do nothing'
    definitions.append(' when '+literal(name)+' then key_columns := '+literal(keys)+'; key_match := '+literal(matches)+'; conflict_clause := '+literal(conflict)+';')
read_parts = []
for name, spec in layout.items():
    order = ','.join('x."' + k + '"' for k in spec['key'])
    read_parts.append(literal(name) + ", (select coalesce(jsonb_agg(to_jsonb(x) order by " + order + "), '[]'::jsonb) from public.club_" + name + ' x)')
sql = '''-- Versioned, server-only snapshot storage. All 12 datasets commit together.
begin;
-- Original workbook remains untouched. Do not drop populated legacy SQL columns.
do $$ begin if exists(select 1 from public.club_request_log limit 1) then raise exception 'request_log_must_be_migrated_before_compaction'; end if; end $$;
''' + 'alter table public.club_request_log '+', '.join('drop column "'+c+'"' for c in drop_request_columns) + ''';
create table public.club_store_meta (id boolean primary key default true check(id), revision bigint not null default 0);
insert into public.club_store_meta values(true,0);
alter table public.club_store_meta enable row level security;
revoke all on public.club_store_meta from public, anon, authenticated;
grant select, update on public.club_store_meta to service_role;
create function public.club_store_read() returns jsonb language sql stable security invoker
set search_path=pg_catalog as $$
select jsonb_build_object('revision',(select revision from public.club_store_meta where id), 'tables', jsonb_build_object(
''' + ',\n'.join(read_parts) + '''));
$$;
create function public.club_store_commit(p_expected_revision bigint, p_changes jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare current_revision bigint; dataset text; counts jsonb := '{}'::jsonb; key_columns text; key_match text; conflict_clause text;
begin
 select revision into current_revision from public.club_store_meta where id for update;
 if current_revision is distinct from p_expected_revision then raise exception 'storage_revision_conflict'; end if;
 if p_changes is null or jsonb_typeof(p_changes) <> 'object' then raise exception 'invalid_changes'; end if;
 for dataset in select jsonb_object_keys(p_changes) loop
  if not (dataset=any(array[''' + names + '''])) or jsonb_typeof(p_changes->dataset->'upsert') is distinct from 'array' or jsonb_typeof(p_changes->dataset->'remove') is distinct from 'array' then raise exception 'invalid_dataset'; end if;
  case dataset
''' + '\n'.join(definitions) + '''
  else raise exception 'invalid_dataset'; end case;
  execute format('delete from public.%I t using jsonb_populate_recordset(null::public.%I,$1) d where %s', 'club_'||dataset,'club_'||dataset,key_match) using p_changes->dataset->'remove';
  execute format('insert into public.%I as t select * from jsonb_populate_recordset(null::public.%I,$1) on conflict (%s) %s', 'club_'||dataset,'club_'||dataset,key_columns,conflict_clause) using p_changes->dataset->'upsert';
 end loop;
 if p_changes <> '{}'::jsonb then update public.club_store_meta set revision=revision+1 where id; current_revision:=current_revision+1; end if;
 foreach dataset in array array[''' + names + '''] loop
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
'''
(ROOT / 'supabase' / 'migrations' / '20261026060000_storage_switch.sql').write_text(sql, encoding='utf-8')
print('Generated StorageLayout.gs and storage switch SQL')
