// Usage: node scripts/verify_supabase_schema.mjs <installed @electric-sql/pglite path>
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const modulePath = process.argv[2];
if (!modulePath) throw new Error('Pass a local PGlite module entry point.');
const { PGlite } = await import(pathToFileURL(resolve(modulePath)).href);
const db = new PGlite();
try {
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon, authenticated, service_role;');
  await db.exec(await readFile('supabase/migrations/20261025130000_prepare_club_storage.sql', 'utf8'));
  const tables = await db.query("select tablename, rowsecurity from pg_tables where schemaname='public' and tablename like 'club_%'");
  assert.equal(tables.rows.length, 12);
  assert.ok(tables.rows.every(t => t.rowsecurity));
  for (const role of ['anon', 'authenticated']) {
    const permissions = await db.query("select has_table_privilege($1, 'public.club_player_birth_years', 'SELECT') as read, has_table_privilege($1, 'public.club_records', 'INSERT') as write, has_function_privilege($1, 'public.club_connection_status()', 'EXECUTE') as probe", [role]);
    assert.deepEqual(permissions.rows[0], { read: false, write: false, probe: false });
  }
  const sql = await readFile('.local/supabase/public-csv-import.sql', 'utf8');
  await db.exec('set role service_role;');
  await db.exec(sql); await db.exec(sql); // Import can be repeated without duplicated records.
  assert.equal((await db.query('select count(*)::int as n from public.club_records')).rows[0].n, 150);
  assert.equal((await db.query('select count(*)::int as n from public.club_competition_records')).rows[0].n, 298);
  assert.equal((await db.query('select public.club_connection_status() as status')).rows[0].status.schemaVersion, '20261025130000');
  const sample = { participants: [{ name: '테스트 선수', comment: "따옴표 ' 와 줄바꿈\n확인" }], draft: null };
  await db.query('insert into public.club_weekend_training(date, session_json) values ($1, $2)', ['2026-10-25', sample]);
  assert.deepEqual((await db.query('select session_json from public.club_weekend_training')).rows[0].session_json, sample);
  await db.exec('reset role;');
  await db.exec(await readFile('supabase/migrations/20261026060000_storage_switch.sql','utf8'));
  for(const role of ['anon','authenticated']){
    const permission=await db.query("select has_function_privilege($1,'public.club_store_commit(bigint,jsonb)','EXECUTE') as write, has_function_privilege($1,'public.club_store_read()','EXECUTE') as read",[role]);
    assert.deepEqual(permission.rows[0],{write:false,read:false});
  }
  await db.exec('set role service_role;');
  const snapshot=(await db.query('select public.club_store_read() as snapshot')).rows[0].snapshot;
  assert.equal(snapshot.revision,0);assert.equal(Object.keys(snapshot.tables).length,12);
  const unchanged=(await db.query('select record_id,ctid::text as location from public.club_records order by record_id limit 1')).rows[0];
  const firstEvent=snapshot.tables.events[0];
  const delta={events:{upsert:[{...firstEvent,event_name:firstEvent.event_name+' 수정'}],remove:[]}};
  const copied=(await db.query('select public.club_store_commit($1,$2) as result',[0,delta])).rows[0].result;
  assert.equal(copied.revision,1);
  assert.deepEqual((await db.query('select record_id,ctid::text as location from public.club_records order by record_id limit 1')).rows[0],unchanged);
  const beforeFailure=(await db.query('select public.club_store_read() as snapshot')).rows[0].snapshot;
  await assert.rejects(()=>db.query('select public.club_store_commit($1,$2)',[0,delta]),/storage_revision_conflict/);
  const broken={events:{upsert:[],remove:[firstEvent]},competition_lineups:{upsert:[{id:'duplicate',session_json:{}},{id:'duplicate',session_json:{}}],remove:[]}};
  await assert.rejects(()=>db.query('select public.club_store_commit($1,$2)',[1,broken]),/duplicate|second time/);
  const retained=(await db.query('select public.club_store_read() as snapshot')).rows[0].snapshot;
  assert.equal(retained.revision,1);assert.deepEqual(retained.tables,beforeFailure.tables);
  await assert.rejects(()=>db.query('select public.club_store_commit($1,$2)',[1,{records:[]}]),/invalid_dataset/);
  console.log('PostgreSQL verified: 12 tables, RLS/grants, server probe, repeated CSV import (448 records), Korean JSON round trip.');
  console.log('Storage RPC verified: row-delta writes preserve untouched rows, role isolation, atomic multi-table changes, stale revision rejection and rollback.');
} finally { await db.close(); }
