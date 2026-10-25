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
read_parts = []
for name, spec in layout.items():
    order = ','.join('x."' + k + '"' for k in spec['key'])
    read_parts.append(literal(name) + ", (select coalesce(jsonb_agg(to_jsonb(x) order by " + order + "), '[]'::jsonb) from public.club_" + name + ' x)')
sql = '''-- Versioned, server-only snapshot storage. All 12 datasets commit together.
begin;
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
create function public.club_store_commit(p_expected_revision bigint, p_tables jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare current_revision bigint; dataset text; counts jsonb := '{}'::jsonb;
begin
 select revision into current_revision from public.club_store_meta where id for update;
 if current_revision is distinct from p_expected_revision then raise exception 'storage_revision_conflict'; end if;
 if p_tables is null or jsonb_typeof(p_tables) <> 'object' or (select count(*) from jsonb_object_keys(p_tables)) <> 12 then raise exception 'invalid_snapshot'; end if;
 foreach dataset in array array[''' + names + '''] loop
  if jsonb_typeof(p_tables->dataset) is distinct from 'array' then raise exception 'invalid_dataset'; end if;
 end loop;
 foreach dataset in array array[''' + names + '''] loop
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
'''
(ROOT / 'supabase' / 'migrations' / '20261026060000_storage_switch.sql').write_text(sql, encoding='utf-8')
print('Generated StorageLayout.gs and storage switch SQL')
